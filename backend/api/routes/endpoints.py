from __future__ import annotations
import base64
import io
import json
import os
import uuid
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator
from prometheus_client import REGISTRY, generate_latest, CONTENT_TYPE_LATEST

from backend.config import settings
from backend.processors.data_pipeline import DataPipeline
from backend.services.analytics import AdvancedAnalytics
from backend.services.cache_service import CacheService
from backend.services.chart_engine import DynamicChartEngine
from backend.services.export_service import ExportService
from backend.services.guardrails import InputGuardrails, OutputGuardrails, RateLimiter
from backend.services.llm_service import LLMRequest, LLMMode, LLMService
from backend.services.storage_service import StorageService
from backend.services.vector_service import VectorService
from backend.tasks.celery_app import (
    task_dashboard, task_ingest, task_insights,
    task_pipeline, task_process, task_query, task_report,
)
from backend.utils.logger import get_logger

logger = get_logger(__name__)
router = APIRouter()

_cache: Optional[CacheService] = None
_llm: Optional[LLMService] = None
_storage: Optional[StorageService] = None
_analytics = AdvancedAnalytics()
_chart_engine = DynamicChartEngine()
_exporter = ExportService()


async def get_cache() -> CacheService:
    global _cache
    if _cache is None:
        _cache = CacheService()
    return _cache

async def get_llm(cache: CacheService = Depends(get_cache)) -> LLMService:
    global _llm
    if _llm is None:
        _llm = LLMService(cache)
    return _llm

async def get_storage() -> StorageService:
    global _storage
    if _storage is None:
        _storage = StorageService()
    return _storage

async def _get_df_and_schema(dataset_id: str, cache: CacheService):
    schema = await cache.get_schema(dataset_id)
    rows = await cache.get_sample(dataset_id)
    if not schema:
        # Fallback: try to re-read from disk and rebuild cache
        storage = await get_storage()
        file_path = storage.get_file_path(dataset_id)
        if file_path and file_path.exists():
            try:
                ext = file_path.suffix.lower()
                if ext == ".csv":
                    df = pd.read_csv(file_path)
                elif ext == ".json":
                    df = pd.read_json(file_path)
                elif ext in (".xlsx", ".xls"):
                    df = pd.read_excel(file_path)
                elif ext == ".parquet":
                    df = pd.read_parquet(file_path)
                else:
                    df = pd.read_csv(file_path)
                # Rebuild schema and cache it
                cols = []
                for c in df.columns:
                    dtype = str(df[c].dtype)
                    if "int" in dtype or "float" in dtype:
                        inferred = "numeric"
                    elif "datetime" in dtype:
                        inferred = "datetime"
                    elif "bool" in dtype:
                        inferred = "boolean"
                    else:
                        inferred = "categorical"
                    cols.append({"name": c, "dtype": dtype, "inferred_type": inferred,
                                 "null_pct": round(float(df[c].isnull().mean() * 100), 2),
                                 "unique_count": int(df[c].nunique())})
                schema = {
                    "dataset_id": dataset_id,
                    "name": storage.get_dataset_record(dataset_id).get("filename", file_path.name),
                    "row_count": len(df),
                    "col_count": len(df.columns),
                    "columns": cols,
                }
                await cache.set_schema(dataset_id, schema)
                sample = df.head(200).to_dict("records")
                await cache.set_sample(dataset_id, sample)
                return df, schema
            except Exception as e:
                logger.warning("Fallback disk read failed", dataset_id=dataset_id, error=str(e))
        raise HTTPException(404, f"Dataset '{dataset_id}' not found. Upload and ingest first.")
    return pd.DataFrame(rows or []), schema


# ── Request Models ────────────────────────────────────────────────────────────

class ProcessReq(BaseModel):
    run_anomaly_detection: bool = True
    run_time_series: bool = False
    time_column: Optional[str] = None
    value_columns: Optional[List[str]] = None
    run_contribution: bool = False
    dimension_col: Optional[str] = None
    metric_col: Optional[str] = None

class InsightReq(BaseModel):
    focus_columns: Optional[List[str]] = None
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None

class QueryReq(BaseModel):
    question: str
    output_format: str = "table"
    use_cache: bool = True
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None

    @field_validator("question")
    @classmethod
    def check_question(cls, v):
        ok, msg = InputGuardrails.validate_question(v)
        if not ok:
            raise ValueError(msg)
        return v.strip()

class ChartValidateReq(BaseModel):
    dataset_id: str
    chart_type: str

