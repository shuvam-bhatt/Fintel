# Fintel — Project Specification & Development Brief

**An AI Investigation Copilot for AML Case-Building and SAR Narrative Drafting, Using LLM Agents, Knowledge Graphs, and RAG**

> This document is a build-ready spec for a 5-person, 5-week final-year capstone. It's written to be handed directly to an agentic coding tool (e.g. Antigravity) or used by the team as the single source of truth. It defines the problem, architecture, database schema, API contracts between modules, per-person weekly tasks, and evaluation criteria.

---

## 1. Problem Statement

Fraud/AML detection tools at financial institutions already work — alerts, risk scores, and rule engines reliably flag suspicious activity. The real bottleneck is what happens **after** an alert fires:

- Analysts manually gather transaction history, customer (KYC) data, and related-account information from multiple systems before they can even begin assessing a case — this evidence-gathering stage is typically the single most time-consuming part of an investigation.
- When a case is confirmed suspicious, analysts must write a **SAR (Suspicious Activity Report)** for regulators. Narrative drafting alone can consume up to 70% of an investigator's working time, even though most of that work (pulling data, sequencing events, structuring facts) requires no real judgment.
- This workload is a documented burnout driver in the industry — a large share of AML compliance professionals report considering leaving the field due to it.

**The constraint that makes this a real system, not a toy demo:** every fact in an AI-generated case narrative must be traceable back to a real source transaction/record. Regulators will not accept fabricated or unsupported claims, so the system must cite evidence, not just generate fluent text.

## 2. Solution — Core Workflow

```
Alert fires
   → Transaction + customer data assembled
   → NLP extracts structured entities (accounts, amounts, counterparties, dates)
   → Agent investigates: traces linked accounts/devices via knowledge graph (mule-network detection)
   → RAG retrieves similar past cases / typology definitions
   → GenAI drafts an evidence-cited case narrative (who / what / when / where / why)
   → Analyst reviews the narrative side-by-side with source transactions
   → Analyst approves, edits, or rejects — nothing is filed automatically
```

**Scope discipline:** build this one workflow end-to-end and well. No auto-filing, no multi-tenant features, no scope creep beyond what supports this loop.

---

## 3. Tech Stack (locked — do not deviate mid-project)

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router) + Tailwind + shadcn/ui |
| Backend API | FastAPI (Python 3.11+) |
| Database | PostgreSQL 16 + `pgvector` extension (embeddings) + `Apache AGE` extension (graph/Cypher queries) — **one database, no separate graph DB** |
| Agent orchestration | LangChain + LangGraph |
| LLM | Claude API (or OpenAI, pick one and standardize) |
| Monitoring | Prometheus (metrics) + Grafana (dashboards) |
| NLP models | spaCy or HuggingFace transformers for NER; scikit-learn/lightweight classifier for typology classification |
| Containerization | Docker Compose (Postgres+AGE+pgvector, Prometheus, Grafana, API, frontend all as services) |

Everyone runs `docker compose up` on day one so no one is blocked by environment setup.

---

## 4. Database Schema (shared spine — lock this Week 1, everyone builds against it)

