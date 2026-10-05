"""
Fintel Backend — SQLAlchemy ORM Models
Maps to the locked schema from Section 4 of the spec.
"""

import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, Numeric, Float, Boolean, Date,
    DateTime, ForeignKey, Index, text
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.database import Base


class Alert(Base):
    """Raw alerts/transactions — Person 2 writes here."""
    __tablename__ = "alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    raw_text = Column(Text, nullable=False)
    transaction_id = Column(String)
    account_id = Column(String)
    amount = Column(Numeric)
    currency = Column(String(10))
    timestamp = Column(DateTime(timezone=True))
    risk_score = Column(Float)
    typology = Column(String)
    status = Column(String, default="new")
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))

    # Relationships
    entities = relationship("Entity", back_populates="alert", lazy="selectin")
    investigations = relationship("Investigation", back_populates="alert", lazy="selectin")


class Entity(Base):
    """Extracted structured entities — Person 4 writes here."""
    __tablename__ = "entities"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    alert_id = Column(UUID(as_uuid=True), ForeignKey("alerts.id"))
    entity_type = Column(String)
    entity_value = Column(String)
    confidence = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))

    alert = relationship("Alert", back_populates="entities")
    source_edges = relationship("EntityEdge", foreign_keys="EntityEdge.source_entity_id", back_populates="source_entity")
    target_edges = relationship("EntityEdge", foreign_keys="EntityEdge.target_entity_id", back_populates="target_entity")


class EntityEdge(Base):
    """Graph edges between entities — Person 3 writes/queries here."""
    __tablename__ = "entity_edges"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_entity_id = Column(UUID(as_uuid=True), ForeignKey("entities.id"))
    target_entity_id = Column(UUID(as_uuid=True), ForeignKey("entities.id"))
    relationship_type = Column("relationship", String)
    weight = Column(Float, default=1.0)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))

    source_entity = relationship("Entity", foreign_keys=[source_entity_id], back_populates="source_edges")
    target_entity = relationship("Entity", foreign_keys=[target_entity_id], back_populates="target_edges")


class CaseEmbedding(Base):
    """Embeddings for RAG over past cases/typologies — Person 5 writes/queries here."""
    __tablename__ = "case_embeddings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_type = Column(String)
    source_id = Column(UUID(as_uuid=True))
    content = Column(Text)
    # embedding stored as VECTOR(1536) — we use raw SQL for vector ops
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))


class Investigation(Base):
    """Agent's structured investigation output — Person 3 writes here."""
    __tablename__ = "investigations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    alert_id = Column(UUID(as_uuid=True), ForeignKey("alerts.id"))
    linked_entities = Column(JSONB)
    retrieved_cases = Column(JSONB)
    verdict = Column(String)
    confidence = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))

    alert = relationship("Alert", back_populates="investigations")
    narratives = relationship("Narrative", back_populates="investigation", lazy="selectin")


class Narrative(Base):
    """Final GenAI narrative with citations — Person 5 writes here."""
    __tablename__ = "narratives"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    investigation_id = Column(UUID(as_uuid=True), ForeignKey("investigations.id"))
    narrative_text = Column(Text)
    citations = Column(JSONB)
    analyst_decision = Column(String, default="pending")
    edited_text = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))

    investigation = relationship("Investigation", back_populates="narratives")


class Customer(Base):
    """Synthetic KYC/customer profiles."""
    __tablename__ = "customers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id = Column(String, unique=True, nullable=False)
    full_name = Column(String)
    date_of_birth = Column(Date)
    address = Column(Text)
    phone = Column(String)
    email = Column(String)
    occupation = Column(String)
    account_open_date = Column(Date)
    risk_category = Column(String, default="medium")
    kyc_complete = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
