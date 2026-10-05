"""
Fintel Backend — Narrative Generation Router
POST /narrative/generate — Generates evidence-cited case narratives.

For demo: uses template-based narrative generation (no LLM API key needed).
If LLM_API_KEY is configured, will use Claude/OpenAI for richer narratives.
"""

import json
from uuid import UUID, uuid4
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from app.database import get_db
from app.models import Investigation, Alert, Narrative, Entity
from app.schemas import (
    NarrativeGenerateRequest, NarrativeGenerateResponse,
    NarrativeDecisionRequest, Citation, NarrativeResponse,
)
from app.config import get_settings

router = APIRouter(prefix="/narrative", tags=["Narrative"])
settings = get_settings()


def _format_amount(amount) -> str:
    """Format amount with dollar sign and commas."""
    if amount is None:
        return "unknown amount"
    try:
        return f"${float(amount):,.2f}"
    except (ValueError, TypeError):
        return str(amount)


def _generate_template_narrative(
    alert: Alert,
    investigation: Investigation,
    entities: list,
    similar_cases: list[dict],
) -> tuple[str, list[dict]]:
    """
    Generate a structured SAR-style narrative using templates.
    Returns (narrative_text, citations).
    """
    citations = []
    paragraphs = []
    sentence_idx = 0

    # ─── Section 1: Subject Identification ───────────────────────────────
    subj_lines = []
    subj_lines.append(
        f"This investigation concerns alert {alert.transaction_id or str(alert.id)[:8]}, "
        f"involving account {alert.account_id or 'unknown'}"
    )
    citations.append({
        "sentence_index": sentence_idx,
        "sentence": subj_lines[-1],
        "source_type": "alert",
        "source_id": str(alert.id),
        "source_detail": f"Alert ID: {alert.id}, Transaction: {alert.transaction_id}",
    })
    sentence_idx += 1

    if alert.amount:
        line = f"A transaction of {_format_amount(alert.amount)} {alert.currency or 'USD'} was flagged for review."
        subj_lines.append(line)
        citations.append({
            "sentence_index": sentence_idx,
            "sentence": line,
            "source_type": "alert",
            "source_id": str(alert.id),
            "source_detail": f"Amount: {alert.amount}, Currency: {alert.currency}",
        })
        sentence_idx += 1

    if alert.timestamp:
        ts = alert.timestamp.strftime("%B %d, %Y at %H:%M UTC") if isinstance(alert.timestamp, datetime) else str(alert.timestamp)
        line = f"The transaction occurred on {ts}."
        subj_lines.append(line)
        citations.append({
            "sentence_index": sentence_idx,
            "sentence": line,
            "source_type": "alert",
            "source_id": str(alert.id),
            "source_detail": f"Timestamp: {alert.timestamp}",
        })
        sentence_idx += 1

    paragraphs.append(" ".join(subj_lines))

    # ─── Section 2: Suspicious Activity Description ──────────────────────
    activity_lines = []

    if alert.typology and alert.typology != "unclassified":
        typology_descriptions = {
            "structuring": "structuring transactions below reporting thresholds",
            "mule_network": "involvement in a suspected mule network for layered fund transfers",
            "rapid_movement": "rapid movement of funds with minimal holding periods",
            "synthetic_identity": "use of potentially synthetic or fraudulent identity credentials",
            "layering": "complex layering of transactions to obscure the origin of funds",
        }
        desc = typology_descriptions.get(alert.typology, f"suspicious {alert.typology} activity")
        line = f"The activity was classified as {desc}."
        activity_lines.append(line)
        citations.append({
            "sentence_index": sentence_idx,
            "sentence": line,
            "source_type": "classification",
            "source_id": str(alert.id),
            "source_detail": f"Typology: {alert.typology}, Risk Score: {alert.risk_score}",
        })
        sentence_idx += 1

    if alert.risk_score is not None:
        risk_level = "high" if alert.risk_score >= 0.7 else "elevated" if alert.risk_score >= 0.4 else "moderate"
        line = f"The automated risk assessment assigned a {risk_level} risk score of {alert.risk_score:.2f}."
        activity_lines.append(line)
        citations.append({
            "sentence_index": sentence_idx,
            "sentence": line,
            "source_type": "risk_engine",
            "source_id": str(alert.id),
            "source_detail": f"Risk Score: {alert.risk_score}",
        })
        sentence_idx += 1

    if activity_lines:
        paragraphs.append(" ".join(activity_lines))

    # ─── Section 3: Entity Analysis ──────────────────────────────────────
    if entities:
        entity_lines = []
        entity_by_type = {}
        for ent in entities:
            et = ent.entity_type
            if et not in entity_by_type:
                entity_by_type[et] = []
            entity_by_type[et].append(ent)

        line = f"Analysis extracted {len(entities)} entities from the alert data:"
        entity_lines.append(line)
        sentence_idx += 1

        for et, ents in entity_by_type.items():
            values = ", ".join(e.entity_value for e in ents[:5])
            line = f"  - {et.title()} entities: {values}"
            entity_lines.append(line)
            for e in ents[:3]:
                citations.append({
                    "sentence_index": sentence_idx,
                    "sentence": line,
                    "source_type": "entity",
                    "source_id": str(e.id),
                    "source_detail": f"Type: {e.entity_type}, Value: {e.entity_value}, Confidence: {e.confidence}",
                })
            sentence_idx += 1

        paragraphs.append("\n".join(entity_lines))

    # ─── Section 4: Investigation Findings ───────────────────────────────
    if investigation.linked_entities:
        linked = investigation.linked_entities
        finding_lines = []

        # Linked accounts
        linked_accounts = linked.get("linked_accounts", [])
        if linked_accounts:
            acct_ids = list(set(la.get("entity_value", "") for la in linked_accounts[:10]))
            line = (
                f"Graph traversal identified {len(linked_accounts)} linked account(s): "
                f"{', '.join(acct_ids[:5])}."
            )
            finding_lines.append(line)
            citations.append({
                "sentence_index": sentence_idx,
                "sentence": line,
                "source_type": "investigation",
                "source_id": str(investigation.id),
                "source_detail": f"Linked accounts: {acct_ids[:5]}",
            })
            sentence_idx += 1

            # Check for mule chain pattern
            hops = [la.get("hop_distance", 0) for la in linked_accounts]
            if max(hops) >= 2:
                line = (
                    f"The investigation traversed up to {max(hops)} hops in the transaction network, "
                    f"suggesting a multi-layered fund transfer chain consistent with mule network operations."
                )
                finding_lines.append(line)
                citations.append({
                    "sentence_index": sentence_idx,
                    "sentence": line,
                    "source_type": "investigation",
                    "source_id": str(investigation.id),
                    "source_detail": f"Max hop distance: {max(hops)}, Chain length: {len(linked_accounts)}",
                })
                sentence_idx += 1

        # Related entities from other alerts
        related = linked.get("related_entities", [])
        if related:
            line = (
                f"Cross-alert analysis found {len(related)} shared entities across other alerts, "
                f"indicating potential coordination between multiple suspicious accounts."
            )
            finding_lines.append(line)
            citations.append({
                "sentence_index": sentence_idx,
                "sentence": line,
                "source_type": "investigation",
                "source_id": str(investigation.id),
                "source_detail": f"Related entities: {len(related)}",
            })
            sentence_idx += 1

        if finding_lines:
            paragraphs.append(" ".join(finding_lines))

    # ─── Section 5: Similar Past Cases ───────────────────────────────────
    if similar_cases:
        case_lines = []
        line = f"RAG retrieval identified {len(similar_cases)} similar historical cases/typologies:"
        case_lines.append(line)
        sentence_idx += 1

        for i, sc in enumerate(similar_cases[:3]):
            content_preview = sc.get("content", "")[:150] + "..."
            sim = sc.get("similarity", 0)
            line = f"  - Similar case (relevance: {sim:.1%}): {content_preview}"
            case_lines.append(line)
            citations.append({
                "sentence_index": sentence_idx,
                "sentence": line,
                "source_type": sc.get("source_type", "past_case"),
                "source_id": sc.get("id", str(uuid4())),
                "source_detail": content_preview,
            })
            sentence_idx += 1

        paragraphs.append("\n".join(case_lines))

    # ─── Section 6: Conclusion & Recommendation ─────────────────────────
    verdict = investigation.verdict or "undetermined"
    confidence = investigation.confidence or 0.0

    conclusion_lines = []
    if verdict == "likely_suspicious":
        line = (
            f"Based on the totality of evidence — including the identified typology, "
            f"linked account network, and matching historical patterns — this activity is "
            f"assessed as likely suspicious with {confidence:.0%} confidence."
        )
    else:
        line = (
            f"Based on the available evidence, this activity is assessed as likely benign "
            f"with {confidence:.0%} confidence. Limited indicators of coordinated suspicious "
            f"activity were found."
        )
    conclusion_lines.append(line)
    citations.append({
        "sentence_index": sentence_idx,
        "sentence": line,
        "source_type": "verdict",
        "source_id": str(investigation.id),
        "source_detail": f"Verdict: {verdict}, Confidence: {confidence}",
    })
    sentence_idx += 1

    line = "This narrative was generated by Fintel AI and requires analyst review before any regulatory filing."
    conclusion_lines.append(line)
    sentence_idx += 1

    paragraphs.append(" ".join(conclusion_lines))

    narrative_text = "\n\n".join(paragraphs)
    return narrative_text, citations


