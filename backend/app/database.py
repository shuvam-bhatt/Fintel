"""
Fintel Backend — Database Connection & Session Management
Uses asyncpg for async operations via SQLAlchemy async engine.
"""

import asyncpg
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from contextlib import asynccontextmanager
from app.config import get_settings

settings = get_settings()

# SQLAlchemy async engine
engine = create_async_engine(
    settings.async_db_url,
    echo=settings.debug,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True,
)

# Session factory
async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """SQLAlchemy declarative base for all models."""
    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency that yields an async database session."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_raw_connection():
    """Get a raw asyncpg connection for graph queries and advanced operations."""
    conn = await asyncpg.connect(settings.db_url)
    try:
        yield conn
    finally:
        await conn.close()


@asynccontextmanager
async def get_raw_conn_ctx():
    """Context manager for raw asyncpg connection."""
    conn = await asyncpg.connect(settings.db_url)
    try:
        yield conn
    finally:
        await conn.close()
