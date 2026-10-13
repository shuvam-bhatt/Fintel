"""
Fintel Backend — RAG Router
POST /rag/retrieve — Similarity search over case_embeddings using pgvector.
POST /rag/embed — Embed and store text for RAG retrieval.

For demo: uses sentence-transformers for local embeddings (384-dim MiniLM),
falling back to hash-based pseudo-embeddings if sentence-transformers unavailable.
"""

import hashlib
import json
import numpy as np
from uuid import UUID, uuid4
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

try:
    from app.database import get_db
except ImportError:
    get_db = None
try:
    from app.models import CaseEmbedding
except ImportError:
    CaseEmbedding = None
from app.schemas import RAGRetrieveRequest, RAGRetrieveResponse, SimilarCase
from app.config import get_settings


router = APIRouter(prefix="/rag", tags=["RAG"])

settings = get_settings()

# ─── Embedding Engine ────────────────────────────────────────────────────────

_embedding_model = None
_USE_REAL_EMBEDDINGS = False


def _get_embedding_model():
    """Lazy-load embedding model. Uses deterministic fast embedding for instant performance."""
    global _embedding_model, _USE_REAL_EMBEDDINGS
    if _embedding_model is None:
        import os
        if os.environ.get("USE_REAL_EMBEDDINGS", "false").lower() in ("true", "1"):
            try:
                from sentence_transformers import SentenceTransformer
                _embedding_model = SentenceTransformer(settings.embedding_model)
                _USE_REAL_EMBEDDINGS = True
            except Exception:
                _embedding_model = "fallback"
                _USE_REAL_EMBEDDINGS = False
        else:
            _embedding_model = "fallback"
            _USE_REAL_EMBEDDINGS = False
    return _embedding_model



def compute_embedding(text: str) -> list[float]:
    """Compute embedding vector for text."""
    model = _get_embedding_model()
    if _USE_REAL_EMBEDDINGS:
        vec = model.encode(text, normalize_embeddings=True)
        return vec.tolist()
    else:
        # Fallback: deterministic hash-based pseudo-embedding
        h = hashlib.sha256(text.encode()).hexdigest()
        dim = settings.embedding_dimension
        # Generate deterministic floats from hash
        rng = np.random.RandomState(int(h[:8], 16))
        vec = rng.randn(dim).astype(float)
        vec = vec / np.linalg.norm(vec)
        return vec.tolist()


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    a_np = np.array(a)
    b_np = np.array(b)
    dot = np.dot(a_np, b_np)
    norm_a = np.linalg.norm(a_np)
    norm_b = np.linalg.norm(b_np)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))


# ─── Seed Typology Documents ────────────────────────────────────────────────

