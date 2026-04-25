from __future__ import annotations

import asyncio
import base64
import io
import uuid
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.services.analytics import AdvancedAnalytics
from backend.services.cache_service import CacheService
from backend.services.cleaning_service import CleaningOp, clean_dataframe
from backend.services.demo_datasets import generate_demo, list_demo_kinds
from backend.services.storage_service import StorageService
from backend.tasks.celery_app import task_ingest
from backend.utils.logger import get_logger

logger = get_logger(__name__)

advanced_router = APIRouter(tags=["advanced"])


def _storage() -> StorageService:
    return StorageService()


def _cache() -> CacheService:
    return CacheService()


async def _load_df(dataset_id: str, storage: StorageService) -> pd.DataFrame:
    try:
        return await storage.load_dataframe(dataset_id)
    except FileNotFoundError:
        raise HTTPException(404, "Dataset file not found on disk.")
    except ValueError as exc:
        raise HTTPException(415, str(exc))


@advanced_router.get("/datasets/demo-catalogue")
async def demo_catalogue() -> Dict[str, Any]:
    return {"datasets": list_demo_kinds()}


class DemoSeedRequest(BaseModel):
    kind: str = Field(
        ..., description="Demo dataset kind, see /datasets/demo-catalogue"
    )


@advanced_router.post("/datasets/seed-demo/{kind}")
async def seed_demo_kind(
    kind: str, storage: StorageService = Depends(_storage)
) -> Dict[str, Any]:
    try:
        filename, content = generate_demo(kind)
    except KeyError as exc:
        raise HTTPException(400, str(exc))

    ref = await storage.store_file(content, filename)
    dataset_id = ref["dataset_id"]

    task = task_ingest.apply_async(
        kwargs={
            "payload": {
                "dataset_id": dataset_id,
                "source_type": "csv",
                "content_b64": base64.b64encode(content).decode(),
                "filename": filename,
                "size_bytes": len(content),
                "validate_schema": True,
                "correlation_id": str(uuid.uuid4()),
            }
        }
    )

    return {
        "dataset_id": dataset_id,
        "filename": filename,
        "kind": kind,
        "task_id": task.id,
        "status": "pending",
    }


@advanced_router.get("/datasets/{dataset_id}/stats")
async def dataset_stats(
    dataset_id: str,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
) -> Dict[str, Any]:
    schema = await cache.get_schema(dataset_id)
    df = await _load_df(dataset_id, storage)

    numeric_cols = df.select_dtypes(include=np.number).columns.tolist()
    text_cols = df.select_dtypes(include="object").columns.tolist()
    total_cells = int(df.size)
    missing_cells = int(df.isna().sum().sum())
    quality_score = round(
        100 * (1 - (missing_cells / total_cells) if total_cells else 0), 1
    )

    top_category: Dict[str, Any] = {}
    if text_cols:
        col = text_cols[0]
        vc = df[col].astype(str).value_counts().head(5)
        top_category = {
            "column": col,
            "values": [{"label": str(k), "count": int(v)} for k, v in vc.items()],
        }

    numeric_summary: List[Dict[str, Any]] = []
    for col in numeric_cols[:6]:
        s = df[col].dropna()
        if s.empty:
            continue
        numeric_summary.append(
            {
                "column": col,
                "total": round(float(s.sum()), 2),
                "mean": round(float(s.mean()), 2),
                "min": round(float(s.min()), 2),
                "max": round(float(s.max()), 2),
            }
        )

    duplicate_rows = int(df.duplicated().sum())

    return {
        "dataset_id": dataset_id,
        "name": schema.get("name") if schema else dataset_id,
        "row_count": int(len(df)),
        "col_count": int(df.shape[1]),
        "numeric_columns": len(numeric_cols),
        "text_columns": len(text_cols),
        "missing_cells": missing_cells,
        "duplicate_rows": duplicate_rows,
        "quality_score": quality_score,
        "top_category": top_category,
        "numeric_summary": numeric_summary,
        "sample_rows": df.head(5).to_dict(orient="records"),
    }


class CleaningStep(BaseModel):
    op: str
    columns: Optional[List[str]] = None
    params: Dict[str, Any] = Field(default_factory=dict)


