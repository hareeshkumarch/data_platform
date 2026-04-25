from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.config import settings
from backend.services.analytics import AdvancedAnalytics
from backend.services.cache_service import CacheService
from backend.services.storage_service import StorageService

analytics_router = APIRouter(prefix="/analytics", tags=["analytics"])


def _storage() -> StorageService:
    return StorageService()


def _cache() -> CacheService:
    return CacheService()


async def _load_dataframe(dataset_id: str, storage: StorageService) -> pd.DataFrame:
    try:
        return await storage.load_dataframe(dataset_id)
    except FileNotFoundError:
        raise HTTPException(404, "Dataset file not found on disk.")
    except ValueError as exc:
        raise HTTPException(415, str(exc))


async def _cached_response(cache: CacheService, key: str, producer):
    cached = await cache.get_json(key)
    if cached is not None:
        return cached
    result = await producer()
    await cache.set_json(key, result, ttl=settings.ANALYTICS_CACHE_TTL)
    return result


@analytics_router.get("/{dataset_id}/advanced-metrics")
async def advanced_metrics(
    dataset_id: str,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
) -> Dict[str, Any]:
    async def _compute() -> Dict[str, Any]:
        df = await _load_dataframe(dataset_id, storage)
        numeric = df.select_dtypes(include=np.number).columns.tolist()
        text_cols = df.select_dtypes(include="object").columns.tolist()
        results: Dict[str, Any] = {"columns": [], "summary": {}}

        total_cells = int(df.size)
        missing = int(df.isna().sum().sum())
        results["summary"] = {
            "total_rows": int(len(df)),
            "total_columns": int(df.shape[1]),
            "total_cells": total_cells,
            "missing_cells": missing,
            "completeness_pct": round((1 - missing / max(total_cells, 1)) * 100, 2),
            "duplicate_rows": int(df.duplicated().sum()),
            "memory_mb": round(df.memory_usage(deep=True).sum() / 1024 / 1024, 2),
            "numeric_columns": len(numeric),
            "text_columns": len(text_cols),
            "avg_null_pct": round(df.isna().mean().mean() * 100, 2),
        }

        for col in numeric[:15]:
            s = df[col].dropna()
            if s.empty:
                continue
            q1, q3 = float(s.quantile(0.25)), float(s.quantile(0.75))
            iqr = q3 - q1
            mean_val = float(s.mean())
            std_val = float(s.std())
            entry: Dict[str, Any] = {
                "name": col,
                "type": "numeric",
                "count": int(len(s)),
                "mean": round(mean_val, 4),
                "median": round(float(s.median()), 4),
                "std": round(std_val, 4),
                "variance": round(float(s.var()), 4),
                "cv_pct": round(abs(std_val / mean_val) * 100, 2)
                if mean_val != 0
                else 0,
                "iqr": round(iqr, 4),
                "iqr_ratio": round(iqr / (abs(mean_val) + 1e-10), 4),
                "range": round(float(s.max() - s.min()), 4),
                "p5": round(float(s.quantile(0.05)), 4),
                "p25": round(q1, 4),
                "p50": round(float(s.quantile(0.50)), 4),
                "p75": round(q3, 4),
                "p95": round(float(s.quantile(0.95)), 4),
                "p99": round(float(s.quantile(0.99)), 4),
            }
            try:
                counts, _ = np.histogram(s, bins=min(20, int(len(s) ** 0.4)))
                probs = counts / counts.sum()
                probs = probs[probs > 0]
                entry["entropy"] = round(float(-np.sum(probs * np.log2(probs))), 4)
            except Exception:
                entry["entropy"] = 0.0

            try:
                sorted_vals = np.sort(s.values)
                n = len(sorted_vals)
                index = np.arange(1, n + 1)
                entry["gini"] = round(
                    float(
                        (2 * np.sum(index * sorted_vals) / (n * np.sum(sorted_vals)))
                        - (n + 1) / n
                    ),
                    4,
                )
            except Exception:
                entry["gini"] = 0.0

            try:
                from scipy import stats as sp

                entry["skewness"] = round(float(sp.skew(s)), 4)
                entry["kurtosis"] = round(float(sp.kurtosis(s)), 4)
            except Exception:
                entry["skewness"] = 0.0
                entry["kurtosis"] = 0.0

            if std_val > 0:
                z = (s - mean_val) / std_val
                entry["max_zscore"] = round(float(z.abs().max()), 3)
                entry["pct_beyond_2z"] = round(float((z.abs() > 2).mean() * 100), 2)
                entry["pct_beyond_3z"] = round(float((z.abs() > 3).mean() * 100), 2)

            results["columns"].append(entry)

        for col in text_cols[:10]:
            s = df[col].dropna().astype(str)
            if s.empty:
                continue
            vc = s.value_counts()
            probs = vc / vc.sum()
            entropy = float(-np.sum(probs * np.log2(probs + 1e-10)))
            results["columns"].append(
                {
                    "name": col,
                    "type": "text",
                    "count": int(len(s)),
                    "unique_count": int(s.nunique()),
                    "unique_ratio": round(s.nunique() / max(len(s), 1), 4),
                    "entropy": round(entropy, 4),
                    "avg_length": round(float(s.str.len().mean()), 1),
                    "max_length": int(s.str.len().max()),
                    "min_length": int(s.str.len().min()),
                    "top_value": str(vc.index[0]) if len(vc) else None,
                    "top_value_pct": round(float(vc.iloc[0] / len(s) * 100), 2)
                    if len(vc)
                    else 0,
                    "has_whitespace_issues": bool(s.str.strip().ne(s).any()),
                    "has_mixed_case": bool(
                        s.str.lower().ne(s).any() and s.str.upper().ne(s).any()
                    ),
                }
            )

        return results

    return await _cached_response(cache, f"analytics:advanced:{dataset_id}", _compute)


@analytics_router.get("/{dataset_id}/correlations")
async def correlations(
    dataset_id: str,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
) -> Dict[str, Any]:
    async def _compute() -> Dict[str, Any]:
        df = await _load_dataframe(dataset_id, storage)
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

    return await _cached_response(
        cache, f"analytics:correlations:{dataset_id}", _compute
    )


@analytics_router.get("/{dataset_id}/outliers")
async def outliers(
    dataset_id: str,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
) -> Dict[str, Any]:
    async def _compute() -> Dict[str, Any]:
        df = await _load_dataframe(dataset_id, storage)
        numeric_cols = df.select_dtypes(include=np.number).columns.tolist()
        return {"outliers": AdvancedAnalytics.outlier_summary(df, numeric_cols)}

    return await _cached_response(cache, f"analytics:outliers:{dataset_id}", _compute)


@analytics_router.get("/{dataset_id}/trends")
async def trends(
    dataset_id: str,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
    column: Optional[str] = None,
) -> Dict[str, Any]:
    async def _compute() -> Dict[str, Any]:
        df = await _load_dataframe(dataset_id, storage)
        date_cols = df.select_dtypes(include="datetime").columns.tolist()
        if not date_cols:
            raise HTTPException(
                400, "No datetime column available for trend detection."
            )
        numeric_cols = df.select_dtypes(include=np.number).columns.tolist()
        value_col = (
            column
            if column and column in numeric_cols
            else (numeric_cols[0] if numeric_cols else None)
        )
        if not value_col:
            raise HTTPException(400, "No numeric column available for trends.")
        return AdvancedAnalytics.detect_trends(df, date_cols[0], value_col)

    cache_key = f"analytics:trends:{dataset_id}:{column or 'default'}"
    return await _cached_response(cache, cache_key, _compute)


@analytics_router.get("/{dataset_id}/distributions")
async def distributions(
    dataset_id: str,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
) -> Dict[str, Any]:
    async def _compute() -> Dict[str, Any]:
        df = await _load_dataframe(dataset_id, storage)
        numeric_cols = df.select_dtypes(include=np.number).columns.tolist()
        return AdvancedAnalytics.distribution_analysis(df, numeric_cols)

    return await _cached_response(
        cache, f"analytics:distributions:{dataset_id}", _compute
    )


@analytics_router.get("/{dataset_id}/quality")
async def quality_score(
    dataset_id: str,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
) -> Dict[str, Any]:
    async def _compute() -> Dict[str, Any]:
        df = await _load_dataframe(dataset_id, storage)
        schema = await cache.get_schema(dataset_id)
        schema_cols = schema.get("columns", []) if schema else []
        return AdvancedAnalytics.data_quality_score(df, schema_cols)

    return await _cached_response(cache, f"analytics:quality:{dataset_id}", _compute)


@analytics_router.get("/{dataset_id}/relationships")
async def relationships(
    dataset_id: str,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
) -> Dict[str, Any]:
    async def _compute() -> Dict[str, Any]:
        df = await _load_dataframe(dataset_id, storage)
        return AdvancedAnalytics.column_relationships(df)

    return await _cached_response(
        cache, f"analytics:relationships:{dataset_id}", _compute
    )


