"""
Fintel Backend — Agent / Investigation Router
POST /agent/investigate — LangGraph-style investigation pipeline.
Calls /nlp/extract, traverses entity graph, calls /rag/retrieve,
produces structured investigation output.

For demo: uses recursive CTE graph traversal (no Apache AGE dependency required at runtime).
"""

import json
import uuid
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from app.database import get_db
from app.models import Alert, Entity, EntityEdge, Investigation
from app.schemas import (
    InvestigateRequest, InvestigateResponse,
    LinkedEntity, EvidenceChainItem,
)
from app.routers.nlp import extract_entities, classify_typology

router = APIRouter(prefix="/agent", tags=["Agent"])


async def _extract_and_store_entities(alert: Alert, db: AsyncSession) -> list[dict]:
    """Step 1: Extract entities from alert text and store in DB."""
    entities = extract_entities(alert.raw_text)
    typology, confidence = classify_typology(alert.raw_text)

    stored_entities = []
    for ent in entities:
        db_entity = Entity(
            alert_id=alert.id,
            entity_type=ent.entity_type,
            entity_value=ent.entity_value,
            confidence=ent.confidence,
        )
        db.add(db_entity)
        await db.flush()
        await db.refresh(db_entity)
        stored_entities.append({
            "id": str(db_entity.id),
            "type": ent.entity_type,
            "value": ent.entity_value,
            "confidence": ent.confidence,
        })

    return stored_entities


async def _find_related_entities_by_value(
    entity_values: list[str],
    alert_id: UUID,
    db: AsyncSession,
) -> list[dict]:
    """
    Find entities in other alerts that share the same entity_value.
    This simulates graph traversal — finding accounts/devices that appear across multiple alerts.
    """
    if not entity_values:
        return []

    # Find entities with matching values from OTHER alerts
    results = await db.execute(
        select(Entity, Alert)
        .join(Alert, Entity.alert_id == Alert.id)
        .where(Entity.entity_value.in_(entity_values))
        .where(Entity.alert_id != alert_id)
        .limit(50)
    )

    linked = []
    seen = set()
    for entity, alert in results.all():
        key = f"{entity.entity_value}:{alert.id}"
        if key not in seen:
            seen.add(key)
            linked.append({
                "entity_id": str(entity.id),
                "entity_type": entity.entity_type,
                "entity_value": entity.entity_value,
                "linked_alert_id": str(alert.id),
                "linked_alert_account": alert.account_id,
                "linked_alert_amount": float(alert.amount) if alert.amount else None,
                "relationship": "shares_" + entity.entity_type,
            })

    return linked


async def _find_edges(entity_ids: list[str], db: AsyncSession) -> list[dict]:
    """Find edges in entity_edges table for given entity IDs."""
    if not entity_ids:
        return []

    uuid_ids = [uuid.UUID(eid) for eid in entity_ids]
    results = await db.execute(
        select(EntityEdge, Entity)
        .join(Entity, EntityEdge.target_entity_id == Entity.id)
        .where(
            EntityEdge.source_entity_id.in_(uuid_ids) |
            EntityEdge.target_entity_id.in_(uuid_ids)
        )
        .limit(100)
    )

    edges = []
    for edge, target_entity in results.all():
        edges.append({
            "source": str(edge.source_entity_id),
            "target": str(edge.target_entity_id),
            "relationship": edge.relationship_type or "unknown",
            "weight": edge.weight or 1.0,
        })

    return edges


async def _find_linked_accounts(account_id: str, db: AsyncSession) -> list[dict]:
    """
    Find accounts linked through transaction chains.
    Uses SQL queries to traverse alert connections (simulates graph traversal).
    """
    if not account_id:
        return []

    # Find alerts involving this account
    result = await db.execute(
        select(Alert)
        .where(Alert.account_id == account_id)
        .limit(20)
    )
    source_alerts = result.scalars().all()

    # For each alert, find entities and their connections to other alerts
    linked = []
    seen_accounts = {account_id}

    for alert in source_alerts:
        # Find entities from this alert
        ent_result = await db.execute(
            select(Entity)
            .where(Entity.alert_id == alert.id)
            .where(Entity.entity_type == "account")
        )
        for entity in ent_result.scalars().all():
            if entity.entity_value and entity.entity_value not in seen_accounts:
                seen_accounts.add(entity.entity_value)
                linked.append({
                    "entity_id": str(entity.id),
                    "entity_type": "account",
                    "entity_value": entity.entity_value,
                    "relationship": "transacted_with",
                    "hop_distance": 1,
                    "source_alert_id": str(alert.id),
                })

    # Second hop: find alerts for newly discovered accounts
    for hop1 in linked.copy():
        h1_result = await db.execute(
            select(Alert)
            .where(Alert.account_id == hop1["entity_value"])
            .limit(10)
        )
        for h1_alert in h1_result.scalars().all():
            h1_ent_result = await db.execute(
                select(Entity)
                .where(Entity.alert_id == h1_alert.id)
                .where(Entity.entity_type == "account")
            )
            for entity in h1_ent_result.scalars().all():
                if entity.entity_value and entity.entity_value not in seen_accounts:
                    seen_accounts.add(entity.entity_value)
                    linked.append({
                        "entity_id": str(entity.id),
                        "entity_type": "account",
                        "entity_value": entity.entity_value,
                        "relationship": "transacted_with",
                        "hop_distance": 2,
                        "source_alert_id": str(h1_alert.id),
                    })

    return linked