class ChartGenerateReq(BaseModel):
    dataset_id: str
    chart_type: Optional[str] = None
    title: Optional[str] = None
    intent: str = "general"
    drilldown: Optional[dict] = None
    realtime: bool = False

class DashboardReq(BaseModel):
    focus_columns: Optional[List[str]] = None
    widget_count: int = 6

class ReportReq(BaseModel):
    title: str = "Data Intelligence Report"
    sections: List[str] = ["executive_summary","eda","insights","anomalies","recommendations"]
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None

class SQLReq(BaseModel):
    connection_string: str
    query: str
    dataset_name: str

    @field_validator("query")
    @classmethod
    def check_sql(cls, v):
        ok, msg = InputGuardrails.validate_sql_query(v)
        if not ok:
            raise ValueError(msg)
        return v

    @field_validator("connection_string")
    @classmethod
    def check_conn(cls, v):
        ok, msg = InputGuardrails.validate_connection_string(v)
        if not ok:
            raise ValueError(msg)
        return v

class APIReq(BaseModel):
    url: str
    method: str = "GET"
    headers: dict = {}
    body: Optional[dict] = None
    dataset_name: str
    json_path: Optional[str] = None

class PipelineReq(BaseModel):
    steps: List[Dict[str, Any]]

class AnalyticsReq(BaseModel):
    analysis_type: str
    config: Dict[str, Any] = {}

class CompareReq(BaseModel):
    dataset_id_a: str
    dataset_id_b: str
    metric_col: str
    group_col: Optional[str] = None

class ChatReq(BaseModel):
    prompt: str
    conversationId: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None

class ReactDashboardReq(BaseModel):
    dataset_id: str
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None

class ReactComponentReq(BaseModel):
    chart_type: str
    title: str
    data_structure: Optional[str] = None
    llm_provider: Optional[str] = None


# ── System ────────────────────────────────────────────────────────────────────

@router.get("/health")
async def health(cache: CacheService = Depends(get_cache)):
    return {
        "status": "ok",
        "cache": "connected" if await cache.ping() else "disconnected",
        "version": settings.APP_VERSION,
    }

@router.get("/models")
async def list_models(llm: LLMService = Depends(get_llm)):
    return {"providers": llm.get_providers(), "models": llm.get_models()}

@router.get("/chart-types")
async def list_chart_types():
    from backend.models.schemas import ChartType
    return {"chart_types": [{"id": ct.value, "label": ct.value.replace("_"," ").title()} for ct in ChartType]}

@router.get("/processors")
async def list_processors():
    return {"processors": DataPipeline.available_processors()}


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post("/upload-data")
async def upload_data(
    file: UploadFile = File(...),
    dataset_name: Optional[str] = Form(None),
    storage: StorageService = Depends(get_storage),
    request: Request = None,
):
    content = await file.read()
    filename = file.filename or "upload.csv"
    ok, msg = InputGuardrails.validate_file_upload(filename, len(content), file.content_type or "")
    if not ok:
        raise HTTPException(400, msg)

    ext = filename.rsplit(".", 1)[-1].lower()
    source_type = {"csv":"csv","json":"json","parquet":"parquet","xlsx":"json","xls":"json"}.get(ext, "csv")
    ref = await storage.store_file(content, filename)
    dataset_id = ref["dataset_id"]
    name = dataset_name or filename

    task = task_ingest.apply_async(kwargs={"payload": {
        "dataset_id": dataset_id,
        "source_type": source_type,
        "content_b64": base64.b64encode(content).decode(),
        "filename": name,
        "size_bytes": len(content),
        "validate_schema": True,
        "correlation_id": str(uuid.uuid4()),
    }}, queue="high")

    return {
        "dataset_id": dataset_id,
        "filename": name,
        "source_type": source_type,
        "size_bytes": len(content),
        "task_id": task.id,
        "status": "pending",
        "message": "Uploaded. Ingestion queued.",
    }

@router.post("/datasets/seed-demo")
async def seed_demo_dataset(
    storage: StorageService = Depends(get_storage),
):
    from backend.services.sql_service import ensure_sample_csv_on_disk
    try:
        source_path = ensure_sample_csv_on_disk()
        with open(source_path, "rb") as f:
            content = f.read()
    except Exception as e:
        raise HTTPException(500, f"Demo file generation failed: {e}")

    filename = "sales_performance.csv"
    source_type = "csv"
    ref = await storage.store_file(content, filename)
    dataset_id = ref["dataset_id"]

    task = task_ingest.apply_async(kwargs={"payload": {
        "dataset_id": dataset_id,
        "source_type": source_type,
        "content_b64": base64.b64encode(content).decode(),
        "filename": "Sales Performance (Sample)",
        "size_bytes": len(content),
        "validate_schema": True,
        "correlation_id": str(uuid.uuid4()),
    }}, queue="high")

    return {
        "dataset_id": dataset_id,
        "filename": "Sales Performance (Sample)",
        "task_id": task.id,
        "status": "pending",
        "message": "Demo data seeding initiated via regular ingestion pipeline.",
    }