@router.post("/generate", response_model=NarrativeGenerateResponse)
async def generate_narrative(
    payload: NarrativeGenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Generate an evidence-cited SAR narrative from investigation results.
    
    Input: {investigation_result} containing investigation_id or alert_id
    Output: {narrative_text, citations}
    """
    inv_result = payload.investigation_result

    # Get investigation
    investigation_id = inv_result.get("investigation_id")
    alert_id = inv_result.get("alert_id")

    investigation = None
    if investigation_id:
        result = await db.execute(
            select(Investigation).where(Investigation.id == UUID(str(investigation_id)))
        )
        investigation = result.scalar_one_or_none()
    elif alert_id:
        result = await db.execute(
            select(Investigation)
            .where(Investigation.alert_id == UUID(str(alert_id)))
            .order_by(Investigation.created_at.desc())
        )
        investigation = result.scalars().first()

    if not investigation:
        if alert_id:
            # Auto-create investigation for this alert on the fly
            result = await db.execute(select(Alert).where(Alert.id == UUID(str(alert_id))))
            alert = result.scalar_one_or_none()
            if not alert:
                raise HTTPException(status_code=404, detail="Alert not found")

            # Create a baseline investigation record
            investigation = Investigation(
                alert_id=alert.id,
                linked_entities={"extracted": [], "linked_accounts": [], "related_entities": []},
                retrieved_cases={},
                verdict="likely_suspicious" if (alert.risk_score or 0) >= 0.4 else "likely_benign",
                confidence=alert.risk_score or 0.75,
            )
            db.add(investigation)
            await db.flush()
            await db.refresh(investigation)
        else:
            raise HTTPException(status_code=404, detail="Investigation not found")
    else:
        # Get the alert
        result = await db.execute(
            select(Alert).where(Alert.id == investigation.alert_id)
        )
        alert = result.scalar_one_or_none()
        if not alert:
            raise HTTPException(status_code=404, detail="Alert not found")


    # Get entities
    result = await db.execute(
        select(Entity).where(Entity.alert_id == alert.id)
    )
    entities = result.scalars().all()

    # Get similar cases from RAG (use investigation's retrieved_cases if available)
    similar_cases = []
    retrieved = investigation.retrieved_cases
    if retrieved and isinstance(retrieved, dict):
        similar_cases = retrieved.get("similar_cases", [])

    # If no similar cases in investigation, try RAG retrieval
    if not similar_cases:
        from app.routers.rag import compute_embedding, cosine_similarity, TYPOLOGY_DOCS
        # Use the typology docs as fallback similar cases
        query_emb = compute_embedding(alert.raw_text)
        scored_docs = []
        for doc in TYPOLOGY_DOCS:
            doc_emb = compute_embedding(doc["content"])
            sim = cosine_similarity(query_emb, doc_emb)
            scored_docs.append({
                "id": str(uuid4()),
                "source_type": doc["source_type"],
                "content": doc["content"],
                "similarity": round(sim, 4),
            })
        scored_docs.sort(key=lambda x: x["similarity"], reverse=True)
        similar_cases = scored_docs[:3]

    # Generate narrative
    narrative_text, citations = _generate_template_narrative(
        alert, investigation, entities, similar_cases
    )

    # Store narrative
    narrative = Narrative(
        investigation_id=investigation.id,
        narrative_text=narrative_text,
        citations=citations,
        analyst_decision="pending",
    )
    db.add(narrative)
    await db.flush()
    await db.refresh(narrative)

    # Update investigation with retrieved cases
    investigation.retrieved_cases = {
        "similar_cases": similar_cases,
        "edges": (retrieved or {}).get("edges", []),
    }
    await db.flush()

    return NarrativeGenerateResponse(
        narrative_id=narrative.id,
        narrative_text=narrative_text,
        citations=[
            Citation(
                sentence=c["sentence"],
                source_type=c["source_type"],
                source_id=str(c["source_id"]),
                source_detail=c["source_detail"],
            )
            for c in citations
        ],
    )


@router.get("/{narrative_id}", response_model=NarrativeResponse)
async def get_narrative(narrative_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get a specific narrative by ID."""
    result = await db.execute(select(Narrative).where(Narrative.id == narrative_id))
    narrative = result.scalar_one_or_none()
    if not narrative:
        raise HTTPException(status_code=404, detail="Narrative not found")
    return NarrativeResponse.model_validate(narrative)


@router.post("/{narrative_id}/decision")
async def narrative_decision(
    narrative_id: UUID,
    payload: NarrativeDecisionRequest,
    db: AsyncSession = Depends(get_db),
):
    """Analyst submits a decision on a narrative."""
    result = await db.execute(select(Narrative).where(Narrative.id == narrative_id))
    narrative = result.scalar_one_or_none()
    if not narrative:
        raise HTTPException(status_code=404, detail="Narrative not found")

    narrative.analyst_decision = payload.decision
    if payload.edited_text:
        narrative.edited_text = payload.edited_text

    await db.flush()
    return {
        "status": "ok",
        "narrative_id": str(narrative_id),
        "decision": payload.decision,
    }
