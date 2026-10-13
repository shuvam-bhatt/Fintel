"""
Fintel Backend — Data Seeding Router
Loads generated CSV data into the database for the demo.
"""

import csv
import io
import os
from uuid import UUID, uuid4
from datetime import datetime, date
from pathlib import Path
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db

router = APIRouter(prefix="/seed", tags=["Seeding"])

# Resolve data directory (works both in Docker and local dev)
DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data/generated"))
if not DATA_DIR.exists():
    DATA_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data" / "generated"
if not DATA_DIR.exists():
    DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "generated"



def _parse_timestamp(ts_str: str) -> datetime | None:
    """Parse various timestamp formats to datetime object."""
    if not ts_str:
        return None
    try:
        return datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def _parse_date(d_str: str) -> date | None:
    """Parse date string to date object."""
    if not d_str:
        return None
    try:
        return date.fromisoformat(d_str.strip())
    except (ValueError, AttributeError):
        return None



def _parse_float(val: str) -> float:
    """Parse float from string, handling empty/invalid values."""
    if not val or val in ("None", "nan", ""):
        return None
    try:
        return float(val.replace(",", ""))
    except (ValueError, TypeError):
        return None


@router.post("/alerts")
async def seed_alerts(
    limit: int = 500,
    db: AsyncSession = Depends(get_db),
):
    """Load alerts from generated CSVs into the alerts table."""
    # Check if already seeded
    count_result = await db.execute(text("SELECT COUNT(*) FROM alerts"))
    existing = count_result.scalar()
    if existing and existing > 0:
        return {"status": "already_seeded", "count": existing}

    total_loaded = 0

    # Load IEEE-CIS alerts
    ieee_path = DATA_DIR / "ieee_cis_alerts.csv"
    if ieee_path.exists():
        with open(ieee_path, "r") as f:
            reader = csv.DictReader(f)
            batch = []
            for i, row in enumerate(reader):
                if i >= limit:
                    break
                batch.append({
                    "id": row.get("id", str(uuid4())),
                    "raw_text": row.get("raw_text", ""),
                    "transaction_id": row.get("transaction_id"),
                    "account_id": row.get("account_id"),
                    "amount": _parse_float(row.get("amount")),
                    "currency": row.get("currency", "USD"),
                    "timestamp": _parse_timestamp(row.get("timestamp")),
                    "risk_score": _parse_float(row.get("risk_score")),
                    "typology": row.get("typology", "unclassified"),
                    "status": row.get("status", "new"),
                })

            for record in batch:
                await db.execute(
                    text("""
                        INSERT INTO alerts (id, raw_text, transaction_id, account_id, 
                                          amount, currency, timestamp, risk_score, typology, status)
                        VALUES (:id, :raw_text, :transaction_id, :account_id,
                                :amount, :currency, :timestamp, :risk_score, :typology, :status)
                        ON CONFLICT (id) DO NOTHING
                    """),
                    record,
                )
            total_loaded += len(batch)

    # Load PaySim alerts
    paysim_path = DATA_DIR / "paysim_alerts.csv"
    if paysim_path.exists():
        with open(paysim_path, "r") as f:
            reader = csv.DictReader(f)
            batch = []
            for i, row in enumerate(reader):
                if i >= limit:
                    break
                batch.append({
                    "id": row.get("id", str(uuid4())),
                    "raw_text": row.get("raw_text", ""),
                    "transaction_id": row.get("transaction_id"),
                    "account_id": row.get("account_id"),
                    "amount": _parse_float(row.get("amount")),
                    "currency": row.get("currency", "USD"),
                    "timestamp": _parse_timestamp(row.get("timestamp")),
                    "risk_score": _parse_float(row.get("risk_score")),
                    "typology": row.get("typology", "unclassified"),
                    "status": row.get("status", "new"),
                })

            for record in batch:
                await db.execute(
                    text("""
                        INSERT INTO alerts (id, raw_text, transaction_id, account_id,
                                          amount, currency, timestamp, risk_score, typology, status)
                        VALUES (:id, :raw_text, :transaction_id, :account_id,
                                :amount, :currency, :timestamp, :risk_score, :typology, :status)
                        ON CONFLICT (id) DO NOTHING
                    """),
                    record,
                )
            total_loaded += len(batch)

    await db.commit()
    return {"status": "seeded", "alerts_loaded": total_loaded}


@router.post("/customers")
async def seed_customers(
    db: AsyncSession = Depends(get_db),
):
    """Load KYC customer profiles from generated CSV."""
    count_result = await db.execute(text("SELECT COUNT(*) FROM customers"))
    existing = count_result.scalar()
    if existing and existing > 0:
        return {"status": "already_seeded", "count": existing}

    kyc_path = DATA_DIR / "kyc_profiles.csv"
    if not kyc_path.exists():
        return {"status": "error", "message": f"File not found: {kyc_path}"}

    loaded = 0
    with open(kyc_path, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            dob = row.get("date_of_birth")
            open_date = row.get("account_open_date")
            kyc = row.get("kyc_complete", "True")

            await db.execute(
                text("""
                    INSERT INTO customers (id, account_id, full_name, date_of_birth,
                                          address, phone, email, occupation,
                                          account_open_date, risk_category, kyc_complete)
                    VALUES (:id, :account_id, :full_name, :dob,
                            :address, :phone, :email, :occupation,
                            :open_date, :risk_category, :kyc_complete)
                    ON CONFLICT (account_id) DO NOTHING
                """),
                {
                    "id": str(uuid4()),
                    "account_id": row.get("account_id", ""),
                    "full_name": row.get("full_name"),
                    "dob": _parse_date(dob),
                    "address": row.get("address"),
                    "phone": row.get("phone"),
                    "email": row.get("email"),
                    "occupation": row.get("occupation"),
                    "open_date": _parse_date(open_date),
                    "risk_category": row.get("risk_category", "medium"),
                    "kyc_complete": kyc.lower() == "true" if kyc else True,
                },
            )
            loaded += 1

    await db.commit()
    return {"status": "seeded", "customers_loaded": loaded}



@router.post("/all")
async def seed_all(db: AsyncSession = Depends(get_db)):
    """Seed all data: alerts, customers, and RAG typologies."""
    results = {}

    # Seed alerts
    count_result = await db.execute(text("SELECT COUNT(*) FROM alerts"))
    if (count_result.scalar() or 0) == 0:
        r = await seed_alerts(limit=500, db=db)
        results["alerts"] = r
    else:
        results["alerts"] = {"status": "already_seeded"}

    # Seed customers
    count_result = await db.execute(text("SELECT COUNT(*) FROM customers"))
    if (count_result.scalar() or 0) == 0:
        r = await seed_customers(db=db)
        results["customers"] = r
    else:
        results["customers"] = {"status": "already_seeded"}

    return results