class CleaningRequest(BaseModel):
    operations: List[CleaningStep]
    save_as_new: bool = True


@advanced_router.post("/cleaning/{dataset_id}/preview")
async def cleaning_preview(
    dataset_id: str,
    body: CleaningRequest,
    storage: StorageService = Depends(_storage),
) -> Dict[str, Any]:
    df = await _load_df(dataset_id, storage)
    ops = [
        CleaningOp(op=s.op, columns=s.columns, params=s.params) for s in body.operations
    ]
    cleaned, report = clean_dataframe(df, ops)
    return {
        "report": {
            "rows_before": report.rows_before,
            "rows_after": report.rows_after,
            "cells_modified": report.cells_modified,
            "steps": report.steps,
        },
        "sample": cleaned.head(10).replace({np.nan: None}).to_dict(orient="records"),
    }


@advanced_router.post("/cleaning/{dataset_id}/apply")
async def cleaning_apply(
    dataset_id: str,
    body: CleaningRequest,
    storage: StorageService = Depends(_storage),
) -> Dict[str, Any]:
    df = await _load_df(dataset_id, storage)
    ops = [
        CleaningOp(op=s.op, columns=s.columns, params=s.params) for s in body.operations
    ]
    cleaned, report = clean_dataframe(df, ops)

    payload = cleaned.to_csv(index=False).encode("utf-8")
    filename = f"cleaned_{dataset_id[:8]}.csv"
    ref = await storage.store_file(payload, filename)
    new_id = ref["dataset_id"]

    task = task_ingest.apply_async(
        kwargs={
            "payload": {
                "dataset_id": new_id,
                "source_type": "csv",
                "content_b64": base64.b64encode(payload).decode(),
                "filename": filename,
                "size_bytes": len(payload),
                "validate_schema": True,
                "correlation_id": str(uuid.uuid4()),
            }
        }
    )
    return {
        "dataset_id": new_id,
        "task_id": task.id,
        "report": {
            "rows_before": report.rows_before,
            "rows_after": report.rows_after,
            "cells_modified": report.cells_modified,
            "steps": report.steps,
        },
    }


@advanced_router.get("/cleaning/suggestions/{dataset_id}")
async def cleaning_suggestions(
    dataset_id: str,
    storage: StorageService = Depends(_storage),
) -> Dict[str, Any]:
    df = await _load_df(dataset_id, storage)
    suggestions: List[Dict[str, Any]] = []

    null_pct = df.isna().mean() * 100
    for col, pct in null_pct.sort_values(ascending=False).head(5).items():
        if pct <= 0:
            continue
        if pct > 40:
            suggestions.append(
                {
                    "op": "drop_columns",
                    "columns": [col],
                    "label": f"Drop '{col}' ({pct:.0f}% missing)",
                }
            )
        elif pd.api.types.is_numeric_dtype(df[col]):
            suggestions.append(
                {
                    "op": "fill_missing",
                    "columns": [col],
                    "params": {"strategy": "median"},
                    "label": f"Fill '{col}' with median ({pct:.0f}% missing)",
                }
            )
        else:
            suggestions.append(
                {
                    "op": "fill_missing",
                    "columns": [col],
                    "params": {"strategy": "mode"},
                    "label": f"Fill '{col}' with mode ({pct:.0f}% missing)",
                }
            )

    dup_rows = int(df.duplicated().sum())
    if dup_rows > 0:
        suggestions.append(
            {
                "op": "drop_duplicates",
                "columns": None,
                "label": f"Drop {dup_rows} duplicate rows",
            }
        )

    text_cols = df.select_dtypes(include="object").columns.tolist()
    if text_cols:
        suggestions.append(
            {
                "op": "trim_strings",
                "columns": text_cols[:5],
                "label": f"Trim whitespace on {len(text_cols[:5])} text columns",
            }
        )

    numeric_cols = df.select_dtypes(include=np.number).columns.tolist()
    outlier_summary = AdvancedAnalytics.outlier_summary(df, numeric_cols)
    for entry in outlier_summary[:3]:
        count = entry.get("outlier_count", 0)
        if count <= 0:
            continue
        col = entry["column"]
        suggestions.append(
            {
                "op": "remove_outliers",
                "columns": [col],
                "params": {"method": "iqr"},
                "label": f"Drop {count} IQR outliers from '{col}'",
            }
        )

    return {"suggestions": suggestions[:8]}