@analytics_router.get("/{dataset_id}/decomposition")
async def decomposition(
    dataset_id: str,
    column: Optional[str] = None,
    period: int = 7,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
) -> Dict[str, Any]:
    async def _compute() -> Dict[str, Any]:
        df = await _load_dataframe(dataset_id, storage)
        date_cols = [
            c
            for c in df.columns
            if any(token in c.lower() for token in ("date", "ts", "time"))
        ]
        if not date_cols:
            raise HTTPException(400, "No date/time column found in dataset.")
        numeric_cols = df.select_dtypes(include=np.number).columns.tolist()
        value_col = (
            column
            if column and column in numeric_cols
            else (numeric_cols[0] if numeric_cols else None)
        )
        if not value_col:
            raise HTTPException(400, "No numeric column available for decomposition.")
        return AdvancedAnalytics.ts_decomposition(df, date_cols[0], value_col, period)

    cache_key = f"analytics:decomposition:{dataset_id}:{column or 'default'}:{period}"
    return await _cached_response(cache, cache_key, _compute)


@analytics_router.get("/{dataset_id}/drift")
async def drift_detection(
    dataset_id: str,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
) -> Dict[str, Any]:
    async def _compute() -> Dict[str, Any]:
        df = await _load_dataframe(dataset_id, storage)
        numeric_cols = df.select_dtypes(include=np.number).columns.tolist()
        return AdvancedAnalytics.drift_detection(df, numeric_cols)

    return await _cached_response(cache, f"analytics:drift:{dataset_id}", _compute)


class FeatureImportanceRequest(BaseModel):
    target_col: str


@analytics_router.post("/{dataset_id}/feature-importance")
async def feature_importance(
    dataset_id: str,
    body: FeatureImportanceRequest,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
) -> Dict[str, Any]:
    async def _compute() -> Dict[str, Any]:
        df = await _load_dataframe(dataset_id, storage)
        numeric_cols = df.select_dtypes(include=np.number).columns.tolist()
        if body.target_col not in df.columns:
            raise HTTPException(400, f"Target column '{body.target_col}' not found.")
        return AdvancedAnalytics.feature_importance(df, body.target_col, numeric_cols)

    cache_key = f"analytics:feature-importance:{dataset_id}:{body.target_col}"
    return await _cached_response(cache, cache_key, _compute)


@analytics_router.get("/{dataset_id}/forecast")
async def forecast(
    dataset_id: str,
    column: str,
    periods: int = 12,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
) -> Dict[str, Any]:
    if periods < 1 or periods > 120:
        raise HTTPException(422, "'periods' must be between 1 and 120.")

    async def _compute() -> Dict[str, Any]:
        df = await _load_dataframe(dataset_id, storage)
        if column not in df.columns:
            raise HTTPException(400, f"Unknown column: {column}")
        date_cols = [
            c
            for c in df.columns
            if any(token in c.lower() for token in ("date", "ts", "time"))
        ]
        if not date_cols:
            raise HTTPException(
                400, "Forecasting requires a date/time column in the dataset."
            )
        ts = df[[date_cols[0], column]].copy()
        ts[date_cols[0]] = pd.to_datetime(ts[date_cols[0]], errors="coerce")
        ts = ts.dropna().sort_values(date_cols[0])
        if len(ts) < 5:
            raise HTTPException(
                400, "Not enough data points for a forecast (minimum 5 required)."
            )
        grouped = (
            ts.groupby(pd.Grouper(key=date_cols[0], freq="M"))[column].mean().dropna()
        )
        if len(grouped) < 3:
            raise HTTPException(
                400,
                "Not enough monthly aggregates for a forecast (minimum 3 required).",
            )
        x = np.arange(len(grouped))
        y = grouped.values
        slope, intercept = np.polyfit(x, y, 1)
        future_x = np.arange(len(grouped), len(grouped) + periods)
        future = (slope * future_x + intercept).tolist()

        residuals = y - (slope * x + intercept)
        residual_std = float(np.std(residuals)) if len(residuals) > 1 else 0.0
        ci_upper = [(slope * fx + intercept + 1.96 * residual_std) for fx in future_x]
        ci_lower = [(slope * fx + intercept - 1.96 * residual_std) for fx in future_x]
        r_squared = (
            1.0 - (np.sum(residuals**2) / np.sum((y - np.mean(y)) ** 2))
            if np.sum((y - np.mean(y)) ** 2) > 0
            else 0.0
        )

        confidence_level = (
            "high" if r_squared > 0.7 else "medium" if r_squared > 0.4 else "low"
        )
        warnings = []
        if len(grouped) < 12:
            warnings.append(
                "Limited data: fewer than 12 monthly observations reduce forecast reliability."
            )
        if residual_std > abs(np.mean(y)) * 0.5:
            warnings.append(
                "High variance: residual noise exceeds 50% of the mean, treat with caution."
            )

        return {
            "history": grouped.round(4).to_dict(),
            "forecast": [round(float(val), 4) for val in future],
            "confidence": {
                "level": confidence_level,
                "r_squared": round(float(r_squared), 4),
                "residual_std": round(residual_std, 4),
                "ci_upper_95": [round(float(v), 4) for v in ci_upper],
                "ci_lower_95": [round(float(v), 4) for v in ci_lower],
            },
            "method": {
                "name": "linear_regression",
                "description": "Simple linear trend extrapolation on monthly-aggregated values.",
                "assumptions": [
                    "Assumes a linear trend continuation.",
                    "Monthly aggregation smooths sub-monthly variation.",
                    "No seasonality or external variable adjustments.",
                ],
                "min_data_points": 5,
                "data_points_used": int(len(grouped)),
            },
            "warnings": warnings,
        }

    cache_key = f"analytics:forecast:{dataset_id}:{column}:{periods}"
    return await _cached_response(cache, cache_key, _compute)


