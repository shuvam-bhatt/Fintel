"""
Fintel — Ground Truth Exporter
=====================================
Person 2 (Cybersecurity / Fraud Data Layer)

Exports ground-truth labels for evaluation metrics (Section 9 of spec).
Generates a CSV mapping alert_id → expected_typology, is_fraud, expected_linked_accounts
for the evaluation suite.

Can operate in two modes:
    1. From database: reads alerts + mule scenario data from PostgreSQL
    2. From files: reads generated CSVs and scenario JSON

Usage:
    python scripts/ground_truth.py [--mode db|file]
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import sys
from pathlib import Path

logger = logging.getLogger(__name__)


# =============================================================================
# Ground truth record
# =============================================================================

GROUND_TRUTH_FIELDS = [
    "alert_id",
    "transaction_id",
    "account_id",
    "amount",
    "typology",
    "is_fraud",
    "risk_score",
    "scenario_name",        # which mule scenario (if any)
    "expected_linked_accounts",  # comma-separated list of accounts that should be linked
    "expected_detection_notes",
]


# =============================================================================
# Mode 1: Export from database
# =============================================================================

def export_from_db(db_url: str, output_path: str) -> int:
    """Export ground truth from database."""
    try:
        import psycopg2
        from psycopg2.extras import RealDictCursor
    except ImportError:
        logger.error("psycopg2 not installed. Run: pip install psycopg2-binary")
        return 0

    conn = psycopg2.connect(db_url)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Get all alerts with high risk scores or known typologies
    cur.execute("""
        SELECT
            a.id as alert_id,
            a.transaction_id,
            a.account_id,
            a.amount,
            a.typology,
            a.risk_score,
            CASE WHEN a.risk_score > 0.5 THEN true ELSE false END as is_fraud
        FROM alerts a
        WHERE a.risk_score > 0.3
           OR a.typology != 'unclassified'
        ORDER BY a.risk_score DESC
    """)
    alerts = cur.fetchall()

    # Get linked accounts from entity_edges for mule scenarios
    cur.execute("""
        SELECT
            e1.entity_value as source_account,
            e2.entity_value as dest_account,
            ee.relationship,
            ee.weight
        FROM entity_edges ee
        JOIN entities e1 ON ee.source_entity_id = e1.id
        JOIN entities e2 ON ee.target_entity_id = e2.id
        WHERE e1.entity_type = 'account' AND e2.entity_type = 'account'
    """)
    edges = cur.fetchall()

    # Build linked-accounts map
    account_links = {}
    for edge in edges:
        src = edge["source_account"]
        dst = edge["dest_account"]
        if src not in account_links:
            account_links[src] = set()
        if dst not in account_links:
            account_links[dst] = set()
        account_links[src].add(dst)
        account_links[dst].add(src)

    cur.close()
    conn.close()

    # Write ground truth CSV
    rows = []
    for alert in alerts:
        acct = alert["account_id"]
        linked = account_links.get(acct, set())

        # Determine if this is from a mule scenario
        txn_id = alert["transaction_id"] or ""
        scenario_name = ""
        if txn_id.startswith("S1-"):
            scenario_name = "Classic Mule Chain"
        elif txn_id.startswith("S2-"):
            scenario_name = "Fan-Out Ring"
        elif txn_id.startswith("S3-"):
            scenario_name = "Circular Layering"
        elif txn_id.startswith("S4-"):
            scenario_name = "Structuring + Mule Hybrid"

        rows.append({
            "alert_id": alert["alert_id"],
            "transaction_id": alert["transaction_id"],
            "account_id": acct,
            "amount": alert["amount"],
            "typology": alert["typology"],
            "is_fraud": alert["is_fraud"],
            "risk_score": alert["risk_score"],
            "scenario_name": scenario_name,
            "expected_linked_accounts": ",".join(sorted(linked)),
            "expected_detection_notes": f"Typology: {alert['typology']}, Scenario: {scenario_name or 'dataset'}"
        })

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=GROUND_TRUTH_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    logger.info("Exported %d ground truth records to %s", len(rows), output_path)
    return len(rows)


# =============================================================================
# Mode 2: Export from generated files
# =============================================================================

def export_from_files(data_dir: str, output_path: str) -> int:
    """Export ground truth from generated CSVs and scenario JSON."""
    project_root = Path(__file__).parent.parent
    gen_dir = project_root / data_dir

    rows = []

    # Load mule scenarios
    scenario_path = gen_dir / "mule_scenarios.json"
    if scenario_path.exists():
        with open(scenario_path) as f:
            scenarios = json.load(f)

        for scenario in scenarios:
            # Collect all account IDs in this scenario
            all_accounts = [a["id"] for a in scenario["accounts"]]
            linked_str = ",".join(sorted(all_accounts))

            for txn in scenario["transactions"]:
                rows.append({
                    "alert_id": "",  # No DB ID available
                    "transaction_id": txn["id"],
                    "account_id": txn["source"],
                    "amount": txn["amount"],
                    "typology": txn["typology"],
                    "is_fraud": True,
                    "risk_score": 0.75,
                    "scenario_name": scenario["name"],
                    "expected_linked_accounts": linked_str,
                    "expected_detection_notes": scenario["expected_detection"],
                })

        logger.info("Loaded %d scenario transactions", len(rows))

    # Load PaySim ground truth (fraud-labeled transactions)
    paysim_path = gen_dir / "paysim_alerts.csv"
    if paysim_path.exists():
        with open(paysim_path) as f:
            reader = csv.DictReader(f)
            for row in reader:
                is_fraud = row.get("_is_fraud", "0")
                if str(is_fraud) == "1":
                    rows.append({
                        "alert_id": row.get("id", ""),
                        "transaction_id": row.get("transaction_id", ""),
                        "account_id": row.get("account_id", ""),
                        "amount": row.get("amount", 0),
                        "typology": row.get("typology", "unclassified"),
                        "is_fraud": True,
                        "risk_score": row.get("risk_score", 0),
                        "scenario_name": "PaySim Dataset",
                        "expected_linked_accounts": row.get("_dest_account", ""),
                        "expected_detection_notes": f"PaySim fraud, type={row.get('_txn_type', '')}",
                    })

        logger.info("Loaded PaySim fraud labels")

    # Load IEEE-CIS ground truth
    ieee_path = gen_dir / "ieee_cis_alerts.csv"
    if ieee_path.exists():
        with open(ieee_path) as f:
            reader = csv.DictReader(f)
            fraud_count = 0
            for row in reader:
                risk = float(row.get("risk_score", 0))
                if risk > 0.5:  # High-risk = likely fraud
                    rows.append({
                        "alert_id": row.get("id", ""),
                        "transaction_id": row.get("transaction_id", ""),
                        "account_id": row.get("account_id", ""),
                        "amount": row.get("amount", 0),
                        "typology": row.get("typology", "unclassified"),
                        "is_fraud": True,
                        "risk_score": risk,
                        "scenario_name": "IEEE-CIS Dataset",
                        "expected_linked_accounts": "",
                        "expected_detection_notes": f"IEEE-CIS fraud, risk_score={risk}",
                    })
                    fraud_count += 1

        logger.info("Loaded %d IEEE-CIS high-risk records", fraud_count)

    # Write ground truth
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=GROUND_TRUTH_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    logger.info("Exported %d total ground truth records to %s", len(rows), output_path)
    return len(rows)


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Export ground truth labels for evaluation")
    parser.add_argument("--mode", choices=["db", "file"], default="file",
                        help="Export mode: 'db' reads from PostgreSQL, 'file' reads from generated CSVs")
    parser.add_argument("--output", type=str, default="data/ground_truth.csv",
                        help="Output CSV path")
    parser.add_argument("--data-dir", type=str, default="data/generated",
                        help="Directory with generated CSVs (for file mode)")
    parser.add_argument("--db-url", type=str, default=None,
                        help="Database URL (for db mode)")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s"
    )

    project_root = Path(__file__).parent.parent
    output_path = project_root / args.output

    if args.mode == "db":
        db_url = args.db_url or os.environ.get("DATABASE_URL")
        if not db_url:
            env_path = project_root / ".env"
            if env_path.exists():
                for line in env_path.read_text().splitlines():
                    if line.strip().startswith("DATABASE_URL="):
                        db_url = line.strip().split("=", 1)[1].strip()
                        break
        if not db_url:
            logger.error("DATABASE_URL required for db mode. Set env var or use --db-url")
            sys.exit(1)
        count = export_from_db(db_url, str(output_path))
    else:
        count = export_from_files(args.data_dir, str(output_path))

    print(f"\n✅ Ground Truth Export Complete")
    print(f"   Records: {count}")
    print(f"   Output: {output_path}")
    print(f"   Mode: {args.mode}")


if __name__ == "__main__":
    main()