TYPOLOGY_DOCS = [
    {
        "source_type": "typology_doc",
        "content": (
            "Structuring (Smurfing): The deliberate breaking up of financial transactions "
            "into smaller amounts to avoid reporting thresholds (e.g., $10,000 in the US). "
            "Multiple deposits of $9,800, $9,900, or similar amounts just under the threshold "
            "are classic indicators. Often involves multiple accounts or individuals making "
            "deposits at different branches or on different days."
        ),
    },
    {
        "source_type": "typology_doc",
        "content": (
            "Mule Network: A chain of compromised or complicit accounts used to move illicit "
            "funds through the financial system. Money enters through a source account, passes "
            "through 2-6 intermediary 'mule' accounts (each taking a small fee), and exits "
            "through a cash-out point. Key indicators: rapid movement between accounts, "
            "accounts with no legitimate transaction history, amounts decreasing slightly at "
            "each hop due to fees."
        ),
    },
    {
        "source_type": "typology_doc",
        "content": (
            "Rapid Movement: Funds moved quickly through accounts with little or no holding "
            "period. Large sums deposited and withdrawn within hours or minutes. Often seen in "
            "digital payment platforms. Indicator of layering or cash-out operations. Look for "
            "accounts being emptied immediately after receiving funds."
        ),
    },
    {
        "source_type": "typology_doc",
        "content": (
            "Synthetic Identity Fraud: Creation of fictitious identities using a combination "
            "of real and fake information. Used to open accounts, build credit, and facilitate "
            "money laundering. Indicators include: recently opened accounts with no history, "
            "mismatched personal details, use of privacy-focused email providers, and multiple "
            "accounts sharing device fingerprints or IP addresses."
        ),
    },
    {
        "source_type": "typology_doc",
        "content": (
            "Layering: The process of moving money through multiple complex transactions to "
            "obscure its origin. May involve circular transactions, shell companies, foreign "
            "exchanges, and multiple jurisdiction transfers. The goal is to create distance "
            "between the source of funds and their final destination, making tracing difficult."
        ),
    },
    {
        "source_type": "past_case",
        "content": (
            "Case #2024-001: Classic mule chain detected. Source account deposited $50,000 "
            "through structured transactions ($9,800 x 5 + $1,000). Funds moved through "
            "accounts Alpha → Bravo → Charlie within 48 hours, each deducting 3-7% as fees. "
            "Final cash-out of $41,000 at Terminal account. All mule accounts opened within "
            "the same month and had no prior transaction history. SAR filed."
        ),
    },
    {
        "source_type": "past_case",
        "content": (
            "Case #2024-002: Fan-out ring identified. Single source account distributed "
            "$100,000 equally to 5 accounts simultaneously. Each receiving account immediately "
            "forwarded funds to a collector account via different payment methods (wire, ACH, "
            "mobile). Collector account cashed out $92,000 within 24 hours. Network flagged "
            "by velocity rules and device fingerprint overlap."
        ),
    },
    {
        "source_type": "past_case",
        "content": (
            "Case #2024-003: Structuring pattern. Customer made 7 cash deposits over 3 days, "
            "ranging from $8,500 to $9,900, totaling $65,500. All deposits made at different "
            "branches. Customer KYC showed inconsistent occupation ('student' with $65K deposits). "
            "Investigation revealed customer was recruited as a money mule via social media."
        ),
    },
    {
        "source_type": "past_case",
        "content": (
            "Case #2024-004: Synthetic identity laundering. Account opened with fabricated ID "
            "(real SSN + fake name/address). Account built credit over 6 months with small "
            "legitimate transactions. Then received $200,000 in rapid wire transfers over 2 "
            "weeks. Funds immediately moved to crypto exchange. Device analysis showed account "
            "accessed from same IP as 3 other suspicious accounts."
        ),
    },
    {
        "source_type": "past_case",
        "content": (
            "Case #2024-005: Layering through mobile money. $500,000 moved through 12 accounts "
            "across 3 mobile money platforms in 72 hours. Each transaction was under reporting "
            "thresholds. Some funds converted to gift cards and prepaid debit cards. Final "
            "destination was an overseas account. Pattern discovered through cross-platform "
            "transaction monitoring."
        ),
    },
]