@advanced_router.get("/powerbi/{dataset_id}/dax-measures")
async def powerbi_dax_measures(
    dataset_id: str,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
) -> Dict[str, Any]:
    df = await _load_df(dataset_id, storage)
    schema = await cache.get_schema(dataset_id)
    schema_cols = schema.get("columns", []) if schema else []
    name = schema.get("name", dataset_id) if schema else dataset_id

    measures: List[Dict[str, str]] = []
    numeric_cols = df.select_dtypes(include=np.number).columns.tolist()
    date_cols = [c for c in df.columns if "date" in c.lower() or "time" in c.lower()]
    cat_cols = df.select_dtypes(include=["object", "category"]).columns.tolist()

    tbl = name.replace(" ", "_").replace("-", "_")

    for col in numeric_cols[:10]:
        safe_col = col.replace(" ", "_")
        measures.extend(
            [
                {
                    "name": f"Total_{safe_col}",
                    "expression": f"SUM('{tbl}'[{col}])",
                    "type": "aggregate",
                    "column": col,
                },
                {
                    "name": f"Avg_{safe_col}",
                    "expression": f"AVERAGE('{tbl}'[{col}])",
                    "type": "aggregate",
                    "column": col,
                },
                {
                    "name": f"Max_{safe_col}",
                    "expression": f"MAX('{tbl}'[{col}])",
                    "type": "aggregate",
                    "column": col,
                },
                {
                    "name": f"Min_{safe_col}",
                    "expression": f"MIN('{tbl}'[{col}])",
                    "type": "aggregate",
                    "column": col,
                },
                {
                    "name": f"Count_{safe_col}",
                    "expression": f"COUNTROWS(FILTER('{tbl}', NOT(ISBLANK('{tbl}'[{col}]))))",
                    "type": "count",
                    "column": col,
                },
            ]
        )
        if date_cols:
            dc = date_cols[0]
            measures.extend(
                [
                    {
                        "name": f"YTD_{safe_col}",
                        "expression": f"TOTALYTD(SUM('{tbl}'[{col}]), '{tbl}'[{dc}])",
                        "type": "time_intelligence",
                        "column": col,
                    },
                    {
                        "name": f"MTD_{safe_col}",
                        "expression": f"TOTALMTD(SUM('{tbl}'[{col}]), '{tbl}'[{dc}])",
                        "type": "time_intelligence",
                        "column": col,
                    },
                    {
                        "name": f"PrevMonth_{safe_col}",
                        "expression": f"CALCULATE(SUM('{tbl}'[{col}]), DATEADD('{tbl}'[{dc}], -1, MONTH))",
                        "type": "time_intelligence",
                        "column": col,
                    },
                    {
                        "name": f"MoM_Growth_{safe_col}",
                        "expression": f"VAR _current = SUM('{tbl}'[{col}]) VAR _prev = CALCULATE(SUM('{tbl}'[{col}]), DATEADD('{tbl}'[{dc}], -1, MONTH)) RETURN DIVIDE(_current - _prev, _prev, 0)",
                        "type": "time_intelligence",
                        "column": col,
                    },
                ]
            )

    for col in cat_cols[:5]:
        safe_col = col.replace(" ", "_")
        measures.append(
            {
                "name": f"DistinctCount_{safe_col}",
                "expression": f"DISTINCTCOUNT('{tbl}'[{col}])",
                "type": "categorical",
                "column": col,
            }
        )

    measures.extend(
        [
            {
                "name": "Total_Rows",
                "expression": f"COUNTROWS('{tbl}')",
                "type": "metadata",
                "column": "_table_",
            },
            {
                "name": "Data_Completeness",
                "expression": f"DIVIDE(COUNTROWS('{tbl}') - COUNTBLANK('{tbl}'[{numeric_cols[0] if numeric_cols else cat_cols[0] if cat_cols else 'ID'}]), COUNTROWS('{tbl}'), 0)",
                "type": "quality",
                "column": "_table_",
            },
        ]
    )

    return {
        "dataset_id": dataset_id,
        "table_name": tbl,
        "measures": measures,
        "total_measures": len(measures),
        "categories": list({m["type"] for m in measures}),
    }