@router.post("/upload-sql")
async def upload_sql(body: SQLReq):
    dataset_id = str(uuid.uuid4())
    task = task_ingest.apply_async(kwargs={"payload": {
        "dataset_id": dataset_id, "source_type": "sql",
        "connection_string": body.connection_string, "sql_query": body.query,
        "filename": body.dataset_name, "correlation_id": str(uuid.uuid4()),
    }}, queue="high")
    return {"dataset_id": dataset_id, "task_id": task.id, "status": "pending"}

@router.post("/upload-api")
async def upload_api(body: APIReq):
    dataset_id = str(uuid.uuid4())
    task = task_ingest.apply_async(kwargs={"payload": {
        "dataset_id": dataset_id, "source_type": "api",
        "api_config": {"url": body.url, "method": body.method, "headers": body.headers, "body": body.body, "json_path": body.json_path},
        "filename": body.dataset_name, "correlation_id": str(uuid.uuid4()),
    }}, queue="high")
    return {"dataset_id": dataset_id, "task_id": task.id, "status": "pending"}


# ── Dataset ───────────────────────────────────────────────────────────────────

@router.get("/schema/{dataset_id}")
async def get_schema(dataset_id: str, cache: CacheService = Depends(get_cache), storage: StorageService = Depends(get_storage)):
    schema = await cache.get_schema(dataset_id)
    if not schema:
        # Try to rebuild from disk
        try:
            df, schema = await _get_df_and_schema(dataset_id, cache)
        except HTTPException:
            raise HTTPException(404, f"Dataset '{dataset_id}' not found.")
    return schema

@router.get("/datasets")
async def list_datasets(storage: StorageService = Depends(get_storage), cache: CacheService = Depends(get_cache)):
    raw = storage.list_datasets()
    enriched = []
    seen_names: dict[str, dict] = {}
    for d in raw:
        did = d.get("id") or d.get("dataset_id")
        if not did:
            continue
        schema = await cache.get_schema(did) if did else None
        entry = {**d, "id": did, "dataset_id": did}
        if schema:
            entry["row_count"] = schema.get("row_count", 0)
            entry["col_count"] = schema.get("col_count", 0)
            entry["name"] = schema.get("name", entry.get("filename", did))
            entry["_has_schema"] = True
        else:
            record = storage.get_dataset_record(did)
            if record:
                entry["row_count"] = record.get("row_count", 0)
                entry["col_count"] = record.get("col_count", 0)
                entry["name"] = record.get("name", entry.get("filename", did))
            entry["_has_schema"] = False
            if not entry.get("row_count"):
                file_path = storage.get_file_path(did)
                if file_path and file_path.exists():
                    try:
                        if file_path.suffix.lower() == ".csv":
                            import csv as csv_mod
                            with open(file_path, "r") as f:
                                reader = csv_mod.reader(f)
                                header = next(reader, [])
                                row_count = sum(1 for _ in reader)
                            entry["row_count"] = row_count
                            entry["col_count"] = len(header)
                    except Exception:
                        pass
        # Dedup by (name, row_count, col_count) — prefer entries with live schema
        key = f"{entry.get('name')}::{entry.get('row_count',0)}::{entry.get('col_count',0)}"
        existing = seen_names.get(key)
        if not existing or (entry.get("_has_schema") and not existing.get("_has_schema")):
            seen_names[key] = entry
    enriched = [{k: v for k, v in e.items() if k != "_has_schema"} for e in seen_names.values()]
    return {"datasets": enriched}

@router.delete("/datasets/{dataset_id}")
async def delete_dataset(dataset_id: str, storage: StorageService = Depends(get_storage), cache: CacheService = Depends(get_cache)):
    storage.delete_dataset(dataset_id)
    await cache.invalidate_dataset(dataset_id)
    return {"message": f"Dataset '{dataset_id}' deleted."}

