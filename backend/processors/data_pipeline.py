from __future__ import annotations
import asyncio
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

import pandas as pd
import numpy as np

from backend.utils.logger import get_logger

logger = get_logger(__name__)


# ── Base Processor ────────────────────────────────────────────────────────────

class BaseProcessor(ABC):
    name: str = "base"

    @abstractmethod
    def process(self, df: pd.DataFrame, config: Dict[str, Any]) -> pd.DataFrame: ...

    def __call__(self, df: pd.DataFrame, config: Dict[str, Any] = None) -> pd.DataFrame:
        try:
            result = self.process(df, config or {})
            logger.info(f"{self.name} processor done", rows_in=len(df), rows_out=len(result))
            return result
        except Exception as e:
            logger.error(f"{self.name} processor failed", error=str(e))
            return df


# ── Processors ────────────────────────────────────────────────────────────────

class DropHighNullProcessor(BaseProcessor):
    name = "drop_high_null"

    def process(self, df: pd.DataFrame, config: Dict) -> pd.DataFrame:
        threshold = config.get("threshold_pct", 80)
        null_pct = df.isna().mean() * 100
        keep_cols = null_pct[null_pct <= threshold].index.tolist()
        dropped = [c for c in df.columns if c not in keep_cols]
        if dropped:
            logger.info("Dropped high-null columns", cols=dropped)
        return df[keep_cols]


class DeduplicateProcessor(BaseProcessor):
    name = "deduplicate"

    def process(self, df: pd.DataFrame, config: Dict) -> pd.DataFrame:
        subset = config.get("subset")
        before = len(df)
        df = df.drop_duplicates(subset=subset, keep="first").reset_index(drop=True)
        logger.info("Deduplication", removed=before - len(df))
        return df


class TypeCastProcessor(BaseProcessor):
    name = "type_cast"

    def process(self, df: pd.DataFrame, config: Dict) -> pd.DataFrame:
        casts = config.get("casts", {})
        for col, dtype in casts.items():
            if col not in df.columns:
                continue
            try:
                if dtype == "datetime":
                    df[col] = pd.to_datetime(df[col], errors="coerce")
                elif dtype == "numeric":
                    df[col] = pd.to_numeric(df[col], errors="coerce")
                elif dtype == "string":
                    df[col] = df[col].astype(str)
                elif dtype == "boolean":
                    df[col] = df[col].astype(bool)
            except Exception as e:
                logger.warning("Type cast failed", col=col, dtype=dtype, error=str(e))
        return df


class OutlierClipProcessor(BaseProcessor):
    name = "outlier_clip"

    def process(self, df: pd.DataFrame, config: Dict) -> pd.DataFrame:
        method = config.get("method", "iqr")
        cols = config.get("columns") or df.select_dtypes("number").columns.tolist()
        for col in cols:
            if col not in df.columns:
                continue
            s = df[col].dropna()
            if method == "iqr":
                q1, q3 = s.quantile(0.25), s.quantile(0.75)
                iqr = q3 - q1
                df[col] = df[col].clip(q1 - 1.5 * iqr, q3 + 1.5 * iqr)
            elif method == "zscore":
                mean, std = s.mean(), s.std()
                if std > 0:
                    df[col] = df[col].clip(mean - 3 * std, mean + 3 * std)
        return df


class ImputeProcessor(BaseProcessor):
    name = "impute"

    def process(self, df: pd.DataFrame, config: Dict) -> pd.DataFrame:
        strategy = config.get("strategy", "median")
        for col in df.columns:
            if df[col].isna().sum() == 0:
                continue
            try:
                if pd.api.types.is_numeric_dtype(df[col]):
                    fill_val = df[col].median() if strategy == "median" else df[col].mean()
                    df[col] = df[col].fillna(fill_val)
                elif df[col].dtype == object:
                    df[col] = df[col].fillna(df[col].mode()[0] if len(df[col].mode()) else "unknown")
            except Exception:
                pass
        return df


class NormalizeProcessor(BaseProcessor):
    name = "normalize"

    def process(self, df: pd.DataFrame, config: Dict) -> pd.DataFrame:
        method = config.get("method", "minmax")
        cols = config.get("columns") or df.select_dtypes("number").columns.tolist()
        for col in cols:
            if col not in df.columns:
                continue
            s = df[col]
            if method == "minmax":
                mn, mx = s.min(), s.max()
                if mx > mn:
                    df[col] = (s - mn) / (mx - mn)
            elif method == "zscore":
                std = s.std()
                if std > 0:
                    df[col] = (s - s.mean()) / std
        return df