```sql
-- Raw alerts/transactions (Person 2 writes here)
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_text TEXT NOT NULL,
    transaction_id VARCHAR,
    account_id VARCHAR,
    amount NUMERIC,
    currency VARCHAR(10),
    timestamp TIMESTAMPTZ,
    risk_score FLOAT,
    typology VARCHAR,          -- e.g. 'structuring', 'mule_network', 'synthetic_identity'
    status VARCHAR DEFAULT 'new', -- new | investigating | approved | rejected
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Extracted structured entities (Person 4 writes here)
CREATE TABLE entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID REFERENCES alerts(id),
    entity_type VARCHAR,       -- account | device | counterparty | location | amount
    entity_value VARCHAR,
    confidence FLOAT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Graph edges between entities (Person 3 writes/queries here, via AGE or recursive CTE)
CREATE TABLE entity_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_entity_id UUID REFERENCES entities(id),
    target_entity_id UUID REFERENCES entities(id),
    relationship VARCHAR,      -- shares_device | transacted_with | same_ip
    weight FLOAT DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Embeddings for RAG over past cases/typologies (Person 5 writes/queries here)
CREATE TABLE case_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type VARCHAR,       -- past_case | typology_doc
    source_id UUID,
    content TEXT,
    embedding VECTOR(1536),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Agent's structured investigation output (Person 3 writes here)
CREATE TABLE investigations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID REFERENCES alerts(id),
    linked_entities JSONB,      -- evidence chain from graph traversal
    retrieved_cases JSONB,      -- RAG results used
    verdict VARCHAR,            -- likely_suspicious | likely_benign
    confidence FLOAT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Final GenAI narrative with citations (Person 5 writes here)
CREATE TABLE narratives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigation_id UUID REFERENCES investigations(id),
    narrative_text TEXT,
    citations JSONB,            -- maps sentence -> source transaction/entity id
    analyst_decision VARCHAR,   -- pending | approved | edited | rejected
    edited_text TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 5. API Contracts Between Modules (hard boundaries — prevents overlap between #3/#4/#5)

Structure flows **one direction only**: raw text → structured signals (Person 4) → decision/correlation (Person 3) → grounded narrative (Person 5) → UI (Person 1). No one reaches backward into another person's logic or table directly — always through these endpoints.

| Endpoint | Owner | Input → Output |
|---|---|---|
| `POST /nlp/extract` | Person 4 | `{raw_text}` → `{entities: [...], typology_classification, confidence}` |
| `POST /agent/investigate` | Person 3 | `{alert_id}` → `{linked_entities, evidence_chain, verdict, confidence}` (internally calls `/nlp/extract` and `/rag/retrieve`) |
| `POST /rag/retrieve` | Person 5 | `{query_text, top_k}` → `{similar_cases: [...]}` |
| `POST /narrative/generate` | Person 5 | `{investigation_result}` → `{narrative_text, citations}` |
| `GET /alerts`, `GET /alerts/{id}`, `POST /alerts/{id}/decision` | Person 1 (frontend) / Person 2 (backend data) | Standard CRUD + analyst decision capture |
| `GET /metrics/*` | Person 5 | Prometheus scrape endpoints |

---

## 6. Team Roles

| # | Role | Owns |
|---|---|---|
| 1 | Web Dashboard | Alert queue UI, case detail/timeline view, narrative-with-citations viewer, approve/edit/reject controls, embedded Grafana panels |
| 2 | Cybersecurity / Fraud Data Layer | Transaction data ingestion, risk scoring rules, typology tagging, synthetic mule-network attack scenarios for the demo |
| 3 | LangChain Agents + Knowledge Graph | Investigation agent (LangGraph), graph schema + traversal (AGE/CTE), mule-network correlation logic, structured investigation output |
| 4 | NLP | NER extraction, typology/alert classification, raw text → structured entities |
| 5 | GenAI + pgvector RAG + Monitoring | Embedding pipeline, RAG retrieval, GenAI narrative generation with citation grounding, Prometheus/Grafana dashboards |

---

## 7. Datasets

- **IEEE-CIS Fraud Detection** (Kaggle) — transaction-level fraud data
- **PaySim** — synthetic mobile money dataset, good for simulating mule/laundering networks
- **Synthetic KYC/customer profiles** — generate yourselves (a simple Python Faker script is fine; real KYC data isn't public)

---

## 8. Five-Week Plan

### Week 1 — Foundation (all 5, in parallel)
- **All:** Finalize and lock the schema above. Set up shared Docker Compose environment (Postgres+AGE+pgvector, Prometheus, Grafana skeleton). Agree on API contracts exactly as specified.
- **Person 1:** Scaffold Next.js app, routing, auth stub, empty alert-list page hitting a mock endpoint.
- **Person 2:** Load IEEE-CIS + PaySim into `alerts` table. Write basic risk-scoring rule (velocity/amount thresholds). Define 4–5 typology categories.
- **Person 3:** Set up Apache AGE extension, design the entity/edge graph model, write first Cypher/CTE traversal query on dummy data.
- **Person 4:** Build baseline NER pipeline (spaCy) on sample transaction notes/KYC text. Stub `/nlp/extract` endpoint.
- **Person 5:** Set up pgvector table, build embedding pipeline for a handful of seed "past case" documents. Prometheus + Grafana containers running with a dummy metric.

### Week 2 — Core Pipelines
- **Person 1:** Alert detail page (static data). Basic case-status workflow UI (new/investigating/approved/rejected).
- **Person 2:** Finish typology tagging for all synthetic scenarios (including at least one mule-network scenario spanning 4–6 linked accounts). Severity scoring finalized.
- **Person 3:** `/agent/investigate` skeleton — LangGraph pipeline calling `/nlp/extract`, writing linked entities to `entity_edges`.
- **Person 4:** `/nlp/extract` fully functional — entities + typology classification returned as real JSON, plugged into `entities` table.
- **Person 5:** `/rag/retrieve` functional — real similarity search over `case_embeddings`. Start drafting narrative generation prompt template (must enforce citation to source data).

### Week 3 — Intelligence Layer
- **Person 1:** Build the case-investigation view: evidence timeline, linked-entity visualization (simple graph render, e.g. via `react-flow` or `vis-network`).
- **Person 2:** Support Person 3 in validating graph correlation against known scenarios; tune risk thresholds based on false-positive testing.
- **Person 3:** Full investigation agent — graph traversal correctly surfaces mule-network links in test scenarios; verdict + confidence output finalized and written to `investigations`.
- **Person 4:** Improve classification accuracy; add confidence scoring; handle edge cases (missing fields, malformed text).
- **Person 5:** `/narrative/generate` producing full narratives with sentence-level citations back to `alerts`/`entities`. Grafana dashboard: alert volume, agent latency panels live.

### Week 4 — Integration
- **All:** Wire the full pipeline end-to-end: `alert → /nlp/extract → /agent/investigate → /rag/retrieve → /narrative/generate → UI`.
- **Person 1:** Narrative viewer with clickable citations (click a sentence → highlight source transaction). Approve/Edit/Reject wired to `narratives` table.
- **Person 2:** Run all demo scenarios through the full pipeline; log ground-truth labels for evaluation.
- **Person 3 & 4:** Debug handoff points; fix extraction/correlation errors surfaced by real end-to-end runs.
- **Person 5:** Finalize Grafana panels for evaluation metrics (below). Start collecting real numbers.

### Week 5 — Evaluation, Polish, Demo
- **All:** Run the full evaluation suite (Section 9). Fix any remaining bugs. Rehearse a live demo covering: alert intake → AI investigation → cited narrative → analyst approval.
- **Person 1:** UI polish, empty/error states, responsive check.
- **Person 2:** Finalize scenario documentation (what each demo case is supposed to prove).
- **Person 3:** Document agent architecture/decisions for the report.
- **Person 4:** Final accuracy numbers on held-out labeled data.
- **Person 5:** Final Grafana dashboard screenshots/export for the report; retrieval quality numbers.
- **All:** Write individual contribution sections for the report/paper.

---

## 9. Evaluation Metrics

| Metric | What it proves | How to measure |
|---|---|---|
| Evidence traceability rate | Narratives are grounded, not hallucinated | % of narrative sentences with a valid citation to a real record |
| Investigation time saved | Core value proposition | Manual case-building time (timed by team) vs. AI-assisted time |
| Analyst edit rate | Quality of AI draft | % of AI narrative text kept unedited after review |
| Mule-network detection accuracy | Graph correlation works | Does traversal correctly find all accounts in your simulated rings |
| Classification accuracy (NLP) | Entity extraction/typology quality | Precision/recall on held-out labeled subset |
| RAG retrieval quality | Retrieval is relevant, not noise | Precision@k on a small hand-labeled query set |

---

## 10. Notes for the Build Agent (Antigravity)

- Build order should follow the API contracts in Section 5 — implement each endpoint as a standalone, independently testable service before wiring the full chain.
- Use the schema in Section 4 exactly as given; do not introduce new tables without updating this doc.
- Every LLM-generated narrative **must** include a `citations` field mapping claims to source rows — treat any ungrounded narrative output as a bug, not a stylistic choice.
- Seed the database with the datasets in Section 7 before agent/NLP components are tested — do not develop against empty tables.
- Docker Compose should bring up all services (Postgres+AGE+pgvector, API, frontend, Prometheus, Grafana) with a single command for the whole team.