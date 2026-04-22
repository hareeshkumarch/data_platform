"""Advanced routes: extra demo datasets, cleaning pipeline, advanced analytics
and post-ingestion stats.

Kept as a separate module so the legacy endpoint file stays focused on the
original surface area while new capabilities land here with clean typing.
"""

from __future__ import annotations

import base64
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
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
    path = storage.get_file_path(dataset_id)
    if not path or not Path(path).exists():
        raise HTTPException(404, "Dataset file not found on disk.")
    suffix = Path(path).suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path)
    if suffix in (".xlsx", ".xls"):
        return pd.read_excel(path)
    if suffix == ".json":
        return pd.read_json(path)
    if suffix == ".parquet":
        return pd.read_parquet(path)
    raise HTTPException(415, f"Unsupported file type: {suffix}")


# ---------------------------------------------------------------------------
# Demo catalogue
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Post-ingestion stats
# ---------------------------------------------------------------------------


@advanced_router.get("/datasets/{dataset_id}/stats")
async def dataset_stats(
    dataset_id: str,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
) -> Dict[str, Any]:
    """Return a consolidated stat-pack used by the ingestion summary cards."""
    schema = await cache.get_schema(dataset_id)
    df = await _load_df(dataset_id, storage)

    numeric_cols = df.select_dtypes(include=np.number).columns.tolist()
    text_cols = df.select_dtypes(include="object").columns.tolist()
    total_cells = int(df.size)
    missing_cells = int(df.isna().sum().sum())
    quality_score = round(
        100 * (1 - (missing_cells / total_cells) if total_cells else 0), 1
    )

    # Top categorical distribution for the highlight card
    top_category: Dict[str, Any] = {}
    if text_cols:
        col = text_cols[0]
        vc = df[col].astype(str).value_counts().head(5)
        top_category = {
            "column": col,
            "values": [{"label": str(k), "count": int(v)} for k, v in vc.items()],
        }

    # Numeric leaderboard
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


# ---------------------------------------------------------------------------
# Advanced analytics
# ---------------------------------------------------------------------------


@advanced_router.get("/analytics/{dataset_id}/correlations")
async def correlations(
    dataset_id: str,
    storage: StorageService = Depends(_storage),
) -> Dict[str, Any]:
    df = await _load_df(dataset_id, storage)
    numeric = df.select_dtypes(include=np.number)
    if numeric.empty:
        return {"columns": [], "matrix": []}
    corr = numeric.corr().round(4).fillna(0)
    return {
        "columns": corr.columns.tolist(),
        "matrix": corr.values.tolist(),
        "pairs": AdvancedAnalytics.deep_correlation(
            df, corr.columns[0], corr.columns.tolist()
        ).get("correlations", [])[:20],
    }


@advanced_router.get("/analytics/{dataset_id}/outliers")
async def outliers(
    dataset_id: str,
    storage: StorageService = Depends(_storage),
) -> Dict[str, Any]:
    df = await _load_df(dataset_id, storage)
    numeric = df.select_dtypes(include=np.number).columns.tolist()
    return {"outliers": AdvancedAnalytics.outlier_summary(df, numeric)}


@advanced_router.get("/analytics/{dataset_id}/trends")
async def trends(
    dataset_id: str,
    storage: StorageService = Depends(_storage),
) -> Dict[str, Any]:
    df = await _load_df(dataset_id, storage)
    date_cols = [
        c
        for c in df.columns
        if "date" in c.lower() or "ts" in c.lower() or "time" in c.lower()
    ]
    numeric_cols = df.select_dtypes(include=np.number).columns.tolist()
    if not date_cols or not numeric_cols:
        return {"trends": []}
    results = []
    for value_col in numeric_cols[:6]:
        result = AdvancedAnalytics.detect_trends(df, date_cols[0], value_col)
        if "error" not in result:
            result["value_column"] = value_col
            result["date_column"] = date_cols[0]
            results.append(result)
    return {"trends": results}