def _compute_verdict(
    alert: Alert,
    extracted_entities: list[dict],
    linked_accounts: list[dict],
    related_entities: list[dict],
    edges: list[dict],
) -> tuple[str, float]:
    """Compute verdict based on investigation evidence."""
    suspicion_score = 0.0

    # Factor 1: Alert risk score
    if alert.risk_score:
        suspicion_score += alert.risk_score * 0.3

    # Factor 2: Typology severity
    high_risk_typologies = {"mule_network", "structuring", "layering"}
    if alert.typology in high_risk_typologies:
        suspicion_score += 0.25

    # Factor 3: Number of linked accounts (network indicator)
    if len(linked_accounts) >= 3:
        suspicion_score += 0.2
    elif len(linked_accounts) >= 1:
        suspicion_score += 0.1

    # Factor 4: Evidence chain depth
    if edges:
        suspicion_score += min(len(edges) * 0.05, 0.15)

    # Factor 5: Related entities from other alerts
    if len(related_entities) >= 2:
        suspicion_score += 0.1

    # Normalize
    confidence = min(suspicion_score, 0.99)
    verdict = "likely_suspicious" if confidence >= 0.45 else "likely_benign"

    return verdict, round(confidence, 3)


@router.post("/investigate", response_model=InvestigateResponse)
async def investigate(
    payload: InvestigateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Full investigation pipeline:
    1. Fetch alert
    2. Extract entities (calls NLP internally)
    3. Traverse entity graph (linked accounts, shared devices)
    4. Compute verdict with confidence
    5. Store investigation result
    
    Input: {alert_id}
    Output: {linked_entities, evidence_chain, verdict, confidence}
    """
    # Step 1: Fetch alert
    result = await db.execute(select(Alert).where(Alert.id == payload.alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    # Update status to investigating
    alert.status = "investigating"
    await db.flush()

    # Step 2: Extract and store entities
    extracted_entities = await _extract_and_store_entities(alert, db)
    entity_values = [e["value"] for e in extracted_entities]
    entity_ids = [e["id"] for e in extracted_entities]

    # Step 3: Graph traversal — find linked accounts
    linked_accounts = await _find_linked_accounts(alert.account_id, db)

    # Step 4: Find related entities across alerts
    related_entities = await _find_related_entities_by_value(
        entity_values, payload.alert_id, db
    )

    # Step 5: Find explicit edges
    edges = await _find_edges(entity_ids, db)

    # Step 6: Compute verdict
    verdict, confidence = _compute_verdict(
        alert, extracted_entities, linked_accounts, related_entities, edges
    )

    # Build evidence chain
    evidence_chain = []
    for la in linked_accounts:
        evidence_chain.append({
            "source": alert.account_id or str(alert.id),
            "target": la["entity_value"],
            "relationship": la["relationship"],
            "weight": 1.0 / max(la.get("hop_distance", 1), 1),
        })
    for edge in edges:
        evidence_chain.append(edge)

    # Build linked entities list
    all_linked = []
    for la in linked_accounts:
        all_linked.append(LinkedEntity(
            entity_id=la["entity_id"],
            entity_type=la["entity_type"],
            entity_value=la["entity_value"],
            relationship=la["relationship"],
            hop_distance=la.get("hop_distance"),
        ))
    for re_ in related_entities:
        all_linked.append(LinkedEntity(
            entity_id=re_["entity_id"],
            entity_type=re_["entity_type"],
            entity_value=re_["entity_value"],
            relationship=re_["relationship"],
        ))

    # Step 7: Store investigation
    investigation = Investigation(
        alert_id=payload.alert_id,
        linked_entities={
            "extracted": extracted_entities,
            "linked_accounts": linked_accounts,
            "related_entities": related_entities,
        },
        retrieved_cases={"edges": edges},  # Will be populated by RAG in narrative step
        verdict=verdict,
        confidence=confidence,
    )
    db.add(investigation)
    await db.flush()
    await db.refresh(investigation)

    return InvestigateResponse(
        investigation_id=investigation.id,
        alert_id=payload.alert_id,
        linked_entities=all_linked,
        evidence_chain=[
            EvidenceChainItem(**ec) for ec in evidence_chain[:50]
        ],
        verdict=verdict,
        confidence=confidence,
    )
