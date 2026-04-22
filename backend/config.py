"""Runtime configuration loaded from environment variables."""

from functools import lru_cache
from typing import List, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings. All values sourced from .env / environment."""

    # App
    APP_NAME: str = "Lumen Data Intelligence Platform"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"
    API_PREFIX: str = "/api/v1"
    ALLOWED_ORIGINS: List[str] = ["*"]
    MAX_UPLOAD_SIZE_MB: int = 500

    # LLM provider credentials
    OPENAI_API_KEY: Optional[str] = None
    ANTHROPIC_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None
    GROQ_API_KEY: Optional[str] = None
    DEFAULT_LLM_PROVIDER: str = "openai"
    DEFAULT_LLM_MODEL: str = "gpt-5.2"
    LLM_PARALLEL_CALLS: int = 4
    LLM_TEMPERATURE: float = 0.15
    LLM_MAX_TOKENS: int = 4096
    LLM_MAX_TOKENS_REPORT: int = 8192

    # Storage / SQL
    DATABASE_URL: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/lumen"
    UPLOAD_DIR: str = "/tmp/uploads"
    FAISS_INDEX_PATH: str = "/tmp/faiss_indexes"

    # Data processing
    MAX_CHUNK_ROWS: int = 10_000
    SAMPLE_THRESHOLD: int = 100_000
    SAMPLE_SIZE: int = 50_000
    MAX_CARDINALITY: int = 50
    CORRELATION_MIN_ROWS: int = 30

    # Cache TTLs (seconds)
    CACHE_TTL_DEFAULT: int = 3600
    CACHE_TTL_LLM: int = 86400
    CACHE_TTL_QUERY: int = 1800
    CACHE_TTL_CHART: int = 900

    # Task retry
    TASK_MAX_RETRIES: int = 3
    TASK_RETRY_BACKOFF: int = 5
    # Legacy aliases still referenced by some agents
    CELERY_MAX_RETRIES: int = 3
    CELERY_RETRY_BACKOFF: int = 5

    # Metrics
    ENABLE_PROMETHEUS: bool = False
    PROMETHEUS_PORT: int = 9090

    model_config = SettingsConfigDict(
        env_file=".env", case_sensitive=True, extra="ignore"
    )


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
