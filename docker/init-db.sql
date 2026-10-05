-- Fintel — Database Initialization
-- This script runs on first container start via /docker-entrypoint-initdb.d/
-- Creates extensions and all tables from the locked schema (Section 4 of spec)

-- =============================================================================
-- Extensions
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS age;         -- Apache AGE for graph queries

-- Load AGE and set search path for graph operations
LOAD 'age';
-- Create the graph namespace for entity relationship traversal (ignore error if exists)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = 'Fintel_graph') THEN
        PERFORM ag_catalog.create_graph('Fintel_graph');
    END IF;
END $$;
SET search_path = public, ag_catalog, "$user";

-- =============================================================================
-- Core Tables (locked schema — do not modify without updating spec)
-- =============================================================================

-- Raw alerts/transactions (Person 2 writes here)
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_text TEXT NOT NULL,
    transaction_id VARCHAR,
    account_id VARCHAR,
    amount NUMERIC,
    currency VARCHAR(10),
    timestamp TIMESTAMPTZ,
    risk_score FLOAT,
    typology VARCHAR,               -- structuring | mule_network | rapid_movement | synthetic_identity | layering
    status VARCHAR DEFAULT 'new',   -- new | investigating | approved | rejected
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Extracted structured entities (Person 4 writes here)
CREATE TABLE IF NOT EXISTS entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID REFERENCES alerts(id),
    entity_type VARCHAR,            -- account | device | counterparty | location | amount
    entity_value VARCHAR,
    confidence FLOAT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Graph edges between entities (Person 3 writes/queries here, via AGE or recursive CTE)
CREATE TABLE IF NOT EXISTS entity_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_entity_id UUID REFERENCES entities(id),
    target_entity_id UUID REFERENCES entities(id),
    relationship VARCHAR,           -- shares_device | transacted_with | same_ip
    weight FLOAT DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Embeddings for RAG over past cases/typologies (Person 5 writes/queries here)
CREATE TABLE IF NOT EXISTS case_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type VARCHAR,            -- past_case | typology_doc
    source_id UUID,
    content TEXT,
    embedding VECTOR(384),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Agent's structured investigation output (Person 3 writes here)
CREATE TABLE IF NOT EXISTS investigations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID REFERENCES alerts(id),
    linked_entities JSONB,          -- evidence chain from graph traversal
    retrieved_cases JSONB,          -- RAG results used
    verdict VARCHAR,                -- likely_suspicious | likely_benign
    confidence FLOAT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Final GenAI narrative with citations (Person 5 writes here)
CREATE TABLE IF NOT EXISTS narratives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigation_id UUID REFERENCES investigations(id),
    narrative_text TEXT,
    citations JSONB,                -- maps sentence -> source transaction/entity id
    analyst_decision VARCHAR,       -- pending | approved | edited | rejected
    edited_text TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- Additional tables for Person 2's security data layer
-- =============================================================================

-- Synthetic KYC/customer profiles (Person 2 generates, everyone reads)
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id VARCHAR UNIQUE NOT NULL,
    full_name VARCHAR,
    date_of_birth DATE,
    address TEXT,
    phone VARCHAR,
    email VARCHAR,
    occupation VARCHAR,
    account_open_date DATE,
    risk_category VARCHAR DEFAULT 'medium',  -- low | medium | high
    kyc_complete BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- Indexes for performance
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_typology ON alerts(typology);
CREATE INDEX IF NOT EXISTS idx_alerts_account_id ON alerts(account_id);
CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp);
CREATE INDEX IF NOT EXISTS idx_alerts_risk_score ON alerts(risk_score);
CREATE INDEX IF NOT EXISTS idx_entities_alert_id ON entities(alert_id);
CREATE INDEX IF NOT EXISTS idx_entities_type_value ON entities(entity_type, entity_value);
CREATE INDEX IF NOT EXISTS idx_entity_edges_source ON entity_edges(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_edges_target ON entity_edges(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_edges_relationship ON entity_edges(relationship);
CREATE INDEX IF NOT EXISTS idx_customers_account_id ON customers(account_id);
CREATE INDEX IF NOT EXISTS idx_investigations_alert_id ON investigations(alert_id);
CREATE INDEX IF NOT EXISTS idx_narratives_investigation_id ON narratives(investigation_id);

-- Embedding similarity search index (IVFFlat for approximate nearest neighbor)
-- Note: This index needs data to be built effectively. Person 5 may want to
-- recreate this after loading embeddings.
-- CREATE INDEX IF NOT EXISTS idx_case_embeddings_vector ON case_embeddings
--     USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