@advanced_router.get("/analytics/{dataset_id}/forecast")
async def forecast(
    dataset_id: str,
    column: str,
    periods: int = 12,
    storage: StorageService = Depends(_storage),
) -> Dict[str, Any]:
    df = await _load_df(dataset_id, storage)
    if column not in df.columns:
        raise HTTPException(400, f"Unknown column: {column}")
    date_cols = [
        c
        for c in df.columns
        if "date" in c.lower() or "ts" in c.lower() or "time" in c.lower()
    ]
    if not date_cols:
        raise HTTPException(
            400, "Forecasting requires a date/time column in the dataset."
        )
    ts = df[[date_cols[0], column]].copy()
    ts[date_cols[0]] = pd.to_datetime(ts[date_cols[0]], errors="coerce")
    ts = ts.dropna().sort_values(date_cols[0])
    if len(ts) < 5:
        raise HTTPException(400, "Not enough data points for a forecast.")
    grouped = ts.groupby(pd.Grouper(key=date_cols[0], freq="M"))[column].mean().dropna()
    if len(grouped) < 3:
        grouped = ts.set_index(date_cols[0])[column]

    x = np.arange(len(grouped))
    slope, intercept = np.polyfit(x, grouped.values, 1)
    future_x = np.arange(len(grouped), len(grouped) + periods)
    future_y = slope * future_x + intercept

    rolling = grouped.rolling(min_periods=1, window=3).mean()
    history = [
        {
            "date": str(ts_val.date() if hasattr(ts_val, "date") else ts_val),
            "value": round(float(v), 4),
        }
        for ts_val, v in zip(grouped.index, grouped.values)
    ]
    smoothed = [
        {
            "date": str(ts_val.date() if hasattr(ts_val, "date") else ts_val),
            "value": round(float(v), 4),
        }
        for ts_val, v in zip(rolling.index, rolling.values)
    ]
    last_ts = grouped.index[-1]
    step = pd.tseries.frequencies.to_offset("M")
    future = []
    for i, y in enumerate(future_y, start=1):
        future_ts = last_ts + step * i
        future.append(
            {
                "date": str(
                    future_ts.date() if hasattr(future_ts, "date") else future_ts
                ),
                "value": round(float(y), 4),
            }
        )

    return {
        "column": column,
        "history": history,
        "smoothed": smoothed,
        "forecast": future,
        "slope": round(float(slope), 6),
        "intercept": round(float(intercept), 6),
    }


@advanced_router.get("/analytics/{dataset_id}/anomalies")
async def anomalies(
    dataset_id: str,
    column: str,
    threshold: float = 3.0,
    storage: StorageService = Depends(_storage),
) -> Dict[str, Any]:
    df = await _load_df(dataset_id, storage)
    if column not in df.columns or not pd.api.types.is_numeric_dtype(df[column]):
        raise HTTPException(400, f"Column '{column}' is not numeric.")
    s = df[column].dropna()
    z = (s - s.mean()) / (s.std(ddof=0) or 1.0)
    hits = z.abs() > threshold
    points = []
    for idx, (value, score) in enumerate(zip(s[hits].values, z[hits].values)):
        points.append(
            {
                "index": int(s[hits].index[idx]),
                "value": float(value),
                "z_score": round(float(score), 3),
            }
        )
    return {
        "column": column,
        "count": int(hits.sum()),
        "rate_pct": round(float(hits.mean() * 100), 2) if len(s) else 0.0,
        "threshold": threshold,
        "anomalies": points[:100],
    }


class SegmentationRequest(BaseModel):
    segment_col: str
    metric_cols: List[str]


@advanced_router.post("/analytics/{dataset_id}/segments")
async def segmentation(
    dataset_id: str,
    body: SegmentationRequest,
    storage: StorageService = Depends(_storage),
) -> Dict[str, Any]:
    df = await _load_df(dataset_id, storage)
    if body.segment_col not in df.columns:
        raise HTTPException(400, f"Unknown column: {body.segment_col}")
    return AdvancedAnalytics.segment_analysis(df, body.segment_col, body.metric_cols)


# ---------------------------------------------------------------------------
# Data cleaning
# ---------------------------------------------------------------------------


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
    """Heuristic recommendations the UI renders as one-click chips."""
    df = await _load_df(dataset_id, storage)
    suggestions: List[Dict[str, Any]] = []

    # Nulls
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

    # Duplicates
    dup_rows = int(df.duplicated().sum())
    if dup_rows > 0:
        suggestions.append(
            {
                "op": "drop_duplicates",
                "columns": None,
                "label": f"Drop {dup_rows} duplicate rows",
            }
        )

    # String trimming
    text_cols = df.select_dtypes(include="object").columns.tolist()
    if text_cols:
        suggestions.append(
            {
                "op": "trim_strings",
                "columns": text_cols[:5],
                "label": f"Trim whitespace on {len(text_cols[:5])} text columns",
            }
        )

    # Outliers
    numeric_cols = df.select_dtypes(include=np.number).columns.tolist()
    for col in numeric_cols[:3]:
        s = df[col].dropna()
        if len(s) < 20:
            continue
        q1, q3 = s.quantile(0.25), s.quantile(0.75)
        iqr = q3 - q1
        lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        outlier_count = int(((s < lo) | (s > hi)).sum())
        if outlier_count > 0:
            suggestions.append(
                {
                    "op": "remove_outliers",
                    "columns": [col],
                    "params": {"method": "iqr"},
                    "label": f"Drop {outlier_count} IQR outliers from '{col}'",
                }
            )

    return {"suggestions": suggestions[:8]}
