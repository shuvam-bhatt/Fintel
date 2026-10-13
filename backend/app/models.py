"""
Fintel Backend — SQLAlchemy ORM Models
Maps to the locked schema from Section 4 of the spec.
Supports both PostgreSQL and SQLite.
"""

import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, Numeric, Float, Boolean, Date,
    DateTime, ForeignKey, Index, text, Uuid, JSON, func
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB
from sqlalchemy.orm import relationship
from app.database import Base

from sqlalchemy.types import TypeDecorator, CHAR


class GUID(TypeDecorator):
    """Platform-independent GUID type.
    Uses PostgreSQL's native UUID, otherwise CHAR(36) stringified UUID.
    """
    impl = CHAR(36)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        if dialect.name == "postgresql":
            return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        if isinstance(value, uuid.UUID):
            return value
        return uuid.UUID(str(value))


UUID_TYPE = GUID
JSON_TYPE = JSON().with_variant(JSONB, "postgresql")



class Alert(Base):
    """Raw alerts/transactions — Person 2 writes here."""
    __tablename__ = "alerts"

    id = Column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    raw_text = Column(Text, nullable=False)
    transaction_id = Column(String)
    account_id = Column(String)
    amount = Column(Numeric)
    currency = Column(String(10))
    timestamp = Column(DateTime(timezone=True))
    risk_score = Column(Float)
    typology = Column(String)
    status = Column(String, default="new")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    entities = relationship("Entity", back_populates="alert", lazy="selectin")
    investigations = relationship("Investigation", back_populates="alert", lazy="selectin")


class Entity(Base):
    """Extracted structured entities — Person 4 writes here."""
    __tablename__ = "entities"

    id = Column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    alert_id = Column(UUID_TYPE, ForeignKey("alerts.id"))
    entity_type = Column(String)
    entity_value = Column(String)
    confidence = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    alert = relationship("Alert", back_populates="entities")
    source_edges = relationship("EntityEdge", foreign_keys="EntityEdge.source_entity_id", back_populates="source_entity")
    target_edges = relationship("EntityEdge", foreign_keys="EntityEdge.target_entity_id", back_populates="target_entity")


class EntityEdge(Base):
    """Graph edges between entities — Person 3 writes/queries here."""
    __tablename__ = "entity_edges"

    id = Column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    source_entity_id = Column(UUID_TYPE, ForeignKey("entities.id"))
    target_entity_id = Column(UUID_TYPE, ForeignKey("entities.id"))
    relationship_type = Column("relationship", String)
    weight = Column(Float, default=1.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    source_entity = relationship("Entity", foreign_keys=[source_entity_id], back_populates="source_edges")
    target_entity = relationship("Entity", foreign_keys=[target_entity_id], back_populates="target_edges")


class CaseEmbedding(Base):
    """Embeddings for RAG over past cases/typologies — Person 5 writes/queries here."""
    __tablename__ = "case_embeddings"

    id = Column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    source_type = Column(String)
    source_id = Column(UUID_TYPE)
    content = Column(Text)
    embedding = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Investigation(Base):
    """Agent's structured investigation output — Person 3 writes here."""
    __tablename__ = "investigations"

    id = Column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    alert_id = Column(UUID_TYPE, ForeignKey("alerts.id"))
    linked_entities = Column(JSON_TYPE)
    retrieved_cases = Column(JSON_TYPE)
    verdict = Column(String)
    confidence = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    alert = relationship("Alert", back_populates="investigations")
    narratives = relationship("Narrative", back_populates="investigation", lazy="selectin")


class Narrative(Base):
    """Final GenAI narrative with citations — Person 5 writes here."""
    __tablename__ = "narratives"

    id = Column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    investigation_id = Column(UUID_TYPE, ForeignKey("investigations.id"))
    narrative_text = Column(Text)
    citations = Column(JSON_TYPE)
    analyst_decision = Column(String, default="pending")
    edited_text = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    investigation = relationship("Investigation", back_populates="narratives")


class Customer(Base):
    """Synthetic KYC/customer profiles."""
    __tablename__ = "customers"

    id = Column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
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
    created_at = Column(DateTime(timezone=True), server_default=func.now())

