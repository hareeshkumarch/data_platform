from functools import lru_cache
from typing import List, Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "Data Intelligence Platform"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"
    API_PREFIX: str = "/api/v1"
    ALLOWED_ORIGINS: List[str] = ["*"]
    MAX_UPLOAD_SIZE_MB: int = 500

    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: Optional[str] = None
    REDIS_TTL_DEFAULT: int = 3600
    REDIS_TTL_LLM: int = 86400
    REDIS_TTL_QUERY: int = 1800
    REDIS_TTL_CHART: int = 900

    @property
    def REDIS_URL(self) -> str:
        pw = f":{self.REDIS_PASSWORD}@" if self.REDIS_PASSWORD else ""
        return f"redis://{pw}{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    CELERY_BROKER_URL: str = "redis://redis:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://redis:6379/2"
    CELERY_MAX_RETRIES: int = 3
    CELERY_RETRY_BACKOFF: int = 30

    GEMINI_API_KEY: Optional[str] = None
    GEMINI_FAST: str = "gemini-1.5-flash"
    GEMINI_ADVANCED: str = "gemini-1.5-pro"
    GEMINI_REASONING: str = "gemini-2.0-flash-thinking-exp"

    GROQ_API_KEY: Optional[str] = None
    GROQ_FAST: str = "llama-3.1-8b-instant"
    GROQ_ADVANCED: str = "llama-3.3-70b-versatile"

    LLM_PARALLEL_CALLS: int = 4
    LLM_TEMPERATURE: float = 0.15
    LLM_MAX_TOKENS: int = 4096
    LLM_MAX_TOKENS_REPORT: int = 8192

    UPLOAD_DIR: str = "/tmp/uploads"
    FAISS_INDEX_PATH: str = "/app/faiss_indexes"
    MAX_CHUNK_ROWS: int = 10_000
    SAMPLE_THRESHOLD: int = 100_000
    SAMPLE_SIZE: int = 50_000
    MAX_CARDINALITY: int = 50
    CORRELATION_MIN_ROWS: int = 30

    ENABLE_PROMETHEUS: bool = True
    PROMETHEUS_PORT: int = 9090

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
