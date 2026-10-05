"""
Fintel — Synthetic Mule-Network Attack Scenarios
======================================================
Person 2 (Cybersecurity / Fraud Data Layer)

Generates hand-crafted mule-network attack scenarios and inserts them into
the alerts, entities, and entity_edges tables. These are the GROUND-TRUTH
test cases that Person 3's graph agent must detect.

Scenarios:
    1. Classic Mule Chain     (4 accounts, linear flow)
    2. Fan-Out Ring           (6 accounts, fan-out + consolidation)
    3. Circular Layering      (4 accounts, round-trip cycle)
    4. Structuring + Mule     (5 accounts, sub-threshold deposits + consolidation)

Usage:
    python scripts/mule_scenarios.py [--db-url postgresql://...]
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)


# =============================================================================
# Data structures
# =============================================================================

@dataclass
class Account:
    """An account in a mule scenario."""
    id: str
    name: str
    role: str  # source | mule | collector | cashout

    def __post_init__(self):
        if not self.id:
            self.id = f"MULE-{uuid.uuid4().hex[:8].upper()}"


@dataclass
class Transaction:
    """A transaction in a mule scenario."""
    id: str
    source_account: Account
    dest_account: Account
    amount: float
    timestamp: datetime
    typology: str
    description: str = ""

    def __post_init__(self):
        if not self.id:
            self.id = f"MULE-TXN-{uuid.uuid4().hex[:8].upper()}"


@dataclass
class Scenario:
    """A complete mule-network attack scenario."""
    name: str
    description: str
    typology: str
    accounts: list[Account] = field(default_factory=list)
    transactions: list[Transaction] = field(default_factory=list)
    expected_detection: str = ""  # what Person 3's agent should find


# =============================================================================
# Scenario generators
# =============================================================================

def create_scenario_1_classic_chain() -> Scenario:
    """
    Scenario 1 — Classic Mule Chain (4 accounts)

    Dirty Source → Mule A → Mule B → Mule C → Cash-out
    $50,000 split into 5 × ~$9,800, each hop deducts 5-10% fee
    Delays: 1-4 hours between hops
    """
    base_time = datetime(2024, 6, 10, 9, 0)

    source = Account("MULE-SRC-001", "Dirty Source LLC", "source")
    mule_a = Account("MULE-A-001", "Mule Alpha", "mule")
    mule_b = Account("MULE-B-001", "Mule Bravo", "mule")
    mule_c = Account("MULE-C-001", "Mule Charlie", "mule")
    cashout = Account("MULE-CASH-001", "Cash-out Terminal", "cashout")

    accounts = [source, mule_a, mule_b, mule_c, cashout]

    transactions = []

    # Source → Mule A: 5 structured deposits of ~$9,800
    amounts = [9_800.00, 9_750.00, 9_850.00, 9_700.00, 9_900.00]
    for i, amt in enumerate(amounts):
        txn = Transaction(
            id=f"S1-SRC-A-{i+1:03d}",
            source_account=source,
            dest_account=mule_a,
            amount=amt,
            timestamp=base_time + timedelta(minutes=i * 20),
            typology="structuring",
            description=f"Structured deposit #{i+1}: ${amt:,.2f} from {source.name} to {mule_a.name}"
        )
        transactions.append(txn)

    # Mule A → Mule B: consolidated transfer minus 5% fee
    total_received = sum(amounts)
    fee_a = total_received * 0.05
    amt_a_to_b = total_received - fee_a

    transactions.append(Transaction(
        id="S1-A-B-001",
        source_account=mule_a,
        dest_account=mule_b,
        amount=round(amt_a_to_b, 2),
        timestamp=base_time + timedelta(hours=2),
        typology="mule_network",
        description=f"Mule A forwards ${amt_a_to_b:,.2f} to Mule B (kept ${fee_a:,.2f} fee)"
    ))

    # Mule B → Mule C: minus 7% fee
    fee_b = amt_a_to_b * 0.07
    amt_b_to_c = amt_a_to_b - fee_b

    transactions.append(Transaction(
        id="S1-B-C-001",
        source_account=mule_b,
        dest_account=mule_c,
        amount=round(amt_b_to_c, 2),
        timestamp=base_time + timedelta(hours=5),
        typology="mule_network",
        description=f"Mule B forwards ${amt_b_to_c:,.2f} to Mule C (kept ${fee_b:,.2f} fee)"
    ))

    # Mule C → Cash-out: minus 5% fee
    fee_c = amt_b_to_c * 0.05
    amt_c_to_cash = amt_b_to_c - fee_c

    transactions.append(Transaction(
        id="S1-C-CASH-001",
        source_account=mule_c,
        dest_account=cashout,
        amount=round(amt_c_to_cash, 2),
        timestamp=base_time + timedelta(hours=8),
        typology="mule_network",
        description=f"Mule C cashes out ${amt_c_to_cash:,.2f} (kept ${fee_c:,.2f} fee)"
    ))

    return Scenario(
        name="Classic Mule Chain",
        description=(
            "Linear chain of 4 accounts passing $50K through structuring "
            "and fee-deducting hops. Source deposits are structured below $10K threshold."
        ),
        typology="mule_network",
        accounts=accounts,
        transactions=transactions,
        expected_detection=(
            "Agent should detect the full chain: Source → A → B → C → Cash-out. "
            "Should flag structuring pattern at Source → A hop, and rapid movement "
            "at subsequent hops."
        ),
    )


def create_scenario_2_fanout_ring() -> Scenario:
    """
    Scenario 2 — Fan-Out Ring (6 accounts)

    Source → {Mule A, Mule B, Mule C} (fan-out, $15K each)
    {A, B, C} → Collector → Integration Point
    """
    base_time = datetime(2024, 6, 12, 10, 0)

    source = Account("MULE-SRC-002", "Offshore Wire Source", "source")
    mule_a = Account("MULE-FA-001", "Fan Mule Alpha", "mule")
    mule_b = Account("MULE-FB-001", "Fan Mule Bravo", "mule")
    mule_c = Account("MULE-FC-001", "Fan Mule Charlie", "mule")
    collector = Account("MULE-COLL-001", "Collector Account", "collector")
    integration = Account("MULE-INT-001", "Integration Business", "cashout")

    accounts = [source, mule_a, mule_b, mule_c, collector, integration]
    transactions = []

    # Source → Fan-out to 3 mules ($15K each)
    fan_targets = [(mule_a, 15_000.00), (mule_b, 15_200.00), (mule_c, 14_800.00)]
    for i, (mule, amt) in enumerate(fan_targets):
        transactions.append(Transaction(
            id=f"S2-SRC-{mule.id[-3:]}-001",
            source_account=source,
            dest_account=mule,
            amount=amt,
            timestamp=base_time + timedelta(minutes=i * 30),
            typology="layering",
            description=f"Fan-out: ${amt:,.2f} from {source.name} to {mule.name}"
        ))

    # Each mule → Collector (minus small fee, after delay)
    mule_to_collector = [
        (mule_a, 14_250.00, 3),
        (mule_b, 14_440.00, 4),
        (mule_c, 14_060.00, 5),
    ]
    for mule, amt, hour_delay in mule_to_collector:
        transactions.append(Transaction(
            id=f"S2-{mule.id[-3:]}-COLL-001",
            source_account=mule,
            dest_account=collector,
            amount=amt,
            timestamp=base_time + timedelta(hours=hour_delay),
            typology="mule_network",
            description=f"{mule.name} forwards ${amt:,.2f} to Collector"
        ))

    # Collector → Integration
    total_collected = sum(amt for _, amt, _ in mule_to_collector)
    transactions.append(Transaction(
        id="S2-COLL-INT-001",
        source_account=collector,
        dest_account=integration,
        amount=round(total_collected * 0.95, 2),
        timestamp=base_time + timedelta(hours=8),
        typology="layering",
        description=f"Collector sends ${total_collected * 0.95:,.2f} to Integration Business"
    ))

    return Scenario(
        name="Fan-Out Ring",
        description=(
            "Source distributes $45K across 3 mules (fan-out), who each forward "
            "to a single Collector that consolidates and moves to an Integration point."
        ),
        typology="mule_network",
        accounts=accounts,
        transactions=transactions,
        expected_detection=(
            "Agent should detect the fan-out pattern from Source to 3 mules, "
            "the consolidation at Collector, and the full ring. All 6 accounts "
            "should be linked in the entity graph."
        ),
    )


def create_scenario_3_circular_layering() -> Scenario:
    """
    Scenario 3 — Circular Layering (4 accounts)

    A → B → C → D → A (round-trip)
    Funds cycle to obscure origin, with small amounts each pass
    """
    base_time = datetime(2024, 6, 14, 8, 0)

    acct_a = Account("MULE-CIR-A-001", "Circle Node Alpha", "mule")
    acct_b = Account("MULE-CIR-B-001", "Circle Node Bravo", "mule")
    acct_c = Account("MULE-CIR-C-001", "Circle Node Charlie", "mule")
    acct_d = Account("MULE-CIR-D-001", "Circle Node Delta", "mule")

    accounts = [acct_a, acct_b, acct_c, acct_d]
    transactions = []

    # Round 1: A → B → C → D → A
    chain = [(acct_a, acct_b), (acct_b, acct_c), (acct_c, acct_d), (acct_d, acct_a)]
    amount = 25_000.00
    for round_num in range(2):  # 2 full cycles
        for hop, (src, dst) in enumerate(chain):
            fee_pct = 0.03 + (hop * 0.01)  # 3-6% per hop
            amt = round(amount * (1 - fee_pct), 2)

            transactions.append(Transaction(
                id=f"S3-R{round_num+1}-H{hop+1}-001",
                source_account=src,
                dest_account=dst,
                amount=amt,
                timestamp=base_time + timedelta(hours=round_num * 24 + hop * 3),
                typology="layering",
                description=(
                    f"Circular layering round {round_num+1}, hop {hop+1}: "
                    f"${amt:,.2f} from {src.name} to {dst.name}"
                )
            ))

            amount = amt  # Degrading amount through hops

    return Scenario(
        name="Circular Layering",
        description=(
            "4 accounts pass funds in a circle (A→B→C→D→A) over 2 full cycles. "
            "Each hop extracts a small fee, and the circular pattern obscures the "
            "original source of funds."
        ),
        typology="layering",
        accounts=accounts,
        transactions=transactions,
        expected_detection=(
            "Agent should detect the circular pattern: all 4 accounts are both senders "
            "and receivers. The cycle should be visible in the entity graph. "
            "Amount degradation across hops should be flagged."
        ),
    )


def create_scenario_4_structuring_mule_hybrid() -> Scenario:
    """
    Scenario 4 — Structuring + Mule Hybrid (5 accounts)

    Source makes 20 × $4,900 deposits across 4 mule accounts (sub-$5K threshold)
    Mules consolidate → single large withdrawal
    """
    base_time = datetime(2024, 6, 16, 7, 0)

    source = Account("MULE-SMRF-SRC-001", "Structuring Source", "source")
    mule_1 = Account("MULE-SMRF-M1-001", "Smurfing Mule 1", "mule")
    mule_2 = Account("MULE-SMRF-M2-001", "Smurfing Mule 2", "mule")
    mule_3 = Account("MULE-SMRF-M3-001", "Smurfing Mule 3", "mule")
    mule_4 = Account("MULE-SMRF-M4-001", "Smurfing Mule 4", "mule")
    consolidator = Account("MULE-SMRF-CON-001", "Consolidation Account", "collector")

    accounts = [source, mule_1, mule_2, mule_3, mule_4, consolidator]
    transactions = []

    # Source → 4 mules, 5 deposits each at ~$4,900
    mules = [mule_1, mule_2, mule_3, mule_4]
    deposit_idx = 0
    for mule_idx, mule in enumerate(mules):
        for dep in range(5):
            # Vary amounts slightly to avoid exact-match detection
            import random
            random.seed(42 + deposit_idx)
            amt = round(4_700 + random.random() * 250, 2)  # $4,700–$4,950

            transactions.append(Transaction(
                id=f"S4-SRC-M{mule_idx+1}-{dep+1:03d}",
                source_account=source,
                dest_account=mule,
                amount=amt,
                timestamp=base_time + timedelta(hours=deposit_idx * 2),
                typology="structuring",
                description=(
                    f"Structured deposit #{deposit_idx+1}: ${amt:,.2f} "
                    f"from {source.name} to {mule.name}"
                )
            ))
            deposit_idx += 1

    # Each mule → Consolidator (after 1-2 day delay)
    for mule_idx, mule in enumerate(mules):
        # Sum up the 5 deposits for this mule (approximate)
        mule_total = round(4_825 * 5 * 0.95, 2)  # Minus small fee

        transactions.append(Transaction(
            id=f"S4-M{mule_idx+1}-CON-001",
            source_account=mule,
            dest_account=consolidator,
            amount=mule_total,
            timestamp=base_time + timedelta(days=2, hours=mule_idx * 2),
            typology="mule_network",
            description=f"{mule.name} consolidates ${mule_total:,.2f} to Consolidation Account"
        ))

    return Scenario(
        name="Structuring + Mule Hybrid",
        description=(
            "Source distributes ~$98K across 4 mules through 20 structured deposits "
            "below $5K each. After a 2-day delay, mules consolidate into a single account. "
            "Combines structuring and mule-network typologies."
        ),
        typology="structuring",
        accounts=accounts,
        transactions=transactions,
        expected_detection=(
            "Agent should detect: (1) structuring pattern at Source → Mules deposits, "
            "(2) mule-network pattern at Mules → Consolidator, (3) all 6 accounts "
            "linked in entity graph. Should flag both typologies."
        ),
    )


# =============================================================================
# All scenarios
# =============================================================================

ALL_SCENARIOS = [
    create_scenario_1_classic_chain,
    create_scenario_2_fanout_ring,
    create_scenario_3_circular_layering,
    create_scenario_4_structuring_mule_hybrid,
]


def generate_all_scenarios() -> list[Scenario]:
    """Generate all mule-network attack scenarios."""
    return [factory() for factory in ALL_SCENARIOS]


# =============================================================================
# Convert to DB records
# =============================================================================

def scenario_to_alerts(scenario: Scenario) -> list[dict]:
    """Convert scenario transactions to alert records."""
    alerts = []
    for txn in scenario.transactions:
        raw_text = (
            f"[SCENARIO: {scenario.name}] {txn.description}. "
            f"Transfer of ${txn.amount:,.2f} from account {txn.source_account.id} "
            f"({txn.source_account.name}) to account {txn.dest_account.id} "
            f"({txn.dest_account.name}). "
            f"Typology: {txn.typology}."
        )

        # High risk score for all scenario transactions (they're all suspicious)
        risk_score = 0.75 if txn.typology == "mule_network" else 0.65

        alerts.append({
            "id": str(uuid.uuid4()),
            "raw_text": raw_text,
            "transaction_id": txn.id,
            "account_id": txn.source_account.id,
            "amount": txn.amount,
            "currency": "USD",
            "timestamp": txn.timestamp.isoformat(),
            "risk_score": risk_score,
            "typology": txn.typology,
            "status": "new",
            # Metadata for entity/edge creation
            "_source_account": txn.source_account.id,
            "_dest_account": txn.dest_account.id,
            "_source_role": txn.source_account.role,
            "_dest_role": txn.dest_account.role,
            "_scenario": scenario.name,
        })

    return alerts


def scenario_to_entities_and_edges(scenario: Scenario) -> tuple[list[dict], list[dict]]:
    """
    Convert scenario to entity and entity_edge records.
    Creates account entities and transacted_with edges.
    """
    entities = {}  # account_id → entity dict
    edges = []

    # Create entity for each account
    for acct in scenario.accounts:
        entity_id = str(uuid.uuid4())
        entities[acct.id] = {
            "id": entity_id,
            "alert_id": None,  # Will be linked to the first alert for this account
            "entity_type": "account",
            "entity_value": acct.id,
            "confidence": 1.0,  # Ground truth = 100% confidence
        }

    # Create edges from transactions
    for txn in scenario.transactions:
        src_entity = entities.get(txn.source_account.id)
        dst_entity = entities.get(txn.dest_account.id)

        if src_entity and dst_entity:
            edges.append({
                "id": str(uuid.uuid4()),
                "source_entity_id": src_entity["id"],
                "target_entity_id": dst_entity["id"],
                "relationship": "transacted_with",
                "weight": txn.amount / 10_000.0,  # Normalize weight by amount
            })

    return list(entities.values()), edges


# =============================================================================
# Database insertion
# =============================================================================

def insert_scenario_to_db(
    scenario: Scenario, db_url: str
) -> dict[str, int]:
    """Insert a complete scenario into the database."""
    try:
        import psycopg2
        from psycopg2.extras import execute_values
    except ImportError:
        logger.error("psycopg2 not installed. Run: pip install psycopg2-binary")
        return {"alerts": 0, "entities": 0, "edges": 0}

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    counts = {"alerts": 0, "entities": 0, "edges": 0}

    try:
        # Insert alerts
        alerts = scenario_to_alerts(scenario)
        if alerts:
            alert_sql = """
                INSERT INTO alerts (id, raw_text, transaction_id, account_id, amount,
                    currency, timestamp, risk_score, typology, status)
                VALUES %s ON CONFLICT DO NOTHING
            """
            alert_values = [
                (a["id"], a["raw_text"], a["transaction_id"], a["account_id"],
                 a["amount"], a["currency"], a["timestamp"], a["risk_score"],
                 a["typology"], a["status"])
                for a in alerts
            ]
            execute_values(cur, alert_sql, alert_values)
            counts["alerts"] = len(alerts)

            # Link entities to first alert for each account
            alert_by_account = {}
            for a in alerts:
                acct = a["account_id"]
                if acct not in alert_by_account:
                    alert_by_account[acct] = a["id"]

        # Insert entities
        entities, edges = scenario_to_entities_and_edges(scenario)

        if entities:
            # Update alert_id references
            alert_by_account_val = {}
            for a in alerts:
                acct = a.get("_source_account", a["account_id"])
                if acct not in alert_by_account_val:
                    alert_by_account_val[acct] = a["id"]

            for entity in entities:
                entity["alert_id"] = alert_by_account_val.get(entity["entity_value"])

            entity_sql = """
                INSERT INTO entities (id, alert_id, entity_type, entity_value, confidence)
                VALUES %s ON CONFLICT DO NOTHING
            """
            entity_values = [
                (e["id"], e["alert_id"], e["entity_type"], e["entity_value"], e["confidence"])
                for e in entities
            ]
            execute_values(cur, entity_sql, entity_values)
            counts["entities"] = len(entities)

        # Insert edges
        if edges:
            edge_sql = """
                INSERT INTO entity_edges (id, source_entity_id, target_entity_id, relationship, weight)
                VALUES %s ON CONFLICT DO NOTHING
            """
            edge_values = [
                (e["id"], e["source_entity_id"], e["target_entity_id"],
                 e["relationship"], e["weight"])
                for e in edges
            ]
            execute_values(cur, edge_sql, edge_values)
            counts["edges"] = len(edges)

        conn.commit()
        logger.info(
            "Scenario '%s': inserted %d alerts, %d entities, %d edges",
            scenario.name, counts["alerts"], counts["entities"], counts["edges"]
        )

    except Exception as e:
        conn.rollback()
        logger.error("Failed to insert scenario '%s': %s", scenario.name, e)
        raise
    finally:
        cur.close()
        conn.close()

    return counts


# =============================================================================
# Export
# =============================================================================

def export_scenarios_to_json(scenarios: list[Scenario], output_path: str) -> None:
    """Export all scenarios to a JSON file for documentation/review."""
    data = []
    for s in scenarios:
        data.append({
            "name": s.name,
            "description": s.description,
            "typology": s.typology,
            "expected_detection": s.expected_detection,
            "num_accounts": len(s.accounts),
            "num_transactions": len(s.transactions),
            "accounts": [{"id": a.id, "name": a.name, "role": a.role} for a in s.accounts],
            "transactions": [
                {
                    "id": t.id,
                    "source": t.source_account.id,
                    "dest": t.dest_account.id,
                    "amount": t.amount,
                    "timestamp": t.timestamp.isoformat(),
                    "typology": t.typology,
                    "description": t.description,
                }
                for t in s.transactions
            ],
        })

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)

    logger.info("Exported %d scenarios to %s", len(scenarios), output_path)


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Generate mule-network attack scenarios")
    parser.add_argument("--output", type=str, default="data/generated/mule_scenarios.json",
                        help="Output JSON path")
    parser.add_argument("--db-url", type=str, default=None,
                        help="Database URL (if set, inserts into DB)")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s"
    )

    project_root = Path(__file__).parent.parent

    # Generate all scenarios
    scenarios = generate_all_scenarios()

    total_accounts = sum(len(s.accounts) for s in scenarios)
    total_txns = sum(len(s.transactions) for s in scenarios)
    total_amount = sum(t.amount for s in scenarios for t in s.transactions)

    print(f"\n🕵️  Generated {len(scenarios)} Mule-Network Attack Scenarios")
    print(f"   Total accounts: {total_accounts}")
    print(f"   Total transactions: {total_txns}")
    print(f"   Total amount: ${total_amount:,.2f}")
    print()

    for s in scenarios:
        s_amount = sum(t.amount for t in s.transactions)
        print(f"   📋 {s.name}")
        print(f"      Typology: {s.typology}")
        print(f"      Accounts: {len(s.accounts)}, Transactions: {len(s.transactions)}")
        print(f"      Total flow: ${s_amount:,.2f}")
        print(f"      Detection: {s.expected_detection[:80]}...")
        print()

    # Export to JSON
    output_path = project_root / args.output
    export_scenarios_to_json(scenarios, str(output_path))
    print(f"   📄 Scenarios exported to: {output_path}")

    # Insert into DB
    db_url = args.db_url or os.environ.get("DATABASE_URL")
    if not db_url:
        env_path = project_root / ".env"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.strip().startswith("DATABASE_URL="):
                    db_url = line.strip().split("=", 1)[1].strip()
                    break
    if db_url:
        try:
            total_counts = {"alerts": 0, "entities": 0, "edges": 0}
            for scenario in scenarios:
                counts = insert_scenario_to_db(scenario, db_url)
                for k in total_counts:
                    total_counts[k] += counts[k]

            print(f"\n✅ Inserted into database:")
            print(f"   Alerts: {total_counts['alerts']}")
            print(f"   Entities: {total_counts['entities']}")
            print(f"   Entity edges: {total_counts['edges']}")
        except Exception as e:
            logger.warning("DB insert failed: %s", e)
            print(f"\n⚠️  DB insert failed — scenarios exported to JSON instead")
    else:
        print(f"\n   ℹ️  No DATABASE_URL set — skipping DB insertion")
        print(f"       Set DATABASE_URL or use --db-url to insert into database")


if __name__ == "__main__":
    main()
