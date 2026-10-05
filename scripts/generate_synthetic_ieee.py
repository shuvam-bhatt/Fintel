"""
Fintel — Synthetic IEEE-CIS-like Fraud Dataset Generator
==============================================================
Person 2 (Cybersecurity / Fraud Data Layer)

Generates a synthetic dataset mimicking the IEEE-CIS Fraud Detection dataset
structure. Use this when the original Kaggle dataset is unavailable.

The generated data has the same key columns:
    - TransactionID, TransactionDT, TransactionAMT, ProductCD
    - card1–card6, addr1, addr2
    - P_emaildomain, R_emaildomain
    - isFraud (target)
    - DeviceType, DeviceInfo (identity table)

Produces ~3.5% fraud rate (realistic for financial data).

Usage:
    python scripts/generate_synthetic_ieee.py [--count 50000] [--fraud-rate 0.035]
"""

from __future__ import annotations

import argparse
import csv
import logging
import os
import random
from datetime import datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)
random.seed(42)

# =============================================================================
# Realistic distributions (modeled after actual IEEE-CIS patterns)
# =============================================================================

PRODUCT_CODES = ["W", "H", "C", "S", "R"]
PRODUCT_WEIGHTS = [0.75, 0.05, 0.10, 0.05, 0.05]

CARD_TYPES = ["visa", "mastercard", "discover", "american express"]
CARD_TYPE_WEIGHTS = [0.55, 0.30, 0.10, 0.05]

CARD_CATEGORIES = ["credit", "debit", "charge", "debit or credit"]
CARD_CAT_WEIGHTS = [0.45, 0.40, 0.05, 0.10]

EMAIL_DOMAINS = [
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
    "icloud.com", "mail.com", "protonmail.com", "live.com", "comcast.net",
    "att.net", "verizon.net", "cox.net", "charter.net", "frontier.com",
    "anonymous.com", "noemail.com",
]

# Suspicious domains (higher fraud rate)
SUSPICIOUS_DOMAINS = ["protonmail.com", "anonymous.com", "noemail.com", "mail.com"]

DEVICE_TYPES = ["desktop", "mobile"]
DEVICE_WEIGHTS = [0.60, 0.40]

DEVICE_INFO = [
    "Windows", "MacOS", "iOS Device", "Samsung", "LG", "Huawei",
    "Motorola", "Pixel", "OnePlus", "HTC", "Lenovo", "ASUS",
    "rv:57.0", "rv:68.0", "Trident/7.0", "Linux",
]

# Amount distributions
# Legit: mostly small, long tail
# Fraud: bimodal — small (card testing) and large (exploitation)

def generate_legit_amount() -> float:
    """Generate a legitimate transaction amount."""
    r = random.random()
    if r < 0.40:
        # Small everyday purchases ($5–$75)
        return round(random.uniform(5, 75), 2)
    elif r < 0.70:
        # Medium purchases ($75–$300)
        return round(random.uniform(75, 300), 2)
    elif r < 0.88:
        # Larger purchases ($300–$1,000)
        return round(random.uniform(300, 1000), 2)
    elif r < 0.96:
        # High-value ($1,000–$5,000)
        return round(random.uniform(1000, 5000), 2)
    else:
        # Very high-value ($5,000–$20,000)
        return round(random.uniform(5000, 20000), 2)


def generate_fraud_amount() -> float:
    """Generate a fraudulent transaction amount."""
    r = random.random()
    if r < 0.25:
        # Card testing — very small amounts ($0.50–$5)
        return round(random.uniform(0.50, 5.00), 2)
    elif r < 0.50:
        # Quick cash-out — medium amounts ($100–$500)
        return round(random.uniform(100, 500), 2)
    elif r < 0.70:
        # Structuring — near-threshold amounts ($9,000–$9,999)
        return round(random.uniform(9000, 9999), 2)
    elif r < 0.85:
        # High-value fraud ($1,000–$10,000)
        return round(random.uniform(1000, 10000), 2)
    else:
        # Major fraud ($10,000–$50,000)
        return round(random.uniform(10000, 50000), 2)


# =============================================================================
# Account/card generation
# =============================================================================

