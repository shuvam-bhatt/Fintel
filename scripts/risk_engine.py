"""
Fintel — Rule-Based Risk Scoring Engine
=============================================
Person 2 (Cybersecurity / Fraud Data Layer)

Computes a risk score in [0.0, 1.0] for each transaction based on configurable
rule-based detectors. Designed as a standalone module importable by ingestion
scripts and (later) by real-time scoring endpoints.

Rules:
    1. High-value transaction (amount > threshold)
    2. Velocity spike (N+ transactions from same account in time window)
    3. Structuring pattern (amount clusters just below reporting threshold)
    4. Rapid movement (received + forwarded within short window)
    5. New account with high volume (synthetic identity risk)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)


# =============================================================================
# Configuration — all thresholds are tunable
# =============================================================================

@dataclass
class RiskRuleConfig:
    """Tunable thresholds for each risk rule."""

    # Rule 1: High-value transaction
    high_value_threshold: float = 10_000.0
    high_value_weight: float = 0.30

    # Rule 2: Velocity spike
    velocity_count_threshold: int = 5
    velocity_window_hours: float = 1.0
    velocity_weight: float = 0.25

    # Rule 3: Structuring (just-below-threshold amounts)
    structuring_lower_bound: float = 9_500.0
    structuring_upper_bound: float = 9_999.99
    structuring_min_count: int = 3  # need N+ such transactions to trigger
    structuring_weight: float = 0.35

    # Rule 4: Rapid movement (in + out within window)
    rapid_movement_window_minutes: float = 30.0
    rapid_movement_min_amount: float = 1_000.0
    rapid_movement_weight: float = 0.30

    # Rule 5: New account with high volume
    new_account_max_age_days: int = 7
    new_account_volume_threshold: float = 5_000.0
    new_account_weight: float = 0.20


DEFAULT_CONFIG = RiskRuleConfig()


# =============================================================================
# Data structures for transaction context
# =============================================================================

@dataclass
class TransactionContext:
    """
    Context needed to score a single transaction.
    Not all fields are required — rules gracefully skip if data is missing.
    """
    transaction_id: str
    account_id: str
    amount: float
    timestamp: Optional[datetime] = None
    currency: str = "USD"

    # Velocity context: recent transaction timestamps for this account
    recent_account_timestamps: list[datetime] = field(default_factory=list)

    # Structuring context: recent amounts from this account
    recent_account_amounts: list[float] = field(default_factory=list)

    # Rapid movement context
    time_since_last_credit_minutes: Optional[float] = None  # None = unknown
    is_outbound: bool = False  # True if this is a send/transfer/cash-out

    # Account age context
    account_open_date: Optional[datetime] = None
    account_total_volume: float = 0.0  # total transaction volume for the account


# =============================================================================
# Individual Rule Evaluators
# =============================================================================

@dataclass
class RuleResult:
    """Result from evaluating a single rule."""
    rule_name: str
    triggered: bool
    score_contribution: float
    details: str = ""


def evaluate_high_value(
    txn: TransactionContext, config: RiskRuleConfig = DEFAULT_CONFIG
) -> RuleResult:
    """Rule 1: Flag high-value single transactions."""
    triggered = txn.amount > config.high_value_threshold
    return RuleResult(
        rule_name="high_value_transaction",
        triggered=triggered,
        score_contribution=config.high_value_weight if triggered else 0.0,
        details=f"amount=${txn.amount:,.2f} vs threshold=${config.high_value_threshold:,.2f}"
    )


def evaluate_velocity(
    txn: TransactionContext, config: RiskRuleConfig = DEFAULT_CONFIG
) -> RuleResult:
    """Rule 2: Flag accounts with N+ transactions within a time window."""
    if not txn.timestamp or not txn.recent_account_timestamps:
        return RuleResult(
            rule_name="velocity_spike",
            triggered=False,
            score_contribution=0.0,
            details="insufficient timestamp data"
        )

    window_start = txn.timestamp - timedelta(hours=config.velocity_window_hours)
    count_in_window = sum(
        1 for ts in txn.recent_account_timestamps
        if window_start <= ts <= txn.timestamp
    )
    # Include the current transaction
    count_in_window += 1

    triggered = count_in_window >= config.velocity_count_threshold
    return RuleResult(
        rule_name="velocity_spike",
        triggered=triggered,
        score_contribution=config.velocity_weight if triggered else 0.0,
        details=f"{count_in_window} txns in {config.velocity_window_hours}h window (threshold={config.velocity_count_threshold})"
    )


def evaluate_structuring(
    txn: TransactionContext, config: RiskRuleConfig = DEFAULT_CONFIG
) -> RuleResult:
    """Rule 3: Flag transactions with amounts just below the reporting threshold."""
    is_near_threshold = (
        config.structuring_lower_bound <= txn.amount <= config.structuring_upper_bound
    )

    # Count how many recent amounts from this account are also near-threshold
    near_threshold_count = sum(
        1 for amt in txn.recent_account_amounts
        if config.structuring_lower_bound <= amt <= config.structuring_upper_bound
    )
    if is_near_threshold:
        near_threshold_count += 1

    triggered = is_near_threshold and near_threshold_count >= config.structuring_min_count
    return RuleResult(
        rule_name="structuring_pattern",
        triggered=triggered,
        score_contribution=config.structuring_weight if triggered else 0.0,
        details=f"amount=${txn.amount:,.2f} in [{config.structuring_lower_bound}, {config.structuring_upper_bound}], "
                f"{near_threshold_count} near-threshold txns (need {config.structuring_min_count}+)"
    )


def evaluate_rapid_movement(
    txn: TransactionContext, config: RiskRuleConfig = DEFAULT_CONFIG
) -> RuleResult:
    """Rule 4: Flag rapid in-out patterns (receive then send within minutes)."""
    if txn.time_since_last_credit_minutes is None or not txn.is_outbound:
        return RuleResult(
            rule_name="rapid_movement",
            triggered=False,
            score_contribution=0.0,
            details="not an outbound txn or no credit timing data"
        )

    triggered = (
        txn.time_since_last_credit_minutes <= config.rapid_movement_window_minutes
        and txn.amount >= config.rapid_movement_min_amount
    )
    return RuleResult(
        rule_name="rapid_movement",
        triggered=triggered,
        score_contribution=config.rapid_movement_weight if triggered else 0.0,
        details=f"{txn.time_since_last_credit_minutes:.1f}min since last credit, "
                f"amount=${txn.amount:,.2f} (min=${config.rapid_movement_min_amount:,.2f})"
    )


def evaluate_new_account(
    txn: TransactionContext, config: RiskRuleConfig = DEFAULT_CONFIG
) -> RuleResult:
    """Rule 5: Flag new accounts with high transaction volume."""
    if txn.account_open_date is None or txn.timestamp is None:
        return RuleResult(
            rule_name="new_account_high_volume",
            triggered=False,
            score_contribution=0.0,
            details="no account age data"
        )

    account_age_days = (txn.timestamp - txn.account_open_date).days
    triggered = (
        account_age_days <= config.new_account_max_age_days
        and txn.account_total_volume >= config.new_account_volume_threshold
    )
    return RuleResult(
        rule_name="new_account_high_volume",
        triggered=triggered,
        score_contribution=config.new_account_weight if triggered else 0.0,
        details=f"account age={account_age_days}d (max={config.new_account_max_age_days}d), "
                f"volume=${txn.account_total_volume:,.2f} (threshold=${config.new_account_volume_threshold:,.2f})"
    )


# =============================================================================
# Composite Scoring
# =============================================================================

ALL_RULES = [
    evaluate_high_value,
    evaluate_velocity,
    evaluate_structuring,
    evaluate_rapid_movement,
    evaluate_new_account,
]


@dataclass
class RiskScore:
    """Final composite risk score with detailed rule breakdown."""
    score: float                     # Final score in [0.0, 1.0]
    rule_results: list[RuleResult]   # Individual rule evaluations
    triggered_rules: list[str]       # Names of rules that fired

    def __repr__(self) -> str:
        triggered = ", ".join(self.triggered_rules) if self.triggered_rules else "none"
        return f"RiskScore(score={self.score:.3f}, triggered=[{triggered}])"


def compute_risk_score(
    txn: TransactionContext,
    config: RiskRuleConfig = DEFAULT_CONFIG,
    rules: list = None,
) -> RiskScore:
    """
    Compute the composite risk score for a transaction.

    The score is the clamped sum of all triggered rule weights, bounded to [0.0, 1.0].
    This produces a graduated score: benign transactions score near 0, highly suspicious
    ones approach 1.0.

    Args:
        txn: Transaction context with all available metadata.
        config: Tunable thresholds for each rule.
        rules: Optional list of rule evaluator functions. Defaults to ALL_RULES.

    Returns:
        RiskScore with composite score and per-rule breakdown.
    """
    if rules is None:
        rules = ALL_RULES

    results = [rule(txn, config) for rule in rules]
    raw_score = sum(r.score_contribution for r in results)
    clamped_score = max(0.0, min(1.0, raw_score))

    triggered = [r.rule_name for r in results if r.triggered]

    if triggered:
        logger.debug(
            "Transaction %s scored %.3f — triggered: %s",
            txn.transaction_id, clamped_score, ", ".join(triggered)
        )

    return RiskScore(
        score=round(clamped_score, 4),
        rule_results=results,
        triggered_rules=triggered,
    )


# =============================================================================
# Batch scoring helper (for ingestion scripts)
# =============================================================================

def score_amount_only(amount: float, config: RiskRuleConfig = DEFAULT_CONFIG) -> float:
    """
    Quick scoring using only the transaction amount — used during bulk ingestion
    when full context (velocity, timing) isn't available yet.

    Returns a float in [0.0, 1.0].
    """
    score = 0.0

    # High value check
    if amount > config.high_value_threshold:
        score += config.high_value_weight

    # Structuring check
    if config.structuring_lower_bound <= amount <= config.structuring_upper_bound:
        score += config.structuring_weight * 0.5  # half weight without pattern confirmation

    # Medium-high amounts are slightly suspicious
    if 5_000 <= amount <= config.high_value_threshold:
        score += 0.10

    return round(max(0.0, min(1.0, score)), 4)


# =============================================================================
# CLI for testing
# =============================================================================

if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)

    # Test case: structuring pattern
    test_txn = TransactionContext(
        transaction_id="TEST-001",
        account_id="ACCT-SUSPICIOUS",
        amount=9_800.00,
        timestamp=datetime(2024, 6, 15, 14, 30),
        recent_account_amounts=[9_750.00, 9_900.00, 9_600.00],
    )
    result = compute_risk_score(test_txn)
    print(f"\nStructuring test:  {result}")
    for r in result.rule_results:
        print(f"  {r.rule_name}: triggered={r.triggered}, +{r.score_contribution:.2f} — {r.details}")

    # Test case: high value + velocity
    test_txn2 = TransactionContext(
        transaction_id="TEST-002",
        account_id="ACCT-HIGHVOL",
        amount=25_000.00,
        timestamp=datetime(2024, 6, 15, 10, 0),
        recent_account_timestamps=[
            datetime(2024, 6, 15, 9, 50),
            datetime(2024, 6, 15, 9, 45),
            datetime(2024, 6, 15, 9, 30),
            datetime(2024, 6, 15, 9, 15),
            datetime(2024, 6, 15, 9, 0),
        ],
    )
    result2 = compute_risk_score(test_txn2)
    print(f"\nHigh value + velocity test:  {result2}")
    for r in result2.rule_results:
        print(f"  {r.rule_name}: triggered={r.triggered}, +{r.score_contribution:.2f} — {r.details}")

    # Test case: benign transaction
    test_txn3 = TransactionContext(
        transaction_id="TEST-003",
        account_id="ACCT-NORMAL",
        amount=150.00,
        timestamp=datetime(2024, 6, 15, 12, 0),
    )
    result3 = compute_risk_score(test_txn3)
    print(f"\nBenign test:  {result3}")
    for r in result3.rule_results:
        print(f"  {r.rule_name}: triggered={r.triggered}, +{r.score_contribution:.2f} — {r.details}")
