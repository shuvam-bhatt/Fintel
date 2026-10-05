"""
Fintel — PaySim Dataset Loader
====================================
Person 2 (Cybersecurity / Fraud Data Layer)

Loads the PaySim synthetic mobile money dataset into the `alerts` table.
Focuses on TRANSFER and CASH_OUT transaction types where fraud actually
occurs in the dataset.

Prerequisites:
    1. Download from: https://www.kaggle.com/datasets/ealaxi/paysim1
    2. Place the CSV (PS_20174392719_*.csv) in data/raw/
       OR rename it to data/raw/paysim.csv
    3. Database must be running (docker compose up db)

Usage:
    python scripts/load_paysim.py [--limit 10000] [--batch-size 500]
"""

from __future__ import annotations

import argparse
import csv
import logging
import os
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)

# Add parent dir to path for imports
sys.path.insert(0, os.path.dirname(__file__))
from risk_engine import score_amount_only
from typology_tagger import tag_by_amount_and_type


# =============================================================================
# Configuration
# =============================================================================

# Reference start timestamp for the 30-day simulation
SIMULATION_START = datetime(2024, 1, 1)

# Transaction types in PaySim
# Fraud only occurs in TRANSFER and CASH_OUT types
FRAUD_TYPES = {"TRANSFER", "CASH_OUT"}

# Transaction type descriptions for narrative generation
TYPE_DESCRIPTIONS = {
    "CASH_IN": "cash deposit",
    "CASH_OUT": "cash withdrawal",
    "DEBIT": "debit payment",
    "PAYMENT": "merchant payment",
    "TRANSFER": "account-to-account transfer",
}


# =============================================================================
# Raw text narrative generation
# =============================================================================

def generate_raw_text(row: dict) -> str:
    """
    Generate a human-readable raw_text narrative from PaySim fields.
    This is what the NLP pipeline (Person 4) will process.
    """
    parts = []

    txn_type = row.get("type", "UNKNOWN")
    type_desc = TYPE_DESCRIPTIONS.get(txn_type, f"'{txn_type}' transaction")
    amount = float(row.get("amount", 0))
    name_orig = row.get("nameOrig", "unknown")
    name_dest = row.get("nameDest", "unknown")

    parts.append(f"Mobile money {type_desc} of ${amount:,.2f}.")
    parts.append(f"Initiated by account {name_orig}.")

    if name_dest.startswith("M"):
        parts.append(f"Recipient: merchant {name_dest}.")
    else:
        parts.append(f"Recipient account: {name_dest}.")

    # Balance information (reveals anomalies)
    old_balance_orig = float(row.get("oldbalanceOrg", 0))
    new_balance_orig = float(row.get("newbalanceOrig", 0))
    old_balance_dest = float(row.get("oldbalanceDest", 0))
    new_balance_dest = float(row.get("newbalanceDest", 0))

    balance_change_orig = new_balance_orig - old_balance_orig
    parts.append(
        f"Sender balance: ${old_balance_orig:,.2f} → ${new_balance_orig:,.2f} "
        f"(change: ${balance_change_orig:,.2f})."
    )

    # Anomaly detection in narrative
    if old_balance_orig == 0 and amount > 0:
        parts.append("NOTE: Sender had zero balance before this transaction.")

    if txn_type in ("TRANSFER", "CASH_OUT") and new_balance_orig == 0:
        parts.append("NOTE: Sender account fully emptied after this transaction.")

    if new_balance_dest == 0 and old_balance_dest == 0 and txn_type == "TRANSFER":
        parts.append("NOTE: Recipient balance unchanged despite incoming transfer — possible data anomaly.")

    # Fraud flags
    is_fraud = int(row.get("isFraud", 0))
    is_flagged = int(row.get("isFlaggedFraud", 0))
    if is_fraud:
        parts.append("ALERT: Transaction identified as fraudulent.")
    if is_flagged:
        parts.append(f"SYSTEM FLAG: Amount exceeds automated flagging threshold (>${200_000:,}).")

    return " ".join(parts)