class AccountPool:
    """Generates and tracks synthetic card/account combinations."""

    def __init__(self, num_accounts: int = 10000):
        self.accounts = []
        for i in range(num_accounts):
            self.accounts.append({
                "card1": random.randint(1000, 20000),
                "card2": round(random.uniform(100, 600), 1),
                "card3": round(random.uniform(100, 300), 1),
                "card4": random.choices(CARD_TYPES, weights=CARD_TYPE_WEIGHTS, k=1)[0],
                "card5": random.randint(100, 300),
                "card6": random.choices(CARD_CATEGORIES, weights=CARD_CAT_WEIGHTS, k=1)[0],
                "addr1": random.randint(100, 500),
                "addr2": random.randint(10, 100),
                "P_emaildomain": random.choice(EMAIL_DOMAINS),
            })

        # Mark some accounts as "compromised" (higher fraud probability)
        self.compromised = set(random.sample(range(num_accounts), int(num_accounts * 0.05)))

    def get_account(self, is_fraud: bool = False) -> dict:
        """Get an account — compromised accounts used more often for fraud."""
        if is_fraud and self.compromised and random.random() < 0.7:
            idx = random.choice(list(self.compromised))
        else:
            idx = random.randint(0, len(self.accounts) - 1)
        return self.accounts[idx]


# =============================================================================
# Transaction generation
# =============================================================================

def generate_transaction(
    txn_id: int,
    dt_seconds: int,
    is_fraud: bool,
    account_pool: AccountPool,
) -> dict:
    """Generate a single synthetic transaction row."""
    account = account_pool.get_account(is_fraud)
    amount = generate_fraud_amount() if is_fraud else generate_legit_amount()

    # Product code — fraud tends to target digital goods and electronics
    if is_fraud:
        product = random.choices(
            PRODUCT_CODES,
            weights=[0.50, 0.20, 0.15, 0.10, 0.05],
            k=1
        )[0]
    else:
        product = random.choices(PRODUCT_CODES, weights=PRODUCT_WEIGHTS, k=1)[0]

    # Recipient email (sometimes same as purchaser, sometimes different)
    r_email = ""
    if random.random() < 0.3:
        r_email = random.choice(EMAIL_DOMAINS)
        if is_fraud and random.random() < 0.5:
            r_email = random.choice(SUSPICIOUS_DOMAINS)

    # Match features M1-M9 (simplified — T/F flags)
    m_features = {}
    for i in range(1, 10):
        if random.random() < 0.7:
            if is_fraud:
                m_features[f"M{i}"] = random.choice(["T", "F"])
            else:
                m_features[f"M{i}"] = "T" if random.random() < 0.85 else "F"
        else:
            m_features[f"M{i}"] = ""

    row = {
        "TransactionID": str(txn_id),
        "isFraud": 1 if is_fraud else 0,
        "TransactionDT": dt_seconds,
        "TransactionAMT": amount,
        "ProductCD": product,
        "card1": account["card1"],
        "card2": account["card2"],
        "card3": account["card3"],
        "card4": account["card4"],
        "card5": account["card5"],
        "card6": account["card6"],
        "addr1": account["addr1"],
        "addr2": account["addr2"],
        "P_emaildomain": account["P_emaildomain"],
        "R_emaildomain": r_email,
    }
    row.update(m_features)

    return row


def generate_identity(txn_id: int, is_fraud: bool) -> dict | None:
    """Generate identity data for a transaction (not all transactions have one)."""
    # Only ~25% of transactions have identity data (matches real dataset)
    if random.random() > 0.25:
        return None

    device_type = random.choices(DEVICE_TYPES, weights=DEVICE_WEIGHTS, k=1)[0]

    # Fraudsters more likely to use certain device patterns
    if is_fraud:
        device_info = random.choice(DEVICE_INFO)
    else:
        device_info = random.choices(
            DEVICE_INFO[:6],  # Legitimate users tend to use common devices
            k=1
        )[0]

    return {
        "TransactionID": str(txn_id),
        "DeviceType": device_type,
        "DeviceInfo": device_info,
    }


# =============================================================================
# Dataset generation
# =============================================================================