@router.get("/datasets/{dataset_id}/preview")
async def preview_dataset(dataset_id: str, n: int = 20, cache: CacheService = Depends(get_cache)):
    schema = await cache.get_schema(dataset_id)
    rows = await cache.get_sample(dataset_id)
    if not schema:
        raise HTTPException(404, f"Dataset '{dataset_id}' not found.")
    return {
        "dataset_id": dataset_id,
        "id": dataset_id,
        "name": schema.get("name", dataset_id),
        "columns": schema.get("columns", []),
        "rows": (rows or [])[:n],
        "total_rows": schema.get("row_count", 0),
        "row_count": schema.get("row_count", 0),
        "col_count": schema.get("col_count", 0),
        "size_bytes": schema.get("size_bytes", 0),
    }


# ── Processing ────────────────────────────────────────────────────────────────

@router.post("/process-data/{dataset_id}")
async def process_data(dataset_id: str, body: ProcessReq, cache: CacheService = Depends(get_cache)):
    if not await cache.get_schema(dataset_id):
        raise HTTPException(404, f"Dataset '{dataset_id}' not found.")
    task = task_process.apply_async(kwargs={"payload": {
        "dataset_id": dataset_id,
        "run_anomaly": body.run_anomaly_detection,
        "run_time_series": body.run_time_series,
        "time_column": body.time_column,
        "value_columns": body.value_columns,
        "run_contribution": body.run_contribution,
        "dimension_col": body.dimension_col,
        "metric_col": body.metric_col,
        "correlation_id": str(uuid.uuid4()),
    }}, queue="default")
    return {"dataset_id": dataset_id, "task_id": task.id, "status": "pending"}

@router.get("/eda/{dataset_id}")
async def get_eda(dataset_id: str, cache: CacheService = Depends(get_cache)):
    data = await cache.get_eda(dataset_id)
    if not data:
        raise HTTPException(404, "EDA not found. Run /process-data first.")
    return data


# ── Processor Pipeline ────────────────────────────────────────────────────────

@router.post("/pipeline/process/{dataset_id}")
async def run_data_pipeline(dataset_id: str, body: PipelineReq, cache: CacheService = Depends(get_cache)):
    df, schema = await _get_df_and_schema(dataset_id, cache)
    pipeline = DataPipeline(body.steps)
    result = await pipeline.run(df)
    processed_df = result.pop("df")
    rows = processed_df.head(200).to_dict("records")
    from backend.utils.data_utils import sanitize_rows
    result["rows"] = sanitize_rows(rows)
    result["columns"] = list(processed_df.columns)
    result["dataset_id"] = dataset_id
    return result


# ── Analytics ─────────────────────────────────────────────────────────────────

@router.post("/analytics/{dataset_id}")
async def run_analytics(dataset_id: str, body: AnalyticsReq, cache: CacheService = Depends(get_cache)):
    df, schema = await _get_df_and_schema(dataset_id, cache)
    num_cols = [c["name"] for c in schema.get("columns",[]) if c.get("inferred_type") == "numeric"]
    cfg = body.config

    if body.analysis_type == "kpis":
        return {"dataset_id": dataset_id, "kpis": _analytics.compute_kpis(df, num_cols, cfg.get("date_col"))}
    elif body.analysis_type == "cohort":
        return _analytics.cohort_analysis(df, cfg["date_col"], cfg["user_col"], cfg["value_col"])
    elif body.analysis_type == "funnel":
        return _analytics.funnel_analysis(df, cfg["stage_col"], cfg["value_col"], cfg.get("stage_order"))
    elif body.analysis_type == "group_aggregate":
        return _analytics.group_aggregate(df, cfg["group_cols"], cfg["agg_col"], cfg.get("agg_func","sum"), cfg.get("top_n",20))
    elif body.analysis_type == "correlation":
        return _analytics.deep_correlation(df, cfg["target_col"], num_cols)
    elif body.analysis_type == "outlier_summary":
        return {"dataset_id": dataset_id, "outliers": _analytics.outlier_summary(df, num_cols)}
    elif body.analysis_type == "profile":
        return _analytics.profile_dataset(df, schema.get("columns",[]))
    elif body.analysis_type == "trend":
        return _analytics.detect_trends(df, cfg["date_col"], cfg["value_col"])
    elif body.analysis_type == "segment":
        return _analytics.segment_analysis(df, cfg["segment_col"], cfg.get("metric_cols", num_cols[:3]))
    else:
        raise HTTPException(400, f"Unknown analysis_type '{body.analysis_type}'. Valid: kpis, cohort, funnel, group_aggregate, correlation, outlier_summary, profile, trend, segment")


# ── Compare Datasets ──────────────────────────────────────────────────────────