class FilterRowsProcessor(BaseProcessor):
    name = "filter_rows"

    def process(self, df: pd.DataFrame, config: Dict) -> pd.DataFrame:
        conditions = config.get("conditions", [])
        for cond in conditions:
            col = cond.get("column")
            op = cond.get("operator")
            val = cond.get("value")
            if col not in df.columns:
                continue
            try:
                if op == "eq": df = df[df[col] == val]
                elif op == "ne": df = df[df[col] != val]
                elif op == "gt": df = df[df[col] > val]
                elif op == "lt": df = df[df[col] < val]
                elif op == "gte": df = df[df[col] >= val]
                elif op == "lte": df = df[df[col] <= val]
                elif op == "in": df = df[df[col].isin(val)]
                elif op == "contains": df = df[df[col].astype(str).str.contains(str(val), na=False)]
            except Exception as e:
                logger.warning("Filter failed", col=col, op=op, error=str(e))
        return df.reset_index(drop=True)


class RenameColumnsProcessor(BaseProcessor):
    name = "rename_columns"

    def process(self, df: pd.DataFrame, config: Dict) -> pd.DataFrame:
        mapping = config.get("mapping", {})
        return df.rename(columns={k: v for k, v in mapping.items() if k in df.columns})


class SortProcessor(BaseProcessor):
    name = "sort"

    def process(self, df: pd.DataFrame, config: Dict) -> pd.DataFrame:
        by = config.get("by", [])
        ascending = config.get("ascending", True)
        valid = [c for c in (by if isinstance(by, list) else [by]) if c in df.columns]
        if valid:
            df = df.sort_values(valid, ascending=ascending).reset_index(drop=True)
        return df


class SampleProcessor(BaseProcessor):
    name = "sample"

    def process(self, df: pd.DataFrame, config: Dict) -> pd.DataFrame:
        n = config.get("n")
        frac = config.get("frac")
        seed = config.get("seed", 42)
        if n:
            return df.sample(min(n, len(df)), random_state=seed).reset_index(drop=True)
        if frac:
            return df.sample(frac=frac, random_state=seed).reset_index(drop=True)
        return df


# ── Pipeline Runner ───────────────────────────────────────────────────────────

PROCESSOR_REGISTRY: Dict[str, BaseProcessor] = {
    "drop_high_null":  DropHighNullProcessor(),
    "deduplicate":     DeduplicateProcessor(),
    "type_cast":       TypeCastProcessor(),
    "outlier_clip":    OutlierClipProcessor(),
    "impute":          ImputeProcessor(),
    "normalize":       NormalizeProcessor(),
    "filter_rows":     FilterRowsProcessor(),
    "rename_columns":  RenameColumnsProcessor(),
    "sort":            SortProcessor(),
    "sample":          SampleProcessor(),
}


class DataPipeline:

    def __init__(self, steps: List[Dict[str, Any]]):
        self.steps = steps

    async def run(self, df: pd.DataFrame) -> Dict[str, Any]:
        log: List[Dict] = []
        for step in self.steps:
            name = step.get("processor")
            config = step.get("config", {})
            proc = PROCESSOR_REGISTRY.get(name)
            if not proc:
                log.append({"processor": name, "status": "skipped", "reason": "unknown processor"})
                continue
            before = len(df)
            df = await asyncio.to_thread(proc, df, config)
            log.append({"processor": name, "rows_before": before, "rows_after": len(df), "status": "ok"})

        return {"rows": len(df), "columns": list(df.columns), "pipeline_log": log, "df": df}

    @staticmethod
    def available_processors() -> List[Dict[str, str]]:
        return [
            {"name": "drop_high_null", "description": "Drop columns with null% above threshold", "config": {"threshold_pct": "int (default 80)"}},
            {"name": "deduplicate", "description": "Remove duplicate rows", "config": {"subset": "list of columns (optional)"}},
            {"name": "type_cast", "description": "Cast columns to specified types", "config": {"casts": {"col": "datetime|numeric|string|boolean"}}},
            {"name": "outlier_clip", "description": "Clip outliers using IQR or Z-score", "config": {"method": "iqr|zscore", "columns": "list (optional)"}},
            {"name": "impute", "description": "Fill nulls with median/mean/mode", "config": {"strategy": "median|mean"}},
            {"name": "normalize", "description": "Normalize numeric columns", "config": {"method": "minmax|zscore", "columns": "list (optional)"}},
            {"name": "filter_rows", "description": "Filter rows by conditions", "config": {"conditions": [{"column": "str", "operator": "eq|ne|gt|lt|gte|lte|in|contains", "value": "any"}]}},
            {"name": "rename_columns", "description": "Rename columns", "config": {"mapping": {"old_name": "new_name"}}},
            {"name": "sort", "description": "Sort rows", "config": {"by": "str|list", "ascending": "bool"}},
            {"name": "sample", "description": "Sample rows", "config": {"n": "int", "frac": "float (0-1)", "seed": "int"}},
        ]