# =============================================================================
# Data loading
# =============================================================================

def find_paysim_file(data_dir: Path) -> Path | None:
    """Find the PaySim CSV file (handles the long default filename)."""
    # Check simple name first
    simple = data_dir / "paysim.csv"
    if simple.exists():
        return simple

    # Search for the default long filename
    for f in data_dir.iterdir() if data_dir.exists() else []:
        if f.name.startswith("PS_") and f.suffix == ".csv":
            return f

    return None


def process_paysim(
    csv_path: str,
    limit: int | None = None,
    include_non_fraud_types: bool = True,
) -> list[dict]:
    """
    Process PaySim dataset into alert records.

    By default includes all transaction types, but focuses scoring/tagging
    on TRANSFER and CASH_OUT where fraud occurs.
    """
    alerts = []
    fraud_count = 0
    total = 0

    logger.info("Processing PaySim transactions from %s ...", csv_path)

    with open(csv_path, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if limit and total >= limit:
                break

            txn_type = row.get("type", "")

            # Optionally filter to fraud-relevant types only
            if not include_non_fraud_types and txn_type not in FRAUD_TYPES:
                continue

            try:
                amount = float(row.get("amount", 0))
                step = int(row.get("step", 0))
                is_fraud = int(row.get("isFraud", 0))
                is_flagged = int(row.get("isFlaggedFraud", 0))
            except (ValueError, TypeError):
                continue

            # Convert step (hours) to timestamp
            timestamp = SIMULATION_START + timedelta(hours=step)

            # Account IDs
            name_orig = row.get("nameOrig", f"UNKNOWN-{total}")
            name_dest = row.get("nameDest", f"UNKNOWN-DEST-{total}")

            # Generate raw text
            raw_text = generate_raw_text(row)

            # Risk scoring
            risk_score = score_amount_only(amount)
            if is_fraud:
                risk_score = min(1.0, risk_score + 0.40)
            elif is_flagged:
                risk_score = min(1.0, risk_score + 0.25)

            # Typology tagging
            typology, _ = tag_by_amount_and_type(amount, txn_type, bool(is_fraud))

            alert = {
                "id": str(uuid.uuid4()),
                "raw_text": raw_text,
                "transaction_id": f"PSIM-{name_orig}-{step}-{total}",
                "account_id": name_orig,
                "amount": amount,
                "currency": "USD",
                "timestamp": timestamp.isoformat(),
                "risk_score": risk_score,
                "typology": typology,
                "status": "new",
                # Extra metadata for ground truth (not stored in DB)
                "_dest_account": name_dest,
                "_txn_type": txn_type,
                "_is_fraud": is_fraud,
                "_is_flagged": is_flagged,
            }
            alerts.append(alert)
            total += 1

            if is_fraud:
                fraud_count += 1

    logger.info(
        "Processed %d PaySim transactions (%d fraudulent, %.1f%% fraud rate)",
        total, fraud_count, (fraud_count / total * 100) if total else 0
    )
    return alerts


# =============================================================================
# Database insertion
# =============================================================================

def insert_alerts_to_db(alerts: list[dict], db_url: str, batch_size: int = 500) -> int:
    """Bulk insert alerts into the database."""
    try:
        import psycopg2
        from psycopg2.extras import execute_values
    except ImportError:
        logger.error("psycopg2 not installed. Run: pip install psycopg2-binary")
        return 0

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    sql = """
        INSERT INTO alerts (
            id, raw_text, transaction_id, account_id, amount,
            currency, timestamp, risk_score, typology, status
        ) VALUES %s
        ON CONFLICT DO NOTHING
    """

    total_inserted = 0
    # Strip internal metadata fields before insert
    db_fields = ["id", "raw_text", "transaction_id", "account_id", "amount",
                 "currency", "timestamp", "risk_score", "typology", "status"]

    for i in range(0, len(alerts), batch_size):
        batch = alerts[i:i + batch_size]
        values = [tuple(a[f] for f in db_fields) for a in batch]

        try:
            execute_values(cur, sql, values, page_size=batch_size)
            conn.commit()
            total_inserted += len(batch)
            if (i // batch_size) % 20 == 0:
                logger.info("Inserted %d / %d alerts...", total_inserted, len(alerts))
        except Exception as e:
            conn.rollback()
            logger.error("Batch insert failed at offset %d: %s", i, e)

    cur.close()
    conn.close()
    logger.info("Total inserted: %d alerts", total_inserted)
    return total_inserted


# =============================================================================
# CSV export
# =============================================================================

def export_alerts_to_csv(alerts: list[dict], output_path: str) -> None:
    """Export processed alerts to CSV (excluding internal metadata)."""
    if not alerts:
        return

    db_fields = ["id", "raw_text", "transaction_id", "account_id", "amount",
                 "currency", "timestamp", "risk_score", "typology", "status"]
    # Also include ground truth fields for evaluation
    extra_fields = ["_dest_account", "_txn_type", "_is_fraud", "_is_flagged"]
    all_fields = db_fields + extra_fields

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=all_fields, extrasaction="ignore")
        writer.writeheader()
        for alert in alerts:
            writer.writerow({k: alert.get(k, "") for k in all_fields})

    logger.info("Exported %d alerts to %s", len(alerts), output_path)


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Load PaySim dataset")
    parser.add_argument("--data-dir", type=str, default="data/raw",
                        help="Directory containing PaySim CSV")
    parser.add_argument("--limit", type=int, default=None,
                        help="Max transactions to load (None = all)")
    parser.add_argument("--batch-size", type=int, default=500,
                        help="DB insertion batch size")
    parser.add_argument("--output", type=str, default="data/generated/paysim_alerts.csv",
                        help="Output CSV path")
    parser.add_argument("--fraud-only", action="store_true",
                        help="Only load TRANSFER and CASH_OUT types")
    parser.add_argument("--db-url", type=str, default=None,
                        help="Database URL")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s"
    )

    project_root = Path(__file__).parent.parent
    data_dir = project_root / args.data_dir

    csv_path = find_paysim_file(data_dir)
    if not csv_path:
        logger.error(
            "PaySim CSV not found in %s\n"
            "Download from: https://www.kaggle.com/datasets/ealaxi/paysim1\n"
            "Place the CSV in %s (or rename to paysim.csv)",
            data_dir, data_dir
        )
        sys.exit(1)

    # Process dataset
    alerts = process_paysim(
        str(csv_path),
        limit=args.limit,
        include_non_fraud_types=not args.fraud_only,
    )

    if not alerts:
        logger.error("No alerts generated — check your dataset file")
        sys.exit(1)

    # Always export CSV
    output_path = project_root / args.output
    export_alerts_to_csv(alerts, str(output_path))

    # Insert into DB if configured
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
            inserted = insert_alerts_to_db(alerts, db_url, args.batch_size)
            print(f"\n✅ Loaded {inserted} PaySim alerts into database")
        except Exception as e:
            logger.warning("DB insert failed (is it running?): %s", e)
            print(f"\n⚠️  DB insert failed — alerts exported to CSV instead")
    else:
        logger.info("No DATABASE_URL set — skipping DB insertion")

    # Summary
    typology_counts = {}
    fraud_count = sum(1 for a in alerts if a.get("_is_fraud"))
    type_counts = {}
    for a in alerts:
        typology_counts[a["typology"]] = typology_counts.get(a["typology"], 0) + 1
        t = a.get("_txn_type", "?")
        type_counts[t] = type_counts.get(t, 0) + 1

    print(f"\n📊 PaySim Dataset Summary:")
    print(f"   Total alerts: {len(alerts)}")
    print(f"   Fraudulent: {fraud_count} ({fraud_count / len(alerts) * 100:.2f}%)")
    print(f"   Transaction types:")
    for t, c in sorted(type_counts.items()):
        print(f"     • {t}: {c}")
    print(f"   Typology distribution:")
    for typ, count in sorted(typology_counts.items()):
        print(f"     • {typ}: {count}")
    print(f"   Output CSV: {output_path}")


if __name__ == "__main__":
    main()
