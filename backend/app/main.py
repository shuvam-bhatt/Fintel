"""
Fintel Backend — Main Application
FastAPI entry point with all routers registered and CORS + Prometheus middleware.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

from app.config import get_settings
from app.routers import alerts, nlp, agent, rag, narrative, seed

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — runs on startup and shutdown."""
    print(f"[STARTUP] Fintel API starting - {settings.app_name} v{settings.app_version}")
    print(f"   Database URL: {settings.async_db_url}")
    print(f"   LLM Provider: {settings.llm_provider} ({settings.llm_model})")
    
    # Initialize tables
    from app.database import init_db, async_session_factory
    from app.models import Alert
    from sqlalchemy import select, func
    try:
        await init_db()
        async with async_session_factory() as session:
            count_res = await session.execute(select(func.count()).select_from(Alert))
            total_alerts = count_res.scalar() or 0
            if total_alerts == 0:
                print("[SEED] Database is empty - running automated initial seed...")
                from app.routers.seed import seed_all
                from app.routers.rag import seed_typology_docs
                await seed_all(session)
                await seed_typology_docs(session)
                print("[SEED] Automated seed complete!")
            else:
                print(f"[DATABASE] Database ready ({total_alerts} alerts present).")
    except Exception as e:
        print(f"[WARN] Database initialization warning: {e}")

    yield
    print("[SHUTDOWN] Fintel API shutting down")



app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=(
        "AI Investigation Copilot for AML Case-Building and SAR Narrative Drafting. "
        "Uses LLM Agents, Knowledge Graphs, and RAG to automate financial crime investigation."
    ),
    lifespan=lifespan,
)

# ─── CORS ────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins + ["*"],  # Allow all for demo
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Prometheus Metrics ──────────────────────────────────────────────────────
Instrumentator(
    should_group_status_codes=False,
    should_ignore_untemplated=True,
    excluded_handlers=["/metrics", "/health", "/docs", "/openapi.json"],
).instrument(app).expose(app, endpoint="/metrics")

# ─── Register Routers ───────────────────────────────────────────────────────
app.include_router(alerts.router)
app.include_router(nlp.router)
app.include_router(agent.router)
app.include_router(rag.router)
app.include_router(narrative.router)
app.include_router(seed.router)


# ─── Health Check ────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": settings.app_name, "version": settings.app_version}


@app.get("/")
async def root():
    return {
        "service": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
        "health": "/health",
        "endpoints": {
            "alerts": "/alerts",
            "nlp_extract": "/nlp/extract",
            "agent_investigate": "/agent/investigate",
            "rag_retrieve": "/rag/retrieve",
            "narrative_generate": "/narrative/generate",
            "metrics": "/metrics",
            "seed_data": "/seed/all",
        },
    }
