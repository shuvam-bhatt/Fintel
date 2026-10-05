"""
Fintel Backend — Configuration
Centralized settings loaded from environment variables.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Application
    app_name: str = "Fintel API"
    app_version: str = "1.0.0"
    debug: bool = False
    
    # Database
    postgres_user: str = "Fintel"
    postgres_password: str = "Fintel_dev_2026"
    postgres_db: str = "Fintel"
    postgres_host: str = "localhost"
    postgres_port: int = 5433
    database_url: str = ""
    
    # LLM
    llm_api_key: str = ""
    llm_provider: str = "anthropic"  # anthropic | openai
    llm_model: str = "claude-sonnet-4-20250514"
    
    # Embedding
    embedding_model: str = "all-MiniLM-L6-v2"
    embedding_dimension: int = 384  # MiniLM outputs 384-dim vectors
    
    # RAG
    rag_top_k: int = 5
    
    # CORS
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3001"]
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"
    
    @property
    def db_url(self) -> str:
        if self.database_url:
            return self.database_url
        return (
            f"postgresql://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )
    
    @property
    def async_db_url(self) -> str:
        return self.db_url.replace("postgresql://", "postgresql+asyncpg://")


@lru_cache()
def get_settings() -> Settings:
    return Settings()