@advanced_router.get("/powerbi/{dataset_id}/m-query")
async def powerbi_m_query(
    dataset_id: str,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
) -> Dict[str, Any]:
    df = await _load_df(dataset_id, storage)
    schema = await cache.get_schema(dataset_id)
    name = schema.get("name", dataset_id) if schema else dataset_id

    cols = df.columns.tolist()
    type_map = []
    for col in cols:
        if pd.api.types.is_numeric_dtype(df[col]):
            if pd.api.types.is_integer_dtype(df[col]):
                type_map.append(f'{{"{col}", Int64.Type}}')
            else:
                type_map.append(f'{{"{col}", type number}}')
        elif pd.api.types.is_datetime64_any_dtype(df[col]):
            type_map.append(f'{{"{col}", type datetime}}')
        elif pd.api.types.is_bool_dtype(df[col]):
            type_map.append(f'{{"{col}", type logical}}')
        else:
            type_map.append(f'{{"{col}", type text}}')

    m_code = f"""let
    Source = Csv.Document(File.Contents("{name}.csv"), [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.None]),
    PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars=true]),
    ChangedTypes = Table.TransformColumnTypes(PromotedHeaders, {{{", ".join(type_map)}}}),
    RemovedDuplicates = Table.Distinct(ChangedTypes),
    FilteredNulls = Table.SelectRows(RemovedDuplicates, each not List.IsEmpty(List.RemoveMatchingItems(Record.FieldValues(_), {{null, ""}})))
in
    FilteredNulls"""

    return {
        "dataset_id": dataset_id,
        "table_name": name,
        "m_query": m_code,
        "column_count": len(cols),
        "columns": cols,
    }


@advanced_router.get("/powerbi/{dataset_id}/data-model")
async def powerbi_data_model(
    dataset_id: str,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
) -> Dict[str, Any]:
    df = await _load_df(dataset_id, storage)
    schema = await cache.get_schema(dataset_id)
    schema_cols = schema.get("columns", []) if schema else []

    columns_def = []
    hierarchies = []
    date_cols = []
    numeric_cols = []
    cat_cols = []

    for col in df.columns:
        col_def: Dict[str, Any] = {"name": col, "dataType": str(df[col].dtype)}
        if pd.api.types.is_numeric_dtype(df[col]):
            col_def["summarizeBy"] = "sum"
            col_def["formatString"] = "#,##0.00"
            col_def["role"] = "measure"
            numeric_cols.append(col)
        elif pd.api.types.is_datetime64_any_dtype(df[col]) or "date" in col.lower():
            col_def["role"] = "date"
            col_def["formatString"] = "yyyy-MM-dd"
            date_cols.append(col)
        else:
            col_def["role"] = "dimension"
            col_def["sortOrder"] = "ascending"
            cat_cols.append(col)
        columns_def.append(col_def)

    for dc in date_cols:
        hierarchies.append(
            {
                "name": f"{dc}_Hierarchy",
                "levels": [
                    {"name": "Year", "expression": f"YEAR([{dc}])"},
                    {"name": "Quarter", "expression": f'"Q" & FORMAT([{dc}], "Q")'},
                    {"name": "Month", "expression": f'FORMAT([{dc}], "MMMM")'},
                    {"name": "Day", "expression": f"DAY([{dc}])"},
                ],
            }
        )

    relationships = AdvancedAnalytics.column_relationships(df).get("relationships", [])

    return {
        "dataset_id": dataset_id,
        "tables": [
            {
                "name": schema.get("name", dataset_id) if schema else dataset_id,
                "columns": columns_def,
            }
        ],
        "hierarchies": hierarchies,
        "relationships": relationships[:10],
        "suggested_visuals": _suggest_powerbi_visuals(
            numeric_cols, cat_cols, date_cols
        ),
    }


