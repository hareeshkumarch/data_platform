"""Rule-based data cleaning engine.

Operations are applied sequentially against a pandas DataFrame and return a
mutation report so the UI can show what changed. Each op is a self-contained
function so new rules are easy to add.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd


@dataclass
class CleaningOp:
    """A single cleaning instruction."""

    op: str
    columns: Optional[List[str]] = None
    params: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CleaningReport:
    rows_before: int
    rows_after: int
    cells_modified: int
    steps: List[Dict[str, Any]]


def clean_dataframe(df: pd.DataFrame, operations: List[CleaningOp]) -> tuple[pd.DataFrame, CleaningReport]:
    """Apply a list of cleaning operations and return the new DataFrame + report."""
    rows_before = len(df)
    df = df.copy()
    total_modified = 0
    steps: List[Dict[str, Any]] = []

    handlers = {
        "drop_duplicates": _drop_duplicates,
        "drop_nulls": _drop_nulls,
        "fill_missing": _fill_missing,
        "trim_strings": _trim_strings,
        "standardize_case": _standardize_case,
        "coerce_types": _coerce_types,
        "remove_outliers": _remove_outliers,
        "drop_columns": _drop_columns,
        "rename_columns": _rename_columns,
        "clip_values": _clip_values,
    }

    for op in operations:
        handler = handlers.get(op.op)
        if handler is None:
            steps.append({"op": op.op, "status": "skipped", "reason": "unknown op"})
            continue
        try:
            df, modified = handler(df, op)
            total_modified += modified
            steps.append({"op": op.op, "columns": op.columns or "all", "modified": modified, "status": "ok"})
        except Exception as exc:
            steps.append({"op": op.op, "columns": op.columns, "status": "error", "error": str(exc)})

    return df, CleaningReport(
        rows_before=rows_before,
        rows_after=len(df),
        cells_modified=total_modified,
        steps=steps,
    )


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


def _drop_duplicates(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    before = len(df)
    cleaned = df.drop_duplicates(subset=op.columns or None, keep="first")
    return cleaned, before - len(cleaned)


def _drop_nulls(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    before = len(df)
    cleaned = df.dropna(subset=op.columns or None)
    return cleaned, before - len(cleaned)


def _fill_missing(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    strategy = op.params.get("strategy", "mean")
    cols = op.columns or df.columns.tolist()
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        null_mask = df[col].isna()
        if not null_mask.any():
            continue
        if strategy == "mean" and pd.api.types.is_numeric_dtype(df[col]):
            value = df[col].mean()
        elif strategy == "median" and pd.api.types.is_numeric_dtype(df[col]):
            value = df[col].median()
        elif strategy == "mode":
            value = df[col].mode().iloc[0] if not df[col].mode().empty else None
        elif strategy == "zero":
            value = 0
        elif strategy == "constant":
            value = op.params.get("value")
        elif strategy == "forward":
            before = df[col].isna().sum()
            df[col] = df[col].ffill()
            modified += before - df[col].isna().sum()
            continue
        elif strategy == "backward":
            before = df[col].isna().sum()
            df[col] = df[col].bfill()
            modified += before - df[col].isna().sum()
            continue
        else:
            value = None
        if value is not None:
            df.loc[null_mask, col] = value
            modified += int(null_mask.sum())
    return df, modified


def _trim_strings(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    cols = [c for c in (op.columns or df.select_dtypes(include="object").columns)]
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        original = df[col].astype(str)
        trimmed = original.str.strip()
        modified += int((original != trimmed).sum())
        df[col] = trimmed.where(df[col].notna(), None)
    return df, modified


def _standardize_case(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    mode = op.params.get("mode", "lower")
    cols = [c for c in (op.columns or df.select_dtypes(include="object").columns)]
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        s = df[col].astype(str)
        if mode == "lower":
            new = s.str.lower()
        elif mode == "upper":
            new = s.str.upper()
        elif mode == "title":
            new = s.str.title()
        else:
            continue
        modified += int((s != new).sum())
        df[col] = new.where(df[col].notna(), None)
    return df, modified


def _coerce_types(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    target = op.params.get("dtype", "numeric")
    modified = 0
    for col in (op.columns or []):
        if col not in df.columns:
            continue
        if target == "numeric":
            new = pd.to_numeric(df[col], errors="coerce")
        elif target == "datetime":
            new = pd.to_datetime(df[col], errors="coerce")
        elif target == "string":
            new = df[col].astype(str)
        elif target == "boolean":
            new = df[col].astype(str).str.lower().isin(["true", "1", "yes", "y"])
        else:
            continue
        modified += int((df[col].astype(str) != new.astype(str)).sum())
        df[col] = new
    return df, modified


def _remove_outliers(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    method = op.params.get("method", "iqr")
    cols = op.columns or df.select_dtypes(include=np.number).columns.tolist()
    mask = pd.Series(True, index=df.index)
    for col in cols:
        if col not in df.columns:
            continue
        s = df[col]
        if method == "iqr":
            q1, q3 = s.quantile(0.25), s.quantile(0.75)
            iqr = q3 - q1
            lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            mask &= s.between(lo, hi) | s.isna()
        elif method == "zscore":
            z = (s - s.mean()) / s.std(ddof=0)
            mask &= z.abs().le(op.params.get("threshold", 3.0)) | s.isna()
    before = len(df)
    cleaned = df[mask]
    return cleaned, before - len(cleaned)


def _drop_columns(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    cols = [c for c in (op.columns or []) if c in df.columns]
    cleaned = df.drop(columns=cols)
    return cleaned, len(cols) * len(df)


def _rename_columns(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    mapping = op.params.get("mapping", {})
    actual = {k: v for k, v in mapping.items() if k in df.columns}
    return df.rename(columns=actual), len(actual)


def _clip_values(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    lo = op.params.get("min")
    hi = op.params.get("max")
    modified = 0
    for col in (op.columns or df.select_dtypes(include=np.number).columns):
        if col not in df.columns:
            continue
        original = df[col]
        clipped = original.clip(lower=lo, upper=hi)
        modified += int((original != clipped).sum())
        df[col] = clipped
    return df, modified