@router.post("/compare")
async def compare_datasets(body: CompareReq, cache: CacheService = Depends(get_cache)):
    rows_a = await cache.get_sample(body.dataset_id_a)
    rows_b = await cache.get_sample(body.dataset_id_b)
    if not rows_a or not rows_b:
        raise HTTPException(404, "One or both datasets not found.")
    df_a = pd.DataFrame(rows_a)
    df_b = pd.DataFrame(rows_b)
    result: Dict[str, Any] = {
        "dataset_a": {"id": body.dataset_id_a, "rows": len(df_a), "cols": len(df_a.columns)},
        "dataset_b": {"id": body.dataset_id_b, "rows": len(df_b), "cols": len(df_b.columns)},
        "common_columns": list(set(df_a.columns) & set(df_b.columns)),
    }
    from backend.utils.data_utils import _safe
    if body.metric_col in df_a.columns and body.metric_col in df_b.columns:
        sa, sb = df_a[body.metric_col].dropna(), df_b[body.metric_col].dropna()
        result["metric_comparison"] = {
            "column": body.metric_col,
            "a_mean": _safe(sa.mean()), "b_mean": _safe(sb.mean()),
            "a_sum": _safe(sa.sum()), "b_sum": _safe(sb.sum()),
            "a_std": _safe(sa.std()), "b_std": _safe(sb.std()),
            "mean_diff_pct": round((float(sb.mean()) - float(sa.mean())) / abs(float(sa.mean())) * 100, 2) if sa.mean() != 0 else None,
        }
    return result


# ── Insights ──────────────────────────────────────────────────────────────────

@router.post("/generate-insights/{dataset_id}")
async def generate_insights(dataset_id: str, body: InsightReq, cache: CacheService = Depends(get_cache)):
    if not await cache.get_schema(dataset_id):
        raise HTTPException(404, f"Dataset '{dataset_id}' not found.")
    task = task_insights.apply_async(kwargs={"payload": {
        "dataset_id": dataset_id,
        "llm_provider": body.llm_provider,
        "model_override": body.llm_model,
        "focus_columns": body.focus_columns,
        "correlation_id": str(uuid.uuid4()),
    }}, queue="default")
    return {"dataset_id": dataset_id, "task_id": task.id, "status": "pending"}

@router.get("/insights/{dataset_id}")
async def get_insights(dataset_id: str, cache: CacheService = Depends(get_cache)):
    data = await cache.get_insights(dataset_id)
    if not data:
        raise HTTPException(404, "Insights not found. Run /generate-insights first.")
    return data

# ── Chat ──────────────────────────────────────────────────────────────────────

@router.post("/chat")
async def chat(body: ChatReq, llm: LLMService = Depends(get_llm)):
    req = LLMRequest(
        prompt=body.prompt,
        mode=LLMMode.FAST,
        provider=body.provider if body.provider else None,
        model_override=body.model,
        system_prompt="You are Lumen, an AI analyst that turns data into clear, verifiable insight.",
    )
    resp = await llm.complete(req)
    return {"reply": resp.content, "provider": resp.provider.value if hasattr(resp.provider, "value") else str(resp.provider), "model": resp.model}

@router.get("/chat-stream")
async def chat_stream(prompt: str, provider: Optional[str] = None, model: Optional[str] = None, llm: LLMService = Depends(get_llm)):
    req = LLMRequest(
        prompt=prompt,
        mode=LLMMode.FAST,
        provider=provider if provider else None,
        model_override=model,
        system_prompt="You are Lumen, an AI analyst that turns data into clear, verifiable insight.",
    )

    async def event_generator():
        try:
            async for token in llm.stream_complete(req):
                yield f"data: {json.dumps({'token': token})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            logger.error(f"Stream error: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ── Query ─────────────────────────────────────────────────────────────────────

@router.post("/query/{dataset_id}")
async def query(dataset_id: str, body: QueryReq, cache: CacheService = Depends(get_cache)):
    if not await cache.get_schema(dataset_id):
        raise HTTPException(404, f"Dataset '{dataset_id}' not found.")
    task = task_query.apply_async(kwargs={"payload": {
        "dataset_id": dataset_id,
        "question": body.question,
        "output_format": body.output_format,
        "use_cache": body.use_cache,
        "llm_provider": body.llm_provider,
        "model_override": body.llm_model,
        "correlation_id": str(uuid.uuid4()),
    }}, queue="high")
    return {"dataset_id": dataset_id, "question": body.question, "task_id": task.id, "status": "pending"}


# ── Charts ────────────────────────────────────────────────────────────────────