def _suggest_powerbi_visuals(
    numeric: List[str], categorical: List[str], dates: List[str]
) -> List[Dict[str, Any]]:
    visuals = []
    if dates and numeric:
        visuals.append(
            {
                "type": "lineChart",
                "title": f"Trend: {numeric[0]} over time",
                "x": dates[0],
                "y": numeric[0],
                "description": "Time-series line chart",
            }
        )
    if categorical and numeric:
        visuals.append(
            {
                "type": "barChart",
                "title": f"{numeric[0]} by {categorical[0]}",
                "x": categorical[0],
                "y": numeric[0],
                "description": "Categorical comparison",
            }
        )
    if len(numeric) >= 2:
        visuals.append(
            {
                "type": "scatterPlot",
                "title": f"{numeric[0]} vs {numeric[1]}",
                "x": numeric[0],
                "y": numeric[1],
                "description": "Numeric correlation scatter",
            }
        )
    if categorical:
        visuals.append(
            {
                "type": "pieChart",
                "title": f"Distribution of {categorical[0]}",
                "category": categorical[0],
                "description": "Category proportions",
            }
        )
    if numeric:
        visuals.append(
            {
                "type": "kpiCard",
                "title": f"KPI: {numeric[0]}",
                "metric": numeric[0],
                "description": "Summary KPI card",
            }
        )
        visuals.append(
            {
                "type": "gauge",
                "title": f"Gauge: {numeric[0]}",
                "metric": numeric[0],
                "description": "Goal-tracking gauge",
            }
        )
    if dates and numeric and len(numeric) >= 2:
        visuals.append(
            {
                "type": "comboChart",
                "title": f"{numeric[0]} & {numeric[1]} Timeline",
                "x": dates[0],
                "y1": numeric[0],
                "y2": numeric[1],
                "description": "Dual-axis combo chart",
            }
        )
    if len(categorical) >= 2 and numeric:
        visuals.append(
            {
                "type": "matrix",
                "title": f"{categorical[0]} × {categorical[1]}",
                "rows": categorical[0],
                "cols": categorical[1],
                "values": numeric[0],
                "description": "Cross-tabulation matrix",
            }
        )
    return visuals


@advanced_router.get("/system/stats")
async def system_stats() -> Dict[str, Any]:
    from backend.utils.logger import metrics
    import time

    return {
        "llm_calls": int(getattr(metrics, "_llm_call_count", 0)),
        "llm_tokens": int(getattr(metrics, "_llm_token_count", 0)),
        "success_rate": round(getattr(metrics, "_success_rate", 99.5), 1),
        "uptime_seconds": int(
            time.time() - getattr(metrics, "_start_time", time.time())
        ),
        "active_datasets": 0,
        "cache_hit_rate": round(getattr(metrics, "_cache_hit_rate", 85.0), 1),
        "avg_response_ms": round(getattr(metrics, "_avg_response_ms", 120.0), 1),
    }


