"""
Fintel Backend — Pydantic Schemas
Request/Response models for all API endpoints.
"""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


# ─── Alert Schemas ───────────────────────────────────────────────────────────

class AlertBase(BaseModel):
    raw_text: str
    transaction_id: Optional[str] = None
    account_id: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    timestamp: Optional[datetime] = None
    risk_score: Optional[float] = None
    typology: Optional[str] = None


class AlertCreate(AlertBase):
    pass


class AlertUpdate(BaseModel):
    status: Optional[str] = None
    risk_score: Optional[float] = None
    typology: Optional[str] = None


class EntityResponse(BaseModel):
    id: UUID
    alert_id: Optional[UUID] = None
    entity_type: Optional[str] = None
    entity_value: Optional[str] = None
    confidence: Optional[float] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class NarrativeResponse(BaseModel):
    id: UUID
    investigation_id: Optional[UUID] = None
    narrative_text: Optional[str] = None
    citations: Optional[dict | list] = None
    analyst_decision: Optional[str] = None
    edited_text: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class InvestigationResponse(BaseModel):
    id: UUID
    alert_id: Optional[UUID] = None
    linked_entities: Optional[dict | list] = None
    retrieved_cases: Optional[dict | list] = None
    verdict: Optional[str] = None
    confidence: Optional[float] = None
    created_at: Optional[datetime] = None
    narratives: list[NarrativeResponse] = []

    class Config:
        from_attributes = True


class AlertResponse(AlertBase):
    id: UUID
    status: Optional[str] = None
    created_at: Optional[datetime] = None
    entities: list[EntityResponse] = []
    investigations: list[InvestigationResponse] = []

    class Config:
        from_attributes = True


class AlertListResponse(BaseModel):
    id: UUID
    raw_text: str
    transaction_id: Optional[str] = None
    account_id: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    timestamp: Optional[datetime] = None
    risk_score: Optional[float] = None
    typology: Optional[str] = None
    status: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AlertDecision(BaseModel):
    decision: str = Field(..., pattern="^(approved|rejected|investigating)$")


class PaginatedAlerts(BaseModel):
    items: list[AlertListResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


# ─── NLP Schemas ─────────────────────────────────────────────────────────────

class NLPExtractRequest(BaseModel):
    raw_text: str


class ExtractedEntity(BaseModel):
    entity_type: str
    entity_value: str
    confidence: float


class NLPExtractResponse(BaseModel):
    entities: list[ExtractedEntity]
    typology_classification: str
    confidence: float


# ─── Agent / Investigation Schemas ───────────────────────────────────────────

class InvestigateRequest(BaseModel):
    alert_id: UUID


class LinkedEntity(BaseModel):
    entity_id: Optional[str] = None
    entity_type: str
    entity_value: str
    relationship: Optional[str] = None
    hop_distance: Optional[int] = None


class EvidenceChainItem(BaseModel):
    source: str
    target: str
    relationship: str
    weight: Optional[float] = None


class InvestigateResponse(BaseModel):
    investigation_id: UUID
    alert_id: UUID
    linked_entities: list[LinkedEntity]
    evidence_chain: list[EvidenceChainItem]
    verdict: str
    confidence: float


# ─── RAG Schemas ─────────────────────────────────────────────────────────────

class RAGRetrieveRequest(BaseModel):
    query_text: str
    top_k: int = 5


class SimilarCase(BaseModel):
    id: UUID
    source_type: str
    content: str
    similarity: float


class RAGRetrieveResponse(BaseModel):
    similar_cases: list[SimilarCase]


# ─── Narrative Schemas ───────────────────────────────────────────────────────

class NarrativeGenerateRequest(BaseModel):
    investigation_result: dict


class Citation(BaseModel):
    sentence: str
    source_type: str
    source_id: str
    source_detail: str


class NarrativeGenerateResponse(BaseModel):
    narrative_id: UUID
    narrative_text: str
    citations: list[Citation]


class NarrativeEditRequest(BaseModel):
    edited_text: str


class NarrativeDecisionRequest(BaseModel):
    decision: str = Field(..., pattern="^(approved|edited|rejected)$")
    edited_text: Optional[str] = None


# ─── Customer Schemas ────────────────────────────────────────────────────────

class CustomerResponse(BaseModel):
    id: UUID
    account_id: str
    full_name: Optional[str] = None
    date_of_birth: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    occupation: Optional[str] = None
    account_open_date: Optional[str] = None
    risk_category: Optional[str] = None
    kyc_complete: Optional[bool] = None

    class Config:
        from_attributes = True


# ─── Dashboard / Stats Schemas ───────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_alerts: int
    new_alerts: int
    investigating: int
    approved: int
    rejected: int
    avg_risk_score: float
    high_risk_count: int
    typology_distribution: dict[str, int]