@router.post("/chart/validate")
async def validate_chart(body: ChartValidateReq, cache: CacheService = Depends(get_cache)):
    ok, msg = InputGuardrails.validate_chart_type(body.chart_type)
    if not ok:
        raise HTTPException(400, msg)
    df, schema = await _get_df_and_schema(body.dataset_id, cache)
    result = _chart_engine.validate_only(df, schema.get("columns",[]), body.chart_type)
    return result.model_dump()

@router.post("/chart/generate")
async def generate_chart(body: ChartGenerateReq, cache: CacheService = Depends(get_cache)):
    df, schema = await _get_df_and_schema(body.dataset_id, cache)
    if body.chart_type:
        ok, msg = InputGuardrails.validate_chart_type(body.chart_type)
        if not ok:
            raise HTTPException(400, msg)
    config = _chart_engine.generate(
        df=df, schema_cols=schema.get("columns",[]),
        requested_chart=body.chart_type, title=body.title or "",
        intent=body.intent, drilldown=body.drilldown, realtime=body.realtime,
    )
    config["dataset_id"] = body.dataset_id
    await cache.cache_chart_config(f"{body.dataset_id}:{body.chart_type or 'auto'}", config)
    return config

@router.get("/chart/recommend/{dataset_id}")
async def recommend_charts(dataset_id: str, cache: CacheService = Depends(get_cache)):
    df, schema = await _get_df_and_schema(dataset_id, cache)
    cols = schema.get("columns", [])
    from backend.models.schemas import ChartType
    recommendations = []
    for ct in ChartType:
        result = _chart_engine.validate_only(df, cols, ct.value)
        if result.is_valid:
            recommendations.append({
                "chart_type": ct.value,
                "label": ct.value.replace("_"," ").title(),
                "required_columns": result.required_columns,
                "warnings": result.warnings,
            })
    return {"dataset_id": dataset_id, "recommendations": recommendations}


# ── Dashboard ─────────────────────────────────────────────────────────────────

@router.post("/dashboard/{dataset_id}")
async def generate_dashboard(dataset_id: str, body: DashboardReq, cache: CacheService = Depends(get_cache)):
    if not await cache.get_schema(dataset_id):
        raise HTTPException(404, f"Dataset '{dataset_id}' not found.")
    task = task_dashboard.apply_async(kwargs={"payload": {
        "dataset_id": dataset_id,
        "focus_columns": body.focus_columns,
        "question": "",
        "correlation_id": str(uuid.uuid4()),
    }}, queue="default")
    return {"dataset_id": dataset_id, "task_id": task.id, "status": "pending"}

@router.get("/dashboard/{dataset_id}")
async def get_dashboard(dataset_id: str, cache: CacheService = Depends(get_cache)):
    data = await cache.get_charts(dataset_id)
    if not data:
        raise HTTPException(404, "Dashboard not found. Run POST /dashboard first.")
    return data


# ── React Layout Generator ────────────────────────────────────────────────────

@router.post("/react/dashboard-layout")
async def generate_react_layout(body: ReactDashboardReq, cache: CacheService = Depends(get_cache), llm: LLMService = Depends(get_llm)):
    schema = await cache.get_schema(body.dataset_id)
    charts_data = await cache.get_charts(body.dataset_id)
    insights_data = await cache.get_insights(body.dataset_id)
    if not schema:
        raise HTTPException(404, f"Dataset '{body.dataset_id}' not found.")

    charts_data = charts_data or {}
    insights_data = insights_data or {}

    chart_summary = json.dumps([{"type": c.get("chart_type"), "title": c.get("title")} for c in charts_data.get("charts",[])[:10]])
    kpi_summary = json.dumps(charts_data.get("kpis", [])[:6])

    from backend.prompts.react_prompts import REACT_DASHBOARD_SYSTEM, build_dashboard_prompt
    prompt = build_dashboard_prompt(
        dataset_name=schema.get("name", body.dataset_id),
        row_count=schema.get("row_count", 0),
        col_count=schema.get("col_count", 0),
        chart_summary=chart_summary,
        kpi_summary=kpi_summary,
        insight_count=len(insights_data.get("insights", [])),
    )
    req = LLMRequest(
        prompt=prompt, system_prompt=REACT_DASHBOARD_SYSTEM,
        mode=LLMMode.FAST, temperature=0.2, max_tokens=2000,
        provider=None,
    )
    resp = await llm.complete(req)
    try:
        layout = LLMService.extract_json(resp.content)
    except Exception:
        raise HTTPException(500, "LLM returned invalid layout JSON.")
    return {**layout, "dataset_id": body.dataset_id}