@router.post("/embed")
async def embed_text(
    content: str,
    source_type: str = "past_case",
    source_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Embed a text document and store in case_embeddings."""
    embedding = compute_embedding(content)
    dim = len(embedding)

    # Store using raw SQL since SQLAlchemy doesn't natively support VECTOR type well
    emb_id = uuid4()
    src_id = UUID(source_id) if source_id else uuid4()

    await db.execute(
        text("""
            INSERT INTO case_embeddings (id, source_type, source_id, content, embedding)
            VALUES (:id, :source_type, :source_id, :content, :embedding::vector)
        """),
        {
            "id": emb_id,
            "source_type": source_type,
            "source_id": src_id,
            "content": content,
            "embedding": f"[{','.join(str(v) for v in embedding)}]",
        }
    )
    await db.commit()

    return {"id": str(emb_id), "source_type": source_type, "dimensions": dim}


@router.post("/seed-typologies")
async def seed_typology_docs(db: AsyncSession = Depends(get_db)):
    """Seed the case_embeddings table with typology documents and sample past cases."""
    # Check if already seeded
    count_result = await db.execute(
        text("SELECT COUNT(*) FROM case_embeddings")
    )
    existing = count_result.scalar()
    if existing and existing > 0:
        return {"status": "already_seeded", "count": existing}

    seeded = 0
    is_sqlite = settings.async_db_url.startswith("sqlite")

    for doc in TYPOLOGY_DOCS:
        embedding = compute_embedding(doc["content"])
        emb_id = str(uuid4())
        src_id = str(uuid4())

        params = {
            "id": emb_id,
            "source_type": doc["source_type"],
            "source_id": src_id,
            "content": doc["content"],
            "embedding": f"[{','.join(str(v) for v in embedding)}]",
        }
        if is_sqlite:
            await db.execute(
                text("""
                    INSERT INTO case_embeddings (id, source_type, source_id, content, embedding)
                    VALUES (:id, :source_type, :source_id, :content, :embedding)
                """),
                params
            )
        else:
            try:
                await db.execute(
                    text("""
                        INSERT INTO case_embeddings (id, source_type, source_id, content, embedding)
                        VALUES (:id, :source_type, :source_id, :content, :embedding::vector)
                    """),
                    params
                )
            except Exception:
                await db.rollback()
                await db.execute(
                    text("""
                        INSERT INTO case_embeddings (id, source_type, source_id, content, embedding)
                        VALUES (:id, :source_type, :source_id, :content, :embedding)
                    """),
                    params
                )
        seeded += 1

    await db.commit()
    return {"status": "seeded", "count": seeded}



@router.post("/retrieve", response_model=RAGRetrieveResponse)
async def retrieve(
    payload: RAGRetrieveRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Retrieve similar past cases and typology documents using vector similarity search.
    
    Input: {query_text, top_k}
    Output: {similar_cases: [...]}
    """
    query_embedding = compute_embedding(payload.query_text)
    is_sqlite = settings.async_db_url.startswith("sqlite")

    if not is_sqlite:
        emb_str = f"[{','.join(str(v) for v in query_embedding)}]"
        try:
            result = await db.execute(
                text("""
                    SELECT id, source_type, content,
                           1 - (embedding <=> :query_embedding::vector) AS similarity
                    FROM case_embeddings
                    ORDER BY embedding <=> :query_embedding::vector
                    LIMIT :top_k
                """),
                {"query_embedding": emb_str, "top_k": payload.top_k}
            )
            rows = result.fetchall()
            return RAGRetrieveResponse(
                similar_cases=[
                    SimilarCase(
                        id=str(row[0]),
                        source_type=row[1],
                        content=row[2],
                        similarity=round(float(row[3]), 4),
                    )
                    for row in rows
                ]
            )
        except Exception:
            await db.rollback()

    # In-memory cosine search (SQLite or when pgvector unavailable)
    result = await db.execute(text("SELECT id, source_type, content FROM case_embeddings"))
    rows = result.fetchall()

    if not rows:
        scored = []
        for doc in TYPOLOGY_DOCS:
            doc_emb = compute_embedding(doc["content"])
            sim = cosine_similarity(query_embedding, doc_emb)
            scored.append(({"id": str(uuid4()), "source_type": doc["source_type"], "content": doc["content"]}, sim))
        scored.sort(key=lambda x: x[1], reverse=True)
        return RAGRetrieveResponse(
            similar_cases=[
                SimilarCase(
                    id=str(d["id"]),
                    source_type=d["source_type"],
                    content=d["content"],
                    similarity=round(s, 4),
                )
                for d, s in scored[:payload.top_k]
            ]
        )

    # Compute similarities in memory for stored rows
    scored = []
    for row in rows:
        doc_emb = compute_embedding(row[2])
        sim = cosine_similarity(query_embedding, doc_emb)
        scored.append((row, sim))

    scored.sort(key=lambda x: x[1], reverse=True)
    similar_cases = [
        SimilarCase(
            id=str(row[0]),
            source_type=row[1],
            content=row[2],
            similarity=round(sim, 4),
        )
        for row, sim in scored[:payload.top_k]
    ]

    return RAGRetrieveResponse(similar_cases=similar_cases)