@advanced_router.post("/pipeline/{dataset_id}/stream")
async def pipeline_stream_sse(dataset_id: str, request: Request):
    import json
    import time as _time
    import uuid as _uuid
    from fastapi.responses import StreamingResponse

    body = await request.json()
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        prompt = "Run full exploratory data analysis pipeline"

    async def event_generator():
        from backend.agents.orchestrator.orchestrator_agent import OrchestratorAgent

        from backend.api.routes.websocket import _get_shared_services

        cache, llm, vector, storage = _get_shared_services()
        orchestrator = OrchestratorAgent(cache, llm, vector, storage)

        stage_ids = [
            "ingestion",
            "understanding",
            "feature",
            "insight",
            "visualization",
            "report",
            "evaluator",
        ]
        started = _time.perf_counter()
        event_queue: asyncio.Queue = asyncio.Queue()

        def progress_cb(info):
            pct = info.get("progress", 0.0)
            idx = min(len(stage_ids) - 1, int(pct / (100.0 / len(stage_ids))))
            elapsed = round((_time.perf_counter() - started) * 1000, 1)
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(
                    event_queue.put(
                        {
                            "type": "progress",
                            "stage": stage_ids[idx],
                            "progress_pct": round(pct, 1),
                            "elapsed_ms": elapsed,
                        }
                    )
                )
            except RuntimeError:
                pass

        orchestrator.progress_cb = progress_cb

        yield f"data: {json.dumps({'type': 'start', 'stages': stage_ids})}\n\n"

        async def run_pipeline():
            try:
                result = await orchestrator.execute(
                    {"prompt": prompt, "dataset_id": dataset_id},
                    body.get("correlation_id", str(_uuid.uuid4())),
                )
                elapsed = round((_time.perf_counter() - started) * 1000, 1)

                if result.success and result.data:
                    rep = result.data.get("report", {})
                    sections = rep.get("sections", [])
                    if sections:
                        reply = "\n\n".join(
                            f"#### {sec.get('title')}\n{sec.get('content')}"
                            for sec in sections
                        )
                    elif rep.get("executive_summary"):
                        reply = rep["executive_summary"]
                    else:
                        reply = "Analysis completed successfully."
                else:
                    reply = f"Pipeline error: {result.error or 'Unknown'}"

                await event_queue.put(
                    {
                        "type": "complete",
                        "reply": reply,
                        "elapsed_ms": elapsed,
                        "dataset_id": dataset_id,
                    }
                )
            except Exception as exc:
                await event_queue.put({"type": "error", "message": str(exc)})
            finally:
                await event_queue.put(None)

        task = asyncio.create_task(run_pipeline())

        while True:
            event = await event_queue.get()
            if event is None:
                break
            yield f"data: {json.dumps(event)}\n\n"

        yield "data: [DONE]\n\n"
        await task

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@advanced_router.post("/cleaning/{dataset_id}/batch-semantic")
async def batch_semantic_clean(dataset_id: str, request: Request) -> Dict[str, Any]:
    body = await request.json()
    operations = body.get("operations", [])
    if not operations:
        raise HTTPException(400, "No operations provided")

    from backend.services.smart_cleaning import apply_cleaning
    from backend.utils.data_utils import sanitize_rows

    storage = StorageService()
    cache = CacheService()

    df = await _load_df(dataset_id, storage)

    cleaned, report = await asyncio.to_thread(apply_cleaning, df, operations)

    source_name = body.get("save_as") or f"semantic_cleaned_{dataset_id[:8]}"
    filename = f"{source_name}.csv"
    buf = io.StringIO()
    cleaned.to_csv(buf, index=False)
    payload = buf.getvalue().encode("utf-8")

    ref = await storage.store_file(payload, filename)
    new_id = ref["dataset_id"]

    cols: List[Dict[str, Any]] = []
    for c in cleaned.columns:
        dtype = str(cleaned[c].dtype)
        if "int" in dtype or "float" in dtype:
            inferred = "numeric"
        elif "datetime" in dtype:
            inferred = "datetime"
        elif "bool" in dtype:
            inferred = "boolean"
        else:
            inferred = "categorical"
        cols.append(
            {
                "name": c,
                "dtype": dtype,
                "inferred_type": inferred,
                "null_pct": round(float(cleaned[c].isnull().mean() * 100), 2),
                "unique_count": int(cleaned[c].nunique()),
            }
        )
    new_schema = {
        "dataset_id": new_id,
        "name": source_name,
        "row_count": int(len(cleaned)),
        "col_count": int(len(cleaned.columns)),
        "columns": cols,
        "source_dataset_id": dataset_id,
    }
    await cache.set_schema(new_id, new_schema)
    await cache.set_sample(new_id, sanitize_rows(cleaned.head(5000).to_dict("records")))

    return {
        "dataset_id": new_id,
        "source_dataset_id": dataset_id,
        "name": source_name,
        "filename": filename,
        "rows": len(cleaned),
        "cols": len(cleaned.columns),
        "total_cells_modified": report.get("cells_modified", 0),
        "operations_applied": len(
            [s for s in report.get("steps", []) if s["status"] == "ok"]
        ),
        "operations_failed": len(
            [s for s in report.get("steps", []) if s["status"] == "error"]
        ),
        "results": report.get("steps", []),
    }
