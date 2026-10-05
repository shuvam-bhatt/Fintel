"""
Fintel — IEEE-CIS Fraud Detection Dataset Loader
======================================================
Person 2 (Cybersecurity / Fraud Data Layer)

Loads the IEEE-CIS Fraud Detection dataset (from Kaggle) into the `alerts` table.
Joins transaction + identity tables, synthesizes account IDs, generates raw_text
narratives, and applies risk scoring + typology tagging.

Prerequisites:
    1. Download from: https://www.kaggle.com/c/ieee-fraud-detection/data
    2. Place train_transaction.csv and train_identity.csv in data/raw/
    3. Database must be running (docker compose up db)

Usage:
    python scripts/load_ieee_cis.py [--limit 10000] [--batch-size 500]
"""

from __future__ import annotations

import argparse
import csv
import hashlib
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

# Reference timestamp for IEEE-CIS (TransactionDT is a timedelta from this)
# The dataset doesn't specify the exact reference; Dec 2017 is commonly used
REFERENCE_TIMESTAMP = datetime(2017, 12, 1)

# Product code descriptions for narrative generation
PRODUCT_CODE_MAP = {
    "W": "digital product purchase",
    "H": "high-value electronics",
    "C": "standard consumer goods",
    "S": "subscription service",
    "R": "recurring payment",
}


# =============================================================================
# Raw text narrative generation
# =============================================================================

def generate_raw_text(row: dict, identity: dict | None = None) -> str:
    """
    Generate a human-readable raw_text narrative from IEEE-CIS transaction fields.
    This is what the NLP pipeline (Person 4) will process for entity extraction.
    """
    parts = []

    # Transaction basics
    amount = float(row.get("TransactionAMT", 0))
    product = row.get("ProductCD", "unknown")
    product_desc = PRODUCT_CODE_MAP.get(product, f"product category '{product}'")

    parts.append(
        f"Transaction of ${amount:,.2f} USD for {product_desc}."
    )

    # Card information
    card_type = row.get("card4", "")
    card_category = row.get("card6", "")
    if card_type or card_category:
        card_info = " ".join(filter(None, [card_type, card_category])).strip()
        parts.append(f"Payment via {card_info} card.")

    # Email domains
    p_email = row.get("P_emaildomain", "")
    r_email = row.get("R_emaildomain", "")
    if p_email:
        parts.append(f"Purchaser email domain: {p_email}.")
    if r_email:
        parts.append(f"Recipient email domain: {r_email}.")

    # Address info
    addr1 = row.get("addr1", "")
    addr2 = row.get("addr2", "")
    if addr1:
        parts.append(f"Billing region code: {addr1}.")
    if addr2:
        parts.append(f"Billing country code: {addr2}.")

    # Device/identity information
    if identity:
        device_type = identity.get("DeviceType", "")
        device_info = identity.get("DeviceInfo", "")
        if device_type:
            parts.append(f"Device type: {device_type}.")
        if device_info:
            parts.append(f"Device: {device_info}.")

    # Fraud indicator
    is_fraud = int(row.get("isFraud", 0))
    if is_fraud:
        parts.append("ALERT: This transaction has been flagged as fraudulent.")

    return " ".join(parts)


# =============================================================================
# Account ID synthesis
# =============================================================================

def synthesize_account_id(row: dict) -> str:
    """
    Create a deterministic account ID from card columns.
    Cards with the same card1+card2+card3 combination represent the same account.
    """
    card_key = f"{row.get('card1', '')}-{row.get('card2', '')}-{row.get('card3', '')}"
    return f"IEEE-{hashlib.md5(card_key.encode()).hexdigest()[:12]}"


# =============================================================================
# Data loading
# =============================================================================

