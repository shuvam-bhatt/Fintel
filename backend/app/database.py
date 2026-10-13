"""
Fintel Backend — Database Connection & Session Management
Supports both PostgreSQL (asyncpg) and SQLite (aiosqlite).
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from contextlib import asynccontextmanager
from app.config import get_settings

settings = get_settings()

is_sqlite = settings.async_db_url.startswith("sqlite")

# SQLAlchemy async engine
if is_sqlite:
    engine = create_async_engine(
        settings.async_db_url,
        echo=settings.debug,
    )
else:
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


async def init_db():
    """Create all tables if they do not exist."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


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
    """Get a raw connection for advanced operations."""
    if not is_sqlite:
        import asyncpg
        conn = await asyncpg.connect(settings.db_url)
        try:
            yield conn
        finally:
            await conn.close()
    else:
        yield None


@asynccontextmanager
async def get_raw_conn_ctx():
    """Context manager for raw connection."""
    if not is_sqlite:
        import asyncpg
        conn = await asyncpg.connect(settings.db_url)
        try:
            yield conn
        finally:
            await conn.close()
    else:
        yield None

