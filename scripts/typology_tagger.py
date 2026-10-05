"""
Fintel — AML Typology Tagger
==================================
Person 2 (Cybersecurity / Fraud Data Layer)

Classifies transactions into one of 5 AML typology categories based on
rule-based pattern matching. Works in two modes:

1. Single-transaction tagging (using only the transaction's own features)
2. Context-aware tagging (using account history and relationship data)

Typologies:
    - structuring:       Repeated near-threshold amounts from same account
    - mule_network:      Account is both receiver & sender across multiple counterparties
    - rapid_movement:    Funds in and out within a short window
    - synthetic_identity: New account + sparse KYC + high activity
    - layering:          Multi-hop chains with decreasing amounts
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


# =============================================================================
# Typology definitions
# =============================================================================

class Typology(str, Enum):
    """The 5 AML typology categories defined for Fintel."""
    STRUCTURING = "structuring"
    MULE_NETWORK = "mule_network"
    RAPID_MOVEMENT = "rapid_movement"
    SYNTHETIC_IDENTITY = "synthetic_identity"
    LAYERING = "layering"
    UNCLASSIFIED = "unclassified"

    @property
    def description(self) -> str:
        return TYPOLOGY_DESCRIPTIONS.get(self, "No description available")


TYPOLOGY_DESCRIPTIONS = {
    Typology.STRUCTURING: (
        "Transaction structuring (smurfing): deliberately splitting large amounts "
        "into smaller sub-threshold transactions to avoid regulatory reporting requirements. "
        "Common indicator of the placement stage of money laundering."
    ),
    Typology.MULE_NETWORK: (
        "Money mule network activity: coordinated movement of funds through chains "
        "of recruited intermediary accounts. Mules receive funds and quickly forward them, "
        "often taking a small fee. Used in the layering stage to break audit trails."
    ),
    Typology.RAPID_MOVEMENT: (
        "Rapid fund movement: pattern where an account receives a credit and almost "
        "immediately sends an outbound transfer of a similar amount. Indicative of "
        "pass-through or mule account behavior."
    ),
    Typology.SYNTHETIC_IDENTITY: (
        "Synthetic identity fraud: transactions originating from accounts with fabricated "
        "or incomplete KYC profiles. New accounts with immediate high-value activity and "
        "sparse identity documentation are strong indicators."
    ),
    Typology.LAYERING: (
        "Layering: complex multi-hop fund transfers designed to obscure the origin of "
        "illicit funds. Characterized by chains of 3+ accounts with progressively "
        "decreasing amounts as fees are extracted at each hop."
    ),
}


# =============================================================================
# Configuration
# =============================================================================

@dataclass
class TypologyConfig:
    """Tunable thresholds for typology classification."""

    # Structuring
    structuring_threshold_lower: float = 9_000.0
    structuring_threshold_upper: float = 10_000.0
    structuring_min_count: int = 3
    structuring_time_window_hours: float = 24.0

    # Mule network
    mule_min_counterparties: int = 2
    mule_max_hold_time_hours: float = 4.0

    # Rapid movement
    rapid_max_minutes: float = 30.0
    rapid_min_amount: float = 1_000.0
    rapid_amount_similarity_pct: float = 0.85  # outgoing >= 85% of incoming

    # Synthetic identity
    synthetic_max_account_age_days: int = 30
    synthetic_min_txn_amount: float = 2_000.0
    synthetic_kyc_completeness_threshold: float = 0.5  # < 50% fields filled = suspicious

    # Layering
    layering_min_hops: int = 3
    layering_max_amount_retention_pct: float = 0.95  # each hop retains < 95% of previous


DEFAULT_CONFIG = TypologyConfig()


# =============================================================================
# Transaction context for classification
# =============================================================================

@dataclass
class TypologyContext:
    """
    Context needed to classify a transaction's typology.
    Richer context = more accurate classification.
    """
    # Core transaction data
    transaction_id: str
    account_id: str
    amount: float
    timestamp: Optional[datetime] = None
    transaction_type: str = ""  # TRANSFER, CASH_OUT, PAYMENT, etc.

    # Account history
    recent_amounts: list[float] = field(default_factory=list)
    recent_timestamps: list[datetime] = field(default_factory=list)

    # Counterparty data (for mule detection)
    counterparties_received_from: list[str] = field(default_factory=list)
    counterparties_sent_to: list[str] = field(default_factory=list)

    # Timing data (for rapid movement)
    time_since_last_credit_minutes: Optional[float] = None
    last_credit_amount: Optional[float] = None
    is_outbound: bool = False

    # KYC/account data (for synthetic identity)
    account_age_days: Optional[int] = None
    kyc_completeness: float = 1.0  # 0.0–1.0, fraction of KYC fields filled
    account_total_volume: float = 0.0

    # Chain data (for layering)
    hop_count: int = 0  # number of hops traced from source
    amount_at_source: Optional[float] = None  # original amount before hops

    # Ground truth (for evaluation)
    is_fraud: Optional[bool] = None


# =============================================================================
# Classification result
# =============================================================================

@dataclass
class TypologyResult:
    """Result of typology classification."""
    typology: Typology
    confidence: float  # 0.0–1.0
    reasons: list[str]
    secondary_typology: Optional[Typology] = None  # some cases match multiple

    def __repr__(self) -> str:
        secondary = f", secondary={self.secondary_typology.value}" if self.secondary_typology else ""
        return f"TypologyResult({self.typology.value}, conf={self.confidence:.2f}{secondary})"


# =============================================================================
# Individual typology detectors
# =============================================================================

def detect_structuring(
    ctx: TypologyContext, config: TypologyConfig = DEFAULT_CONFIG
) -> tuple[float, list[str]]:
    """Detect structuring (smurfing) patterns."""
    score = 0.0
    reasons = []

    # Check if current amount is near-threshold
    is_near_threshold = (
        config.structuring_threshold_lower <= ctx.amount < config.structuring_threshold_upper
    )

    if is_near_threshold:
        score += 0.3
        reasons.append(
            f"Amount ${ctx.amount:,.2f} is in the near-threshold range "
            f"[${config.structuring_threshold_lower:,.0f}, ${config.structuring_threshold_upper:,.0f})"
        )

    # Count near-threshold amounts in recent history
    near_threshold_count = sum(
        1 for amt in ctx.recent_amounts
        if config.structuring_threshold_lower <= amt < config.structuring_threshold_upper
    )
    if is_near_threshold:
        near_threshold_count += 1

    if near_threshold_count >= config.structuring_min_count:
        score += 0.5
        reasons.append(
            f"{near_threshold_count} near-threshold transactions detected "
            f"(minimum {config.structuring_min_count} required)"
        )

    # Check if transactions are clustered in time
    if ctx.recent_timestamps and ctx.timestamp:
        window = timedelta(hours=config.structuring_time_window_hours)
        recent_in_window = sum(
            1 for ts in ctx.recent_timestamps
            if ctx.timestamp - window <= ts <= ctx.timestamp
        )
        if recent_in_window >= config.structuring_min_count:
            score += 0.2
            reasons.append(
                f"{recent_in_window} transactions within {config.structuring_time_window_hours}h window"
            )

    return min(score, 1.0), reasons


def detect_mule_network(
    ctx: TypologyContext, config: TypologyConfig = DEFAULT_CONFIG
) -> tuple[float, list[str]]:
    """Detect money mule network patterns."""
    score = 0.0
    reasons = []

    # Account acts as both receiver and sender
    if ctx.counterparties_received_from and ctx.counterparties_sent_to:
        unique_sources = len(set(ctx.counterparties_received_from))
        unique_destinations = len(set(ctx.counterparties_sent_to))

        if unique_sources >= 1 and unique_destinations >= 1:
            score += 0.3
            reasons.append(
                f"Account receives from {unique_sources} and sends to {unique_destinations} counterparties"
            )

        if unique_sources >= config.mule_min_counterparties:
            score += 0.3
            reasons.append(
                f"Receives from {unique_sources} distinct sources "
                f"(mule threshold={config.mule_min_counterparties})"
            )

    # Rapid forwarding pattern
    if (ctx.time_since_last_credit_minutes is not None
            and ctx.time_since_last_credit_minutes <= config.mule_max_hold_time_hours * 60
            and ctx.is_outbound):
        score += 0.3
        reasons.append(
            f"Funds forwarded {ctx.time_since_last_credit_minutes:.0f}min after receipt "
            f"(max hold={config.mule_max_hold_time_hours}h)"
        )

    # Transaction type indicators
    if ctx.transaction_type in ("TRANSFER", "CASH_OUT"):
        score += 0.1
        reasons.append(f"Transaction type '{ctx.transaction_type}' is mule-typical")

    return min(score, 1.0), reasons


def detect_rapid_movement(
    ctx: TypologyContext, config: TypologyConfig = DEFAULT_CONFIG
) -> tuple[float, list[str]]:
    """Detect rapid in-out fund movement."""
    score = 0.0
    reasons = []

    if ctx.time_since_last_credit_minutes is None or not ctx.is_outbound:
        return 0.0, ["Not an outbound transaction or no timing data"]

    if ctx.time_since_last_credit_minutes <= config.rapid_max_minutes:
        score += 0.4
        reasons.append(
            f"Outbound transfer {ctx.time_since_last_credit_minutes:.0f}min after credit "
            f"(threshold={config.rapid_max_minutes}min)"
        )

        if ctx.amount >= config.rapid_min_amount:
            score += 0.2
            reasons.append(f"Amount ${ctx.amount:,.2f} exceeds minimum ${config.rapid_min_amount:,.2f}")

        # Amount similarity to last credit
        if ctx.last_credit_amount and ctx.last_credit_amount > 0:
            ratio = ctx.amount / ctx.last_credit_amount
            if ratio >= config.rapid_amount_similarity_pct:
                score += 0.3
                reasons.append(
                    f"Outbound amount is {ratio:.0%} of last credit "
                    f"(${ctx.last_credit_amount:,.2f} → ${ctx.amount:,.2f})"
                )

    return min(score, 1.0), reasons


def detect_synthetic_identity(
    ctx: TypologyContext, config: TypologyConfig = DEFAULT_CONFIG
) -> tuple[float, list[str]]:
    """Detect synthetic/fabricated identity patterns."""
    score = 0.0
    reasons = []

    # New account
    if ctx.account_age_days is not None and ctx.account_age_days <= config.synthetic_max_account_age_days:
        score += 0.3
        reasons.append(
            f"Account is {ctx.account_age_days} days old "
            f"(threshold={config.synthetic_max_account_age_days}d)"
        )

    # Incomplete KYC
    if ctx.kyc_completeness < config.synthetic_kyc_completeness_threshold:
        score += 0.3
        reasons.append(
            f"KYC completeness {ctx.kyc_completeness:.0%} is below threshold "
            f"{config.synthetic_kyc_completeness_threshold:.0%}"
        )

    # High-value first transactions
    if ctx.amount >= config.synthetic_min_txn_amount:
        score += 0.2
        reasons.append(f"High-value transaction ${ctx.amount:,.2f} from new/sparse account")

    # Volume anomaly for new account
    if (ctx.account_age_days is not None
            and ctx.account_age_days <= config.synthetic_max_account_age_days
            and ctx.account_total_volume > config.synthetic_min_txn_amount * 3):
        score += 0.2
        reasons.append(
            f"Total volume ${ctx.account_total_volume:,.2f} is high for a "
            f"{ctx.account_age_days}-day-old account"
        )

    return min(score, 1.0), reasons


def detect_layering(
    ctx: TypologyContext, config: TypologyConfig = DEFAULT_CONFIG
) -> tuple[float, list[str]]:
    """Detect layering (multi-hop fund transfer chains)."""
    score = 0.0
    reasons = []

    # Multi-hop chain detected
    if ctx.hop_count >= config.layering_min_hops:
        score += 0.5
        reasons.append(
            f"Transaction is hop #{ctx.hop_count} in a chain "
            f"(minimum {config.layering_min_hops} hops for layering)"
        )

    # Amount degradation across hops
    if ctx.amount_at_source and ctx.amount_at_source > 0 and ctx.amount > 0:
        retention = ctx.amount / ctx.amount_at_source
        if retention < config.layering_max_amount_retention_pct:
            score += 0.3
            reasons.append(
                f"Amount retained is {retention:.0%} of source amount "
                f"(${ctx.amount_at_source:,.2f} → ${ctx.amount:,.2f})"
            )

    # Multiple intermediary counterparties
    total_counterparties = len(set(ctx.counterparties_received_from + ctx.counterparties_sent_to))
    if total_counterparties >= config.layering_min_hops:
        score += 0.2
        reasons.append(f"{total_counterparties} distinct counterparties in chain")

    return min(score, 1.0), reasons


# =============================================================================
# Composite typology classifier
# =============================================================================

DETECTORS = {
    Typology.STRUCTURING: detect_structuring,
    Typology.MULE_NETWORK: detect_mule_network,
    Typology.RAPID_MOVEMENT: detect_rapid_movement,
    Typology.SYNTHETIC_IDENTITY: detect_synthetic_identity,
    Typology.LAYERING: detect_layering,
}


def classify_typology(
    ctx: TypologyContext,
    config: TypologyConfig = DEFAULT_CONFIG,
) -> TypologyResult:
    """
    Classify a transaction into an AML typology.

    Runs all detectors, picks the highest-scoring typology as primary,
    and optionally assigns a secondary typology if another detector
    also scored above a minimum threshold.

    Args:
        ctx: Transaction context with all available metadata.
        config: Tunable thresholds for each detector.

    Returns:
        TypologyResult with primary typology, confidence, and reasons.
    """
    scores: dict[Typology, tuple[float, list[str]]] = {}

    for typology, detector in DETECTORS.items():
        score, reasons = detector(ctx, config)
        scores[typology] = (score, reasons)

    # Sort by score descending
    ranked = sorted(scores.items(), key=lambda x: x[1][0], reverse=True)

    best_typology, (best_score, best_reasons) = ranked[0]
    second_typology, (second_score, _) = ranked[1]

    # Minimum confidence to assign a typology
    min_confidence = 0.2
    if best_score < min_confidence:
        return TypologyResult(
            typology=Typology.UNCLASSIFIED,
            confidence=0.0,
            reasons=["No typology pattern detected with sufficient confidence"],
        )

    # Assign secondary if it also scores meaningfully
    secondary = None
    if second_score >= min_confidence and second_score >= best_score * 0.6:
        secondary = second_typology

    return TypologyResult(
        typology=best_typology,
        confidence=round(best_score, 3),
        reasons=best_reasons,
        secondary_typology=secondary,
    )


# =============================================================================
# Simplified taggers for bulk ingestion
# =============================================================================

def tag_by_amount_and_type(
    amount: float,
    transaction_type: str = "",
    is_fraud: bool = False,
) -> tuple[str, float]:
    """
    Quick typology tagging using only amount and transaction type.
    Used during bulk dataset ingestion when full context isn't available.

    Returns (typology_string, confidence).
    """
    # Structuring pattern
    if 9_000 <= amount < 10_000:
        return Typology.STRUCTURING.value, 0.5

    # Mule / rapid movement for transfers and cash-outs
    if transaction_type in ("TRANSFER", "CASH_OUT"):
        if is_fraud:
            if amount > 200_000:
                return Typology.LAYERING.value, 0.6
            else:
                return Typology.MULE_NETWORK.value, 0.5
        elif amount > 50_000:
            return Typology.RAPID_MOVEMENT.value, 0.3

    # High-value payments
    if amount > 10_000:
        if is_fraud:
            return Typology.LAYERING.value, 0.4
        return Typology.RAPID_MOVEMENT.value, 0.2

    # Fraud-labeled but no clear pattern
    if is_fraud:
        return Typology.MULE_NETWORK.value, 0.3

    return Typology.UNCLASSIFIED.value, 0.0


# =============================================================================
# CLI for testing
# =============================================================================

if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)

    # Test: Structuring pattern
    ctx1 = TypologyContext(
        transaction_id="TEST-STRUCT-001",
        account_id="ACCT-SMURF",
        amount=9_800.00,
        timestamp=datetime(2024, 6, 15, 14, 30),
        recent_amounts=[9_750.00, 9_900.00, 9_600.00],
        recent_timestamps=[
            datetime(2024, 6, 15, 10, 0),
            datetime(2024, 6, 15, 11, 0),
            datetime(2024, 6, 15, 13, 0),
        ],
    )
    result1 = classify_typology(ctx1)
    print(f"\nStructuring test: {result1}")
    for r in result1.reasons:
        print(f"  → {r}")

    # Test: Mule network
    ctx2 = TypologyContext(
        transaction_id="TEST-MULE-001",
        account_id="ACCT-MULE",
        amount=5_000.00,
        transaction_type="TRANSFER",
        is_outbound=True,
        time_since_last_credit_minutes=15.0,
        counterparties_received_from=["SRC-A", "SRC-B", "SRC-C"],
        counterparties_sent_to=["DEST-X"],
    )
    result2 = classify_typology(ctx2)
    print(f"\nMule network test: {result2}")
    for r in result2.reasons:
        print(f"  → {r}")

    # Test: Rapid movement
    ctx3 = TypologyContext(
        transaction_id="TEST-RAPID-001",
        account_id="ACCT-PASSTHRU",
        amount=15_000.00,
        is_outbound=True,
        time_since_last_credit_minutes=5.0,
        last_credit_amount=15_500.00,
    )
    result3 = classify_typology(ctx3)
    print(f"\nRapid movement test: {result3}")
    for r in result3.reasons:
        print(f"  → {r}")

    # Test: Benign transaction
    ctx4 = TypologyContext(
        transaction_id="TEST-BENIGN-001",
        account_id="ACCT-NORMAL",
        amount=150.00,
        transaction_type="PAYMENT",
    )
    result4 = classify_typology(ctx4)
    print(f"\nBenign test: {result4}")
    for r in result4.reasons:
        print(f"  → {r}")

    # Test: Bulk tagger
    print("\n--- Bulk tagger tests ---")
    for amt, typ, fraud in [
        (9_800, "PAYMENT", False),
        (50_000, "TRANSFER", True),
        (300_000, "TRANSFER", True),
        (150, "PAYMENT", False),
    ]:
        tag, conf = tag_by_amount_and_type(amt, typ, fraud)
        print(f"  amount=${amt:>10,.2f}  type={typ:<10}  fraud={fraud}  → {tag} (conf={conf:.2f})")