@router.post("/react/component")
async def generate_react_component(body: ReactComponentReq, llm: LLMService = Depends(get_llm)):
    ok, msg = InputGuardrails.validate_chart_type(body.chart_type)
    if not ok:
        raise HTTPException(400, msg)
    from backend.prompts.react_prompts import REACT_COMPONENT_SYSTEM, build_component_prompt
    prompt = build_component_prompt(
        chart_type=body.chart_type,
        title=body.title,
        data_structure=body.data_structure or "{}",
    )
    req = LLMRequest(
        prompt=prompt, system_prompt=REACT_COMPONENT_SYSTEM,
        mode=LLMMode.ADVANCED, temperature=0.1, max_tokens=3000,
    )
    resp = await llm.complete(req)
    return {"chart_type": body.chart_type, "title": body.title, "component_code": resp.content, "model_used": resp.model}

@router.get("/react/api-integration")
async def get_api_integration_guide():
    from backend.prompts.react_prompts import RECHARTS_MAP, DEFAULT_COLORS
    endpoints = [
        {"method": "POST", "path": "/api/v1/upload-data", "description": "Upload CSV/JSON/Parquet"},
        {"method": "POST", "path": "/api/v1/process-data/{dataset_id}", "description": "Run EDA"},
        {"method": "POST", "path": "/api/v1/generate-insights/{dataset_id}", "description": "Generate insights"},
        {"method": "POST", "path": "/api/v1/query/{dataset_id}", "description": "NL query"},
        {"method": "POST", "path": "/api/v1/chart/validate", "description": "Validate chart type"},
        {"method": "POST", "path": "/api/v1/chart/generate", "description": "Generate chart config"},
        {"method": "GET", "path": "/api/v1/chart/recommend/{dataset_id}", "description": "Recommend charts"},
        {"method": "POST", "path": "/api/v1/dashboard/{dataset_id}", "description": "Generate dashboard"},
        {"method": "POST", "path": "/api/v1/analytics/{dataset_id}", "description": "Advanced analytics"},
        {"method": "GET", "path": "/api/v1/task/{task_id}", "description": "Poll task status"},
        {"method": "GET", "path": "/api/v1/models", "description": "List LLM models"},
    ]
    return {
        "base_url": os.getenv("API_BASE_URL", "http://localhost:8000"),
        "endpoints": endpoints,
        "chart_renderer_map": RECHARTS_MAP,
        "default_colors": DEFAULT_COLORS,
        "task_polling_interval_ms": 2000,
        "max_file_size_mb": settings.MAX_UPLOAD_SIZE_MB,
        "supported_file_types": ["csv", "json", "parquet", "xlsx"],
    }


# ── Report ────────────────────────────────────────────────────────────────────

@router.post("/report/{dataset_id}")
async def generate_report(dataset_id: str, body: ReportReq, cache: CacheService = Depends(get_cache)):
    if not await cache.get_schema(dataset_id):
        raise HTTPException(404, f"Dataset '{dataset_id}' not found.")
    task = task_report.apply_async(kwargs={"payload": {
        "dataset_id": dataset_id,
        "title": body.title,
        "sections": body.sections,
        "llm_provider": body.llm_provider,
        "model_override": body.llm_model,
        "correlation_id": str(uuid.uuid4()),
    }}, queue="low")
    return {"dataset_id": dataset_id, "task_id": task.id, "status": "pending"}

@router.post("/pipeline/{dataset_id}")
async def run_full_pipeline(dataset_id: str, cache: CacheService = Depends(get_cache)):
    task = task_pipeline.apply_async(kwargs={"payload": {
        "dataset_id": dataset_id,
        "mode": "full",
        "correlation_id": str(uuid.uuid4()),
    }}, queue="low")
    return {"dataset_id": dataset_id, "task_id": task.id, "status": "pending"}


# ── Export ────────────────────────────────────────────────────────────────────

@router.get("/export/{dataset_id}/csv")
async def export_csv(dataset_id: str, cache: CacheService = Depends(get_cache)):
    rows = await cache.get_sample(dataset_id)
    if not rows:
        raise HTTPException(404, "No data found.")
    content = _exporter.to_csv(rows)
    return StreamingResponse(io.BytesIO(content), media_type="text/csv",
                             headers={"Content-Disposition": f"attachment; filename={dataset_id}.csv"})