def generate_dataset(
    num_transactions: int = 50000,
    fraud_rate: float = 0.035,
    num_accounts: int = 10000,
) -> tuple[list[dict], list[dict]]:
    """
    Generate complete synthetic IEEE-CIS-like dataset.

    Returns:
        (transactions, identities) — two lists of dicts matching CSV column structure
    """
    account_pool = AccountPool(num_accounts)
    transactions = []
    identities = []

    num_fraud = int(num_transactions * fraud_rate)
    fraud_indices = set(random.sample(range(num_transactions), num_fraud))

    # Generate timestamps over a ~6 month period (in seconds from reference)
    # Real dataset spans ~6 months, step ~86400 seconds/day
    total_seconds = 180 * 86400  # 180 days

    logger.info(
        "Generating %d transactions (%.1f%% fraud rate, %d accounts)...",
        num_transactions, fraud_rate * 100, num_accounts
    )

    for i in range(num_transactions):
        is_fraud = i in fraud_indices
        dt_seconds = random.randint(0, total_seconds)

        txn = generate_transaction(
            txn_id=3000000 + i,  # IEEE-CIS IDs start around 2987000
            dt_seconds=dt_seconds,
            is_fraud=is_fraud,
            account_pool=account_pool,
        )
        transactions.append(txn)

        identity = generate_identity(3000000 + i, is_fraud)
        if identity:
            identities.append(identity)

        if (i + 1) % 10000 == 0:
            logger.info("  Generated %d / %d transactions...", i + 1, num_transactions)

    # Sort by timestamp (like real dataset)
    transactions.sort(key=lambda x: x["TransactionDT"])

    fraud_count = sum(1 for t in transactions if t["isFraud"])
    logger.info(
        "Generated %d transactions (%d fraud = %.2f%%), %d identity records",
        len(transactions), fraud_count, fraud_count / len(transactions) * 100,
        len(identities)
    )

    return transactions, identities


# =============================================================================
# Export to CSV
# =============================================================================

def export_to_csv(
    transactions: list[dict],
    identities: list[dict],
    output_dir: str,
) -> tuple[str, str]:
    """Export generated data to CSV files matching IEEE-CIS structure."""
    os.makedirs(output_dir, exist_ok=True)

    # Transaction CSV
    txn_path = os.path.join(output_dir, "train_transaction.csv")
    txn_fields = [
        "TransactionID", "isFraud", "TransactionDT", "TransactionAMT", "ProductCD",
        "card1", "card2", "card3", "card4", "card5", "card6",
        "addr1", "addr2", "P_emaildomain", "R_emaildomain",
        "M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9",
    ]
    with open(txn_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=txn_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(transactions)

    # Identity CSV
    id_path = os.path.join(output_dir, "train_identity.csv")
    id_fields = ["TransactionID", "DeviceType", "DeviceInfo"]
    with open(id_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=id_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(identities)

    logger.info("Exported to %s and %s", txn_path, id_path)
    return txn_path, id_path


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Generate synthetic IEEE-CIS-like fraud dataset"
    )
    parser.add_argument("--count", type=int, default=50000,
                        help="Number of transactions to generate (default: 50000)")
    parser.add_argument("--fraud-rate", type=float, default=0.035,
                        help="Fraud rate (default: 0.035 = 3.5%%)")
    parser.add_argument("--accounts", type=int, default=10000,
                        help="Number of unique accounts (default: 10000)")
    parser.add_argument("--output-dir", type=str, default="data/raw",
                        help="Output directory for CSVs")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s"
    )

    project_root = Path(__file__).parent.parent
    output_dir = project_root / args.output_dir

    # Generate dataset
    transactions, identities = generate_dataset(
        num_transactions=args.count,
        fraud_rate=args.fraud_rate,
        num_accounts=args.accounts,
    )

    # Export to CSV
    txn_path, id_path = export_to_csv(transactions, identities, str(output_dir))

    # Summary statistics
    fraud_count = sum(1 for t in transactions if t["isFraud"])
    amounts = [t["TransactionAMT"] for t in transactions]
    fraud_amounts = [t["TransactionAMT"] for t in transactions if t["isFraud"]]
    legit_amounts = [t["TransactionAMT"] for t in transactions if not t["isFraud"]]

    print(f"\n✅ Synthetic IEEE-CIS Dataset Generated")
    print(f"   Transactions: {len(transactions):,}")
    print(f"   Identity records: {len(identities):,} ({len(identities)/len(transactions)*100:.0f}%)")
    print(f"   Fraud: {fraud_count:,} ({fraud_count/len(transactions)*100:.2f}%)")
    print(f"   Legit: {len(transactions) - fraud_count:,}")
    print(f"\n   Amount Statistics:")
    print(f"     Overall:  min=${min(amounts):,.2f}  max=${max(amounts):,.2f}  avg=${sum(amounts)/len(amounts):,.2f}")
    print(f"     Fraud:    min=${min(fraud_amounts):,.2f}  max=${max(fraud_amounts):,.2f}  avg=${sum(fraud_amounts)/len(fraud_amounts):,.2f}")
    print(f"     Legit:    min=${min(legit_amounts):,.2f}  max=${max(legit_amounts):,.2f}  avg=${sum(legit_amounts)/len(legit_amounts):,.2f}")
    print(f"\n   Output files:")
    print(f"     {txn_path}")
    print(f"     {id_path}")
    print(f"\n   Next: run 'python scripts/load_ieee_cis.py' to load into database")


if __name__ == "__main__":
    main()
