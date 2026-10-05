"""
Fintel Backend — Alerts Router
CRUD + analyst decision capture for alerts.
Endpoints: GET /alerts, GET /alerts/{id}, POST /alerts, POST /alerts/{id}/decision
"""

import math
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case, text, update
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Alert, Entity, Investigation, Narrative, Customer
from app.schemas import (
    AlertCreate, AlertResponse, AlertListResponse, AlertUpdate,
    AlertDecision, PaginatedAlerts, DashboardStats, CustomerResponse,
)

router = APIRouter(tags=["Alerts"])


@router.get("/alerts", response_model=PaginatedAlerts)
async def list_alerts(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = Query(None),
    typology: str | None = Query(None),
    min_risk: float | None = Query(None),
    max_risk: float | None = Query(None),
    sort_by: str = Query("created_at"),
    sort_order: str = Query("desc"),
    search: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List alerts with pagination, filtering, and sorting."""
    query = select(Alert)

    # Filters
    if status:
        query = query.where(Alert.status == status)
    if typology:
        query = query.where(Alert.typology == typology)
    if min_risk is not None:
        query = query.where(Alert.risk_score >= min_risk)
    if max_risk is not None:
        query = query.where(Alert.risk_score <= max_risk)
    if search:
        query = query.where(
            Alert.raw_text.ilike(f"%{search}%") |
            Alert.transaction_id.ilike(f"%{search}%") |
            Alert.account_id.ilike(f"%{search}%")
        )

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    # Sorting
    sort_col = getattr(Alert, sort_by, Alert.created_at)
    if sort_order == "desc":
        query = query.order_by(sort_col.desc())
    else:
        query = query.order_by(sort_col.asc())

    # Pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await db.execute(query)
    items = result.scalars().all()

    return PaginatedAlerts(
        items=[AlertListResponse.model_validate(a) for a in items],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total > 0 else 1,
    )


@router.get("/alerts/stats", response_model=DashboardStats)
async def get_dashboard_stats(db: AsyncSession = Depends(get_db)):
    """Get dashboard-level aggregate statistics."""
    # Counts by status
    status_counts = await db.execute(
        select(
            func.count().label("total"),
            func.count().filter(Alert.status == "new").label("new_count"),
            func.count().filter(Alert.status == "investigating").label("investigating"),
            func.count().filter(Alert.status == "approved").label("approved"),
            func.count().filter(Alert.status == "rejected").label("rejected"),
            func.coalesce(func.avg(Alert.risk_score), 0).label("avg_risk"),
            func.count().filter(Alert.risk_score >= 0.7).label("high_risk"),
        )
    )
    row = status_counts.one()

    # Typology distribution
    typology_rows = await db.execute(
        select(Alert.typology, func.count())
        .where(Alert.typology.is_not(None))
        .group_by(Alert.typology)
    )
    typology_dist = {t: c for t, c in typology_rows.all()}

    return DashboardStats(
        total_alerts=row.total,
        new_alerts=row.new_count,
        investigating=row.investigating,
        approved=row.approved,
        rejected=row.rejected,
        avg_risk_score=round(float(row.avg_risk), 3),
        high_risk_count=row.high_risk,
        typology_distribution=typology_dist,
    )


@router.get("/alerts/{alert_id}", response_model=AlertResponse)
async def get_alert(alert_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get a single alert with all related entities, investigations, and narratives."""
    result = await db.execute(
        select(Alert)
        .options(
            selectinload(Alert.entities),
            selectinload(Alert.investigations).selectinload(Investigation.narratives),
        )
        .where(Alert.id == alert_id)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return AlertResponse.model_validate(alert)


@router.post("/alerts", response_model=AlertListResponse, status_code=201)
async def create_alert(payload: AlertCreate, db: AsyncSession = Depends(get_db)):
    """Create a new alert."""
    alert = Alert(**payload.model_dump())
    db.add(alert)
    await db.flush()
    await db.refresh(alert)
    return AlertListResponse.model_validate(alert)


@router.patch("/alerts/{alert_id}", response_model=AlertListResponse)
async def update_alert(
    alert_id: UUID,
    payload: AlertUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update alert fields (status, risk_score, typology)."""
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, val in update_data.items():
        setattr(alert, key, val)

    await db.flush()
    await db.refresh(alert)
    return AlertListResponse.model_validate(alert)


@router.post("/alerts/{alert_id}/decision")
async def submit_decision(
    alert_id: UUID,
    payload: AlertDecision,
    db: AsyncSession = Depends(get_db),
):
    """Analyst submits a decision on an alert."""
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert.status = payload.decision
    await db.flush()

    # Also update any pending narratives for this alert
    investigations = await db.execute(
        select(Investigation).where(Investigation.alert_id == alert_id)
    )
    for inv in investigations.scalars().all():
        narratives = await db.execute(
            select(Narrative)
            .where(Narrative.investigation_id == inv.id)
            .where(Narrative.analyst_decision == "pending")
        )
        for n in narratives.scalars().all():
            n.analyst_decision = payload.decision

    await db.flush()
    return {"status": "ok", "alert_id": str(alert_id), "decision": payload.decision}


@router.get("/customers/{account_id}", response_model=CustomerResponse)
async def get_customer(account_id: str, db: AsyncSession = Depends(get_db)):
    """Get customer KYC profile by account_id."""
    result = await db.execute(
        select(Customer).where(Customer.account_id == account_id)
    )
    customer = result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return CustomerResponse.model_validate(customer)