@router.get("/export/{dataset_id}/excel")
async def export_excel(dataset_id: str, cache: CacheService = Depends(get_cache)):
    rows = await cache.get_sample(dataset_id)
    if not rows:
        raise HTTPException(404, "No data found.")
    content = _exporter.to_excel(rows)
    return StreamingResponse(io.BytesIO(content),
                             media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename={dataset_id}.xlsx"})

@router.get("/export/{dataset_id}/insights/markdown")
async def export_insights_markdown(dataset_id: str, cache: CacheService = Depends(get_cache)):
    insights = await cache.get_insights(dataset_id)
    if not insights:
        raise HTTPException(404, "Insights not found.")
    content = _exporter.insights_to_markdown(insights)
    return StreamingResponse(io.BytesIO(content), media_type="text/markdown",
                             headers={"Content-Disposition": f"attachment; filename={dataset_id}_insights.md"})


# ── Task + Cache ──────────────────────────────────────────────────────────────

@router.get("/task/{task_id}")
async def task_status(task_id: str):
    from backend.tasks.celery_app import celery_app, get_task_record
    rec = get_task_record(task_id)
    if rec is None:
        return {"task_id": task_id, "status": "unknown", "progress": 0.0}
    status = rec.state.lower()
    resp: Dict[str, Any] = {"task_id": task_id, "status": status, "progress": float(rec.progress)}
    if rec.state == "SUCCESS":
        resp["result"] = rec.result
    elif rec.state == "FAILURE":
        resp["error"] = rec.error
    elif rec.state == "PROGRESS":
        resp["stage"] = rec.stage
    return resp

@router.delete("/cache/{dataset_id}")
async def invalidate_cache(dataset_id: str, cache: CacheService = Depends(get_cache)):
    await cache.invalidate_dataset(dataset_id)
    return {"message": f"Cache cleared for dataset '{dataset_id}'."}

@router.get("/system/stats")
async def system_stats(llm: LLMService = Depends(get_llm)):
    return llm.get_stats()


@router.get("/metrics/llm")
async def llm_metrics(llm: LLMService = Depends(get_llm)):
    """Structured LLM metrics for the Settings page."""
    from backend.config import settings as _s
    stats = llm.get_stats()
    # Identify which key source is active
    if _s.EMERGENT_LLM_KEY:
        key_source = "emergent"
    elif _s.OPENAI_API_KEY:
        key_source = "openai"
    elif _s.ANTHROPIC_API_KEY:
        key_source = "anthropic"
    elif _s.GEMINI_API_KEY:
        key_source = "gemini"
    elif _s.GROQ_API_KEY:
        key_source = "groq"
    else:
        key_source = "none"
    return {
        "calls_24h": stats["llm_calls"],
        "tokens_in": stats["llm_tokens"] // 2,
        "tokens_out": stats["llm_tokens"] - stats["llm_tokens"] // 2,
        "avg_latency_ms": stats["avg_latency_ms"],
        "errors_24h": stats["llm_errors"],
        "success_rate": stats["success_rate"],
        "key_source": key_source,
        "active_provider": _s.DEFAULT_LLM_PROVIDER,
        "active_model": _s.DEFAULT_LLM_MODEL,
    }


@router.get("/settings/providers")
async def list_provider_status(llm: LLMService = Depends(get_llm)):
    from backend.config import settings as _s
    key = _s.EMERGENT_LLM_KEY or ""
    masked = (key[:6] + "••••" + key[-4:]) if key else ""
    groq_key = _s.GROQ_API_KEY or ""
    groq_masked = (groq_key[:4] + "••••" + groq_key[-4:]) if groq_key else ""
    return {
        "providers": llm.get_providers(),
        "models": llm.get_models(),
        "default_provider": _s.DEFAULT_LLM_PROVIDER,
        "default_model": _s.DEFAULT_LLM_MODEL,
        "key_masked": masked,
        "key_configured": bool(key),
        "groq_key_masked": groq_masked,
        "groq_key_configured": bool(groq_key),
    }


class SettingsBody(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None


@router.post("/settings")
async def update_settings(body: SettingsBody):
    """Update in-memory defaults. Clients persist locally; backend honors on next call."""
    from backend.config import settings as _s
    if body.provider and body.provider in ("openai", "anthropic", "gemini", "groq"):
        _s.DEFAULT_LLM_PROVIDER = body.provider
    if body.model:
        _s.DEFAULT_LLM_MODEL = body.model
    if body.temperature is not None:
        _s.LLM_TEMPERATURE = max(0.0, min(1.0, body.temperature))
    if body.max_tokens is not None:
        _s.LLM_MAX_TOKENS = max(256, min(8192, body.max_tokens))
    return {
        "provider": _s.DEFAULT_LLM_PROVIDER,
        "model": _s.DEFAULT_LLM_MODEL,
        "temperature": _s.LLM_TEMPERATURE,
        "max_tokens": _s.LLM_MAX_TOKENS,
    }