@analytics_router.get("/{dataset_id}/anomalies")
async def anomalies(
    dataset_id: str,
    column: str,
    threshold: float = 3.0,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
) -> Dict[str, Any]:
    if threshold < 1.0 or threshold > 10.0:
        raise HTTPException(422, "'threshold' must be between 1.0 and 10.0.")

    async def _compute() -> Dict[str, Any]:
        df = await _load_dataframe(dataset_id, storage)
        if column not in df.columns or not pd.api.types.is_numeric_dtype(df[column]):
            raise HTTPException(
                400, f"Column '{column}' is not numeric or does not exist."
            )
        s = df[column].dropna()
        if len(s) < 10:
            raise HTTPException(
                400,
                f"Column '{column}' has fewer than 10 non-null values; anomaly detection requires at least 10.",
            )
        mean_val = float(s.mean())
        std_val = float(s.std(ddof=0)) or 1.0
        z = (s - mean_val) / std_val
        hits = z.abs() > threshold
        anomalies = []
        for idx, score in zip(s[hits].index, z[hits].values):
            value = s.loc[idx]
            anomalies.append(
                {
                    "index": int(idx),
                    "value": float(value),
                    "z_score": round(float(score), 3),
                }
            )
        rate_pct = round(float(hits.mean() * 100), 2) if len(s) else 0.0
        return {
            "column": column,
            "count": int(hits.sum()),
            "rate_pct": rate_pct,
            "threshold": threshold,
            "anomalies": anomalies[:100],
            "confidence": {
                "level": "high"
                if len(s) >= 100
                else "medium"
                if len(s) >= 30
                else "low",
                "sample_size": int(len(s)),
            },
            "method": {
                "name": "z_score",
                "description": "Points whose absolute z-score exceeds the threshold are flagged.",
                "assumptions": [
                    "Assumes approximately normal distribution.",
                    "Sensitive to extreme skew or heavy tails.",
                    "Not suitable for multimodal distributions.",
                ],
                "min_data_points": 10,
            },
            "stats": {
                "mean": round(mean_val, 4),
                "std": round(std_val, 4),
            },
        }

    cache_key = f"analytics:anomalies:{dataset_id}:{column}:{threshold}"
    return await _cached_response(cache, cache_key, _compute)


class SegmentationRequest(BaseModel):
    segment_col: str
    metric_cols: List[str]


@analytics_router.post("/{dataset_id}/segments")
async def segmentation(
    dataset_id: str,
    body: SegmentationRequest,
    storage: StorageService = Depends(_storage),
    cache: CacheService = Depends(_cache),
) -> Dict[str, Any]:
    async def _compute() -> Dict[str, Any]:
        df = await _load_dataframe(dataset_id, storage)
        if body.segment_col not in df.columns:
            raise HTTPException(400, f"Unknown column: {body.segment_col}")
        return AdvancedAnalytics.segment_analysis(
            df, body.segment_col, body.metric_cols
        )

    cache_key = f"analytics:segments:{dataset_id}:{body.segment_col}:{','.join(sorted(body.metric_cols))}"
    return await _cached_response(cache, cache_key, _compute)
