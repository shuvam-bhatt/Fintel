"""
Fintel — Synthetic KYC Profile Generator
===============================================
Person 2 (Cybersecurity / Fraud Data Layer)

Generates realistic KYC/customer profiles using Python Faker, linked to
account IDs from the IEEE-CIS and PaySim datasets. Intentionally creates
a mix of complete ("clean") and sparse/suspicious profiles to support
the synthetic_identity typology.

Usage:
    python scripts/generate_kyc.py [--count 5000] [--suspicious-pct 15]
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import logging
import os
import random
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

from faker import Faker

logger = logging.getLogger(__name__)
fake = Faker()
Faker.seed(42)
random.seed(42)

# =============================================================================
# Configuration
# =============================================================================

# Fraction of profiles that should be intentionally suspicious/sparse
DEFAULT_SUSPICIOUS_PCT = 15  # 15% of profiles

# Risk categories and their probability weights (for clean profiles)
RISK_CATEGORIES = {
    "low": 0.60,
    "medium": 0.30,
    "high": 0.10,
}

OCCUPATIONS = [
    "Software Engineer", "Accountant", "Teacher", "Nurse", "Lawyer",
    "Business Owner", "Freelancer", "Student", "Retired", "Sales Manager",
    "Construction Worker", "Truck Driver", "Restaurant Owner", "Consultant",
    "Real Estate Agent", "Pharmacist", "Dentist", "Electrician", "Mechanic",
    "Marketing Director", "Cashier", "Bank Teller", "Unemployed",
]

# High-risk occupations for suspicious profiles
HIGH_RISK_OCCUPATIONS = [
    "Cash-Intensive Business Owner", "Currency Exchange Operator",
    "Import/Export Trader", "Cryptocurrency Trader", "Freelance Consultant",
    "Self-Employed", "Unemployed",
]


# =============================================================================
# Profile generation
# =============================================================================

def generate_clean_profile(account_id: str, reference_date: date = None) -> dict:
    """Generate a complete, legitimate-looking KYC profile."""
    if reference_date is None:
        reference_date = date(2024, 6, 1)

    # Account opened anywhere from 6 months to 10 years ago
    account_age_days = random.randint(180, 3650)
    account_open_date = reference_date - timedelta(days=account_age_days)

    # Date of birth — age between 22 and 75
    age_years = random.randint(22, 75)
    dob = reference_date - timedelta(days=age_years * 365 + random.randint(0, 364))

    # Risk category weighted by distribution
    risk_cat = random.choices(
        list(RISK_CATEGORIES.keys()),
        weights=list(RISK_CATEGORIES.values()),
        k=1
    )[0]

    return {
        "account_id": account_id,
        "full_name": fake.name(),
        "date_of_birth": dob.isoformat(),
        "address": fake.address().replace("\n", ", "),
        "phone": fake.phone_number(),
        "email": fake.email(),
        "occupation": random.choice(OCCUPATIONS),
        "account_open_date": account_open_date.isoformat(),
        "risk_category": risk_cat,
        "kyc_complete": True,
    }


def generate_suspicious_profile(account_id: str, reference_date: date = None) -> dict:
    """
    Generate a sparse/suspicious KYC profile.
    These profiles intentionally have:
    - Very recent account open dates (< 30 days)
    - Missing fields (phone, address, occupation may be empty)
    - High-risk occupations
    - Incomplete KYC flag
    """
    if reference_date is None:
        reference_date = date(2024, 6, 1)

    # Account opened very recently (1–30 days ago)
    account_age_days = random.randint(1, 30)
    account_open_date = reference_date - timedelta(days=account_age_days)

    # Randomly omit fields to make the profile sparse
    has_phone = random.random() > 0.5
    has_address = random.random() > 0.4
    has_occupation = random.random() > 0.6
    has_dob = random.random() > 0.3

    dob = None
    if has_dob:
        age_years = random.randint(18, 80)
        dob = reference_date - timedelta(days=age_years * 365 + random.randint(0, 364))

    return {
        "account_id": account_id,
        "full_name": fake.name() if random.random() > 0.1 else fake.first_name(),  # sometimes just first name
        "date_of_birth": dob.isoformat() if dob else "",
        "address": fake.address().replace("\n", ", ") if has_address else "",
        "phone": fake.phone_number() if has_phone else "",
        "email": fake.email() if random.random() > 0.2 else "",
        "occupation": random.choice(HIGH_RISK_OCCUPATIONS) if has_occupation else "",
        "account_open_date": account_open_date.isoformat(),
        "risk_category": "high",
        "kyc_complete": False,
    }


def generate_profiles(
    account_ids: list[str],
    suspicious_pct: float = DEFAULT_SUSPICIOUS_PCT,
    reference_date: date = None,
) -> list[dict]:
    """
    Generate KYC profiles for a list of account IDs.

    Args:
        account_ids: List of account IDs to create profiles for.
        suspicious_pct: Percentage of profiles to make suspicious (0–100).
        reference_date: Reference date for calculating account ages.

    Returns:
        List of profile dictionaries.
    """
    profiles = []
    n_suspicious = int(len(account_ids) * suspicious_pct / 100)

    # Shuffle to randomize which accounts get suspicious profiles
    shuffled_ids = list(account_ids)
    random.shuffle(shuffled_ids)

    for i, account_id in enumerate(shuffled_ids):
        if i < n_suspicious:
            profile = generate_suspicious_profile(account_id, reference_date)
        else:
            profile = generate_clean_profile(account_id, reference_date)
        profiles.append(profile)

    logger.info(
        "Generated %d KYC profiles (%d suspicious, %d clean)",
        len(profiles), n_suspicious, len(profiles) - n_suspicious
    )
    return profiles


# =============================================================================
# Database insertion
# =============================================================================

def insert_profiles_to_db(profiles: list[dict], db_url: str) -> int:
    """Insert profiles into the customers table via psycopg2."""
    try:
        import psycopg2
        from psycopg2.extras import execute_values
    except ImportError:
        logger.error("psycopg2 not installed. Run: pip install psycopg2-binary")
        return 0

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    # Prepare data tuples
    values = []
    for p in profiles:
        values.append((
            p["account_id"],
            p["full_name"],
            p["date_of_birth"] if p["date_of_birth"] else None,
            p["address"] if p["address"] else None,
            p["phone"] if p["phone"] else None,
            p["email"] if p["email"] else None,
            p["occupation"] if p["occupation"] else None,
            p["account_open_date"],
            p["risk_category"],
            p["kyc_complete"],
        ))

    sql = """
        INSERT INTO customers (
            account_id, full_name, date_of_birth, address, phone,
            email, occupation, account_open_date, risk_category, kyc_complete
        ) VALUES %s
        ON CONFLICT (account_id) DO NOTHING
    """

    try:
        execute_values(cur, sql, values, page_size=500)
        conn.commit()
        inserted = cur.rowcount
        logger.info("Inserted %d customer profiles into database", inserted)
        return inserted
    except Exception as e:
        conn.rollback()
        logger.error("Failed to insert profiles: %s", e)
        raise
    finally:
        cur.close()
        conn.close()


# =============================================================================
# CSV export (fallback if DB isn't running)
# =============================================================================

def export_profiles_to_csv(profiles: list[dict], output_path: str) -> None:
    """Export profiles to CSV for sharing with teammates."""
    fieldnames = [
        "account_id", "full_name", "date_of_birth", "address", "phone",
        "email", "occupation", "account_open_date", "risk_category", "kyc_complete",
    ]

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(profiles)

    logger.info("Exported %d profiles to %s", len(profiles), output_path)


# =============================================================================
# Standalone execution: generate profiles from existing data or from scratch
# =============================================================================

def collect_account_ids_from_data(data_dir: str) -> list[str]:
    """Collect unique account IDs from loaded dataset CSVs."""
    account_ids = set()

    # Try IEEE-CIS (card-based account IDs)
    ieee_path = os.path.join(data_dir, "train_transaction.csv")
    if os.path.exists(ieee_path):
        logger.info("Reading account IDs from IEEE-CIS dataset...")
        with open(ieee_path, "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Create account ID from card columns
                card_hash = hashlib.md5(
                    f"{row.get('card1', '')}-{row.get('card2', '')}-{row.get('card3', '')}".encode()
                ).hexdigest()[:12]
                account_ids.add(f"IEEE-{card_hash}")

    # Try PaySim
    paysim_path = os.path.join(data_dir, "paysim.csv")
    if not os.path.exists(paysim_path):
        # Check for the long filename
        for f in os.listdir(data_dir) if os.path.exists(data_dir) else []:
            if f.startswith("PS_") and f.endswith(".csv"):
                paysim_path = os.path.join(data_dir, f)
                break

    if os.path.exists(paysim_path):
        logger.info("Reading account IDs from PaySim dataset...")
        with open(paysim_path, "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                account_ids.add(row.get("nameOrig", ""))
                dest = row.get("nameDest", "")
                if not dest.startswith("M"):  # Skip merchants
                    account_ids.add(dest)

    account_ids.discard("")
    return list(account_ids)


def generate_standalone_account_ids(count: int) -> list[str]:
    """Generate synthetic account IDs if no dataset is available."""
    return [f"ACCT-{fake.uuid4()[:8].upper()}" for _ in range(count)]


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic KYC profiles")
    parser.add_argument("--count", type=int, default=5000,
                        help="Number of profiles to generate (used if no dataset found)")
    parser.add_argument("--suspicious-pct", type=float, default=DEFAULT_SUSPICIOUS_PCT,
                        help="Percentage of suspicious/sparse profiles (default: 15)")
    parser.add_argument("--data-dir", type=str, default="data/raw",
                        help="Directory containing dataset CSVs")
    parser.add_argument("--output", type=str, default="data/generated/kyc_profiles.csv",
                        help="Output CSV path")
    parser.add_argument("--db-url", type=str, default=None,
                        help="Database URL (if set, also inserts into customers table)")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s"
    )

    # Collect account IDs from datasets or generate synthetic ones
    data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), args.data_dir)
    account_ids = collect_account_ids_from_data(data_dir)

    if not account_ids:
        logger.info("No dataset found in %s — generating %d synthetic account IDs", data_dir, args.count)
        account_ids = generate_standalone_account_ids(args.count)
    else:
        logger.info("Found %d unique account IDs from datasets", len(account_ids))
        # Cap if there are too many
        if len(account_ids) > args.count:
            account_ids = random.sample(account_ids, args.count)

    # Generate profiles
    profiles = generate_profiles(
        account_ids,
        suspicious_pct=args.suspicious_pct,
        reference_date=date(2024, 6, 1),
    )

    # Export to CSV
    output_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), args.output)
    export_profiles_to_csv(profiles, output_path)

    # Optionally insert into database
    db_url = args.db_url or os.environ.get("DATABASE_URL")
    if not db_url:
        env_path = Path(__file__).parent.parent / ".env"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.strip().startswith("DATABASE_URL="):
                    db_url = line.strip().split("=", 1)[1].strip()
                    break
    if db_url:
        try:
            insert_profiles_to_db(profiles, db_url)
        except Exception as e:
            logger.warning("Could not insert into DB (is it running?): %s", e)
            logger.info("Profiles are still available in %s", output_path)

    print(f"\n✅ Generated {len(profiles)} KYC profiles")
    print(f"   • Clean: {sum(1 for p in profiles if p['kyc_complete'])}")
    print(f"   • Suspicious: {sum(1 for p in profiles if not p['kyc_complete'])}")
    print(f"   • Output: {output_path}")


if __name__ == "__main__":
    main()
