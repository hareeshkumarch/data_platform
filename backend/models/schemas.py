from __future__ import annotations
import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class DataSourceType(str, Enum):
    CSV = "csv"
    JSON = "json"
    PARQUET = "parquet"
    SQL = "sql"
    API = "api"


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"


class LLMProvider(str, Enum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"
    GROQ = "groq"


class LLMMode(str, Enum):
    FAST = "fast"
    ADVANCED = "advanced"
    REASONING = "reasoning"


class AgentType(str, Enum):
    INGESTION = "ingestion"
    UNDERSTANDING = "understanding"
    FEATURE = "feature"
    INSIGHT = "insight"
    VISUALIZATION = "visualization"
    QUERY = "query"
    REPORT = "report"
    EVALUATOR = "evaluator"
    ORCHESTRATOR = "orchestrator"


class ChartType(str, Enum):
    BAR = "bar"
    LINE = "line"
    AREA = "area"
    PIE = "pie"
    DONUT = "donut"
    SCATTER = "scatter"
    BUBBLE = "bubble"
    HEATMAP = "heatmap"
    HISTOGRAM = "histogram"
    BOXPLOT = "boxplot"
    RADAR = "radar"
    TREEMAP = "treemap"
    WATERFALL = "waterfall"
    FUNNEL = "funnel"
    CANDLESTICK = "candlestick"
    GAUGE = "gauge"
    SANKEY = "sankey"
    VIOLIN = "violin"
    TABLE = "table"


class InsightCategory(str, Enum):
    DESCRIPTIVE = "descriptive"
    DIAGNOSTIC = "diagnostic"
    PREDICTIVE = "predictive"
    PRESCRIPTIVE = "prescriptive"
    ANOMALY = "anomaly"


class AgentResult(BaseModel):
    agent: AgentType
    success: bool
    data: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
    duration_ms: float = 0.0


class LLMRequest(BaseModel):
    prompt: str
    system_prompt: str = ""
    provider: Optional[str] = None
    model_override: Optional[str] = None
    mode: LLMMode = LLMMode.FAST
    temperature: float = 0.15
    max_tokens: int = 4096
    use_cache: bool = True
    cache_ttl: int = 86400


class LLMResponse(BaseModel):
    content: str
    provider: LLMProvider
    model: str
    tokens_in: int = 0
    tokens_out: int = 0
    cached: bool = False
    latency_ms: float = 0.0

    @property
    def tokens_total(self) -> int:
        return self.tokens_in + self.tokens_out


class ColumnMeta(BaseModel):
    name: str
    dtype: str
    inferred_type: str
    null_count: int
    null_pct: float
    unique_count: int
    cardinality: str
    sample_values: List[Any] = Field(default_factory=list)
    min_val: Optional[Any] = None
    max_val: Optional[Any] = None
    mean_val: Optional[float] = None
    std_val: Optional[float] = None


class DatasetSchema(BaseModel):
    dataset_id: str
    name: str
    source_type: DataSourceType
    row_count: int
    col_count: int
    columns: List[ColumnMeta]
    size_bytes: int
    quality_score: float
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Insight(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    category: InsightCategory
    title: str
    description: str
    supporting_data: Dict[str, Any] = Field(default_factory=dict)
    confidence: float
    priority: int
    action_items: List[str] = Field(default_factory=list)
    related_columns: List[str] = Field(default_factory=list)


class ValidationResult(BaseModel):
    is_valid: bool
    chart_type: str
    reason: str = ""
    warnings: List[str] = Field(default_factory=list)
    suggested_alternative: Optional[str] = None
    required_columns: Dict[str, str] = Field(default_factory=dict)


class RAGDocument(BaseModel):
    doc_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    dataset_id: str
    content: str
    doc_type: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    embedding: Optional[List[float]] = None


class StandardResponse(BaseModel):
    success: bool = True
    data: Any = None
    meta: Optional[Dict[str, Any]] = None


class StandardErrorResponse(BaseModel):
    success: bool = False
    detail: str
    error_type: Optional[str] = None
    field_errors: Optional[Dict[str, str]] = None
