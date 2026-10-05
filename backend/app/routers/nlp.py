"""
Fintel Backend — NLP Router
POST /nlp/extract — Entity extraction + typology classification from raw alert text.
Uses rule-based NER with regex patterns (no spaCy model download needed for demo).
"""

import re
import hashlib
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

try:
    from app.database import get_db
except ImportError:
    get_db = None
try:
    from app.models import Entity, Alert
except ImportError:
    Entity, Alert = None, None
from app.schemas import NLPExtractRequest, NLPExtractResponse, ExtractedEntity

router = APIRouter(prefix="/nlp", tags=["NLP"])



# ─── Rule-Based Entity Extraction ────────────────────────────────────────────

# Regex patterns for financial entity extraction
PATTERNS = {
    "amount": [
        r"\$[\d,]+\.?\d*",
        r"(?:USD|EUR|GBP)\s*[\d,]+\.?\d*",
        r"[\d,]+\.?\d*\s*(?:USD|EUR|GBP)",
    ],
    "account": [
        r"(?:account|acct)[:\s#]*([A-Z0-9\-]+)",
        r"(?:C\d{5,})",
        r"(?:MULE-[A-Z0-9\-]+)",
        r"(?:IEEE-[a-zA-Z0-9]+)",
        r"(?:PSIM-[A-Z0-9\-]+)",
        r"(?:M\d{5,})",
    ],
    "counterparty": [
        r"(?:recipient|payee|beneficiary|merchant)[:\s]*([A-Za-z0-9\s]+?)(?:\.|,|$)",
        r"Recipient(?:\s+account)?:\s*(?:merchant\s+)?([A-Z0-9\-]+)",
    ],
    "device": [
        r"(?:device|Device)[:\s]*([A-Za-z0-9\s]+?)(?:\.|,|$)",
        r"(?:Windows|MacOS|iOS|Android|Linux|desktop|mobile)",
        r"(?:IP|ip)[:\s]*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})",
    ],
    "location": [
        r"(?:region|Region|billing region|Billing region)[:\s]*(?:code\s*)?(\d+)",
        r"(?:country|Country|billing country|Billing country)[:\s]*(?:code\s*)?(\d+)",
    ],
    "email_domain": [
        r"(?:email domain|Email domain)[:\s]*([a-zA-Z0-9\.\-]+\.\w+)",
    ],
}

# Typology classification keywords
TYPOLOGY_KEYWORDS = {
    "structuring": [
        "structured", "structuring", "below threshold", "under $10,000",
        "split", "multiple small", "smurfing", "9,800", "9,900", "9,750",
        "just under", "cash deposit",
    ],
    "mule_network": [
        "mule", "chain", "pass-through", "forwarded", "emptied",
        "rapid transfer", "funnel", "fan-out", "layering",
        "balance unchanged", "fully emptied",
    ],
    "rapid_movement": [
        "rapid", "quick succession", "same day", "within minutes",
        "high velocity", "burst", "large amount", "19,900",
    ],
    "synthetic_identity": [
        "synthetic", "fake identity", "new account", "no history",
        "mismatched", "protonmail", "temporary email",
    ],
    "layering": [
        "layer", "complex", "multiple hops", "circular",
        "round-trip", "shell company",
    ],
}


def extract_entities(text: str) -> list[ExtractedEntity]:
    """Extract financial entities from raw text using regex patterns."""
    entities = []
    seen = set()

    for entity_type, patterns in PATTERNS.items():
        for pattern in patterns:
            matches = re.finditer(pattern, text, re.IGNORECASE)
            for match in matches:
                # Use first capturing group if present, else full match
                value = match.group(1) if match.lastindex else match.group(0)
                value = value.strip().rstrip(".,;")

                # Skip very short or empty values
                if len(value) < 2:
                    continue

                # Deduplicate
                key = f"{entity_type}:{value.lower()}"
                if key in seen:
                    continue
                seen.add(key)

                # Calculate confidence based on pattern specificity
                confidence = 0.85 if match.lastindex else 0.75

                entities.append(ExtractedEntity(
                    entity_type=entity_type,
                    entity_value=value,
                    confidence=round(confidence, 2),
                ))

    return entities


def classify_typology(text: str) -> tuple[str, float]:
    """Classify alert text into a typology category."""
    text_lower = text.lower()

    # Check for direct typology indicator (e.g., 'Typology: mule_network' or 'Typology: structuring')
    direct_match = re.search(r"typology[:\s]+([a-z_]+)", text_lower)
    if direct_match:
        matched = direct_match.group(1).strip()
        if matched in TYPOLOGY_KEYWORDS:
            return matched, 0.95

    scores = {}

    for typology, keywords in TYPOLOGY_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw.lower() in text_lower)
        if score > 0:
            scores[typology] = score

    if not scores:
        return "unclassified", 0.0

    # Normalize scores
    max_score = max(scores.values())
    total = sum(scores.values())
    best_typology = max(scores, key=scores.get)
    confidence = round(max_score / max(total, 1), 2)

    return best_typology, min(confidence, 0.95)



@router.post("/extract", response_model=NLPExtractResponse)
async def extract(
    payload: NLPExtractRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Extract structured entities and classify typology from raw alert text.
    
    Input: {raw_text}
    Output: {entities: [...], typology_classification, confidence}
    """
    raw_text = payload.raw_text

    # Extract entities
    entities = extract_entities(raw_text)

    # Classify typology
    typology, confidence = classify_typology(raw_text)

    return NLPExtractResponse(
        entities=entities,
        typology_classification=typology,
        confidence=confidence,
    )


@router.post("/extract-and-store")
async def extract_and_store(
    alert_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Extract entities from an alert's raw_text and store them in the entities table."""
    # Get the alert
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    # Extract
    entities = extract_entities(alert.raw_text)
    typology, confidence = classify_typology(alert.raw_text)

    # Store entities
    stored = []
    for ent in entities:
        db_entity = Entity(
            alert_id=alert_id,
            entity_type=ent.entity_type,
            entity_value=ent.entity_value,
            confidence=ent.confidence,
        )
        db.add(db_entity)
        stored.append(ent)

    # Update alert typology if currently unclassified
    if alert.typology in (None, "unclassified") and typology != "unclassified":
        alert.typology = typology

    await db.flush()

    return {
        "alert_id": str(alert_id),
        "entities_stored": len(stored),
        "typology_classification": typology,
        "confidence": confidence,
    }