def load_identity_map(identity_path: str) -> dict[str, dict]:
    """Load identity data into a lookup dict keyed by TransactionID."""
    if not os.path.exists(identity_path):
        logger.warning("Identity file not found: %s (proceeding without identity data)", identity_path)
        return {}

    identity_map = {}
    with open(identity_path, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            txn_id = row.get("TransactionID", "")
            if txn_id:
                identity_map[txn_id] = row

    logger.info("Loaded %d identity records", len(identity_map))
    return identity_map


def process_ieee_cis(
    transaction_path: str,
    identity_path: str,
    limit: int | None = None,
) -> list[dict]:
    """
    Process IEEE-CIS dataset into alert records ready for DB insertion.

    Returns a list of dicts matching the alerts table schema.
    """
    identity_map = load_identity_map(identity_path)
    alerts = []
    fraud_count = 0
    total = 0

    logger.info("Processing IEEE-CIS transactions from %s ...", transaction_path)

    with open(transaction_path, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if limit and total >= limit:
                break

            txn_id = row.get("TransactionID", "")
            amount_str = row.get("TransactionAMT", "0")
            is_fraud = int(row.get("isFraud", 0))

            try:
                amount = float(amount_str)
            except (ValueError, TypeError):
                continue

            # Calculate timestamp from TransactionDT
            try:
                dt_seconds = int(float(row.get("TransactionDT", 0)))
                timestamp = REFERENCE_TIMESTAMP + timedelta(seconds=dt_seconds)
            except (ValueError, TypeError):
                timestamp = REFERENCE_TIMESTAMP

            # Get identity data if available
            identity = identity_map.get(txn_id)

            # Synthesize account ID
            account_id = synthesize_account_id(row)

            # Generate raw text narrative
            raw_text = generate_raw_text(row, identity)

            # Risk scoring (amount-only for bulk load)
            risk_score = score_amount_only(amount)
            # Boost score for known-fraud transactions
            if is_fraud:
                risk_score = min(1.0, risk_score + 0.35)

            # Typology tagging
            typology, _ = tag_by_amount_and_type(amount, "", is_fraud)

            alert = {
                "id": str(uuid.uuid4()),
                "raw_text": raw_text,
                "transaction_id": f"IEEE-{txn_id}",
                "account_id": account_id,
                "amount": amount,
                "currency": "USD",
                "timestamp": timestamp.isoformat(),
                "risk_score": risk_score,
                "typology": typology,
                "status": "new",
            }
            alerts.append(alert)
            total += 1

            if is_fraud:
                fraud_count += 1

    logger.info(
        "Processed %d IEEE-CIS transactions (%d fraudulent, %.1f%% fraud rate)",
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

    for i in range(0, len(alerts), batch_size):
        batch = alerts[i:i + batch_size]
        values = [
            (
                a["id"], a["raw_text"], a["transaction_id"], a["account_id"],
                a["amount"], a["currency"], a["timestamp"], a["risk_score"],
                a["typology"], a["status"],
            )
            for a in batch
        ]

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
# CSV export (fallback)
# =============================================================================

def export_alerts_to_csv(alerts: list[dict], output_path: str) -> None:
    """Export processed alerts to CSV."""
    if not alerts:
        return

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    fieldnames = list(alerts[0].keys())
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(alerts)
    logger.info("Exported %d alerts to %s", len(alerts), output_path)


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Load IEEE-CIS Fraud Detection dataset")
    parser.add_argument("--data-dir", type=str, default="data/raw",
                        help="Directory containing IEEE-CIS CSVs")
    parser.add_argument("--limit", type=int, default=None,
                        help="Max transactions to load (None = all)")
    parser.add_argument("--batch-size", type=int, default=500,
                        help="DB insertion batch size")
    parser.add_argument("--output", type=str, default="data/generated/ieee_cis_alerts.csv",
                        help="Output CSV path (always generated)")
    parser.add_argument("--db-url", type=str, default=None,
                        help="Database URL (if set, inserts into alerts table)")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s"
    )

    # Resolve paths
    project_root = Path(__file__).parent.parent
    data_dir = project_root / args.data_dir

    txn_path = data_dir / "train_transaction.csv"
    id_path = data_dir / "train_identity.csv"

    if not txn_path.exists():
        logger.error(
            "IEEE-CIS transaction file not found at %s\n"
            "Download from: https://www.kaggle.com/c/ieee-fraud-detection/data\n"
            "Place train_transaction.csv and train_identity.csv in %s",
            txn_path, data_dir
        )
        sys.exit(1)

    # Process dataset
    alerts = process_ieee_cis(str(txn_path), str(id_path), limit=args.limit)

    if not alerts:
        logger.error("No alerts generated — check your dataset files")
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
            print(f"\n✅ Loaded {inserted} IEEE-CIS alerts into database")
        except Exception as e:
            logger.warning("DB insert failed (is it running?): %s", e)
            print(f"\n⚠️  DB insert failed — alerts exported to CSV instead")
    else:
        logger.info("No DATABASE_URL set — skipping DB insertion")

    # Summary
    typology_counts = {}
    fraud_count = 0
    for a in alerts:
        typology_counts[a["typology"]] = typology_counts.get(a["typology"], 0) + 1
        if a["risk_score"] > 0.5:
            fraud_count += 1

    print(f"\n📊 IEEE-CIS Dataset Summary:")
    print(f"   Total alerts: {len(alerts)}")
    print(f"   High-risk (score > 0.5): {fraud_count}")
    print(f"   Typology distribution:")
    for typ, count in sorted(typology_counts.items()):
        print(f"     • {typ}: {count}")
    print(f"   Output CSV: {output_path}")


if __name__ == "__main__":
    main()
