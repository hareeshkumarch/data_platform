from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import re

import numpy as np
import pandas as pd

from backend.utils.data_utils import (
    EMAIL_RE as _EMAIL_PATTERN,
    URL_RE as _URL_PATTERN,
    PHONE_RE as _PHONE_PATTERN,
    CURRENCY_STRIP_RE as _CURRENCY_STRIP,
    HTML_TAGS_RE as _HTML_TAGS,
    MULTI_SPACE_RE as _MULTI_SPACE,
    cleaning_fill_missing,
    cleaning_trim_strings,
    cleaning_standardize_case,
    cleaning_normalize_whitespace,
    cleaning_coerce_types,
    cleaning_clip_values,
)


@dataclass
class CleaningOp:
    op: str
    columns: Optional[List[str]] = None
    params: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CleaningReport:
    rows_before: int
    rows_after: int
    cells_modified: int
    steps: List[Dict[str, Any]]


def clean_dataframe(
    df: pd.DataFrame, operations: List[CleaningOp]
) -> tuple[pd.DataFrame, CleaningReport]:
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
        "regex_replace": _regex_replace,
        "validate_emails": _validate_emails,
        "validate_urls": _validate_urls,
        "validate_phones": _validate_phones,
        "normalize_currency": _normalize_currency,
        "standardize_dates": _standardize_dates,
        "deduplicate_fuzzy": _deduplicate_fuzzy,
        "encode_categoricals": _encode_categoricals,
        "remove_html_tags": _remove_html_tags,
        "extract_numbers": _extract_numbers,
        "normalize_whitespace": _normalize_whitespace,
        "round_numbers": _round_numbers,
        "bin_numeric": _bin_numeric,
        "log_transform": _log_transform,
    }

    for op in operations:
        handler = handlers.get(op.op)
        if handler is None:
            steps.append({"op": op.op, "status": "skipped", "reason": "unknown op"})
            continue
        try:
            df, modified = handler(df, op)
            total_modified += modified
            steps.append(
                {
                    "op": op.op,
                    "columns": op.columns or "all",
                    "modified": modified,
                    "status": "ok",
                }
            )
        except Exception as exc:
            steps.append(
                {
                    "op": op.op,
                    "columns": op.columns,
                    "status": "error",
                    "error": str(exc),
                }
            )

    return df, CleaningReport(
        rows_before=rows_before,
        rows_after=len(df),
        cells_modified=total_modified,
        steps=steps,
    )


def _drop_duplicates(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    before = len(df)
    cleaned = df.drop_duplicates(subset=op.columns or None, keep="first")
    return cleaned, before - len(cleaned)


def _drop_nulls(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    before = len(df)
    cleaned = df.dropna(subset=op.columns or None)
    return cleaned, before - len(cleaned)


def _fill_missing(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    cols = op.columns or df.columns.tolist()
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        modified += cleaning_fill_missing(
            df, col, op.params.get("strategy", "mean"), op.params.get("value")
        )
    return df, modified


def _trim_strings(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    cols = [c for c in (op.columns or df.select_dtypes(include="object").columns)]
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        modified += cleaning_trim_strings(df, col)
    return df, modified


def _standardize_case(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    cols = [c for c in (op.columns or df.select_dtypes(include="object").columns)]
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        modified += cleaning_standardize_case(df, col, op.params.get("mode", "lower"))
    return df, modified


def _coerce_types(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    modified = 0
    for col in op.columns or []:
        if col not in df.columns:
            continue
        modified += cleaning_coerce_types(df, col, op.params.get("dtype", "numeric"))
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
    modified = 0
    for col in op.columns or df.select_dtypes(include=np.number).columns:
        if col not in df.columns:
            continue
        modified += cleaning_clip_values(
            df, col, op.params.get("min"), op.params.get("max")
        )
    return df, modified


def _regex_replace(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    pattern = op.params.get("pattern", "")
    replacement = op.params.get("replacement", "")
    if not pattern:
        return df, 0
    cols = op.columns or df.select_dtypes(include="object").columns.tolist()
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        original = df[col].astype(str)
        replaced = original.str.replace(pattern, replacement, regex=True)
        modified += int((original != replaced).sum())
        df[col] = replaced.where(df[col].notna(), None)
    return df, modified


def _validate_emails(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    action = op.params.get("action", "flag")
    cols = op.columns or [
        c
        for c in df.select_dtypes("object").columns
        if "email" in c.lower() or "mail" in c.lower()
    ]
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        mask = df[col].notna() & ~df[col].astype(str).str.strip().str.match(
            _EMAIL_PATTERN
        )
        count = int(mask.sum())
        if count == 0:
            continue
        if action == "nullify":
            df.loc[mask, col] = None
        elif action == "drop":
            df = df[~mask].reset_index(drop=True)
        modified += count
    return df, modified


def _validate_urls(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    action = op.params.get("action", "nullify")
    cols = op.columns or [
        c
        for c in df.select_dtypes("object").columns
        if "url" in c.lower() or "link" in c.lower() or "website" in c.lower()
    ]
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        mask = df[col].notna() & ~df[col].astype(str).str.strip().str.match(
            _URL_PATTERN
        )
        count = int(mask.sum())
        if count == 0:
            continue
        if action == "nullify":
            df.loc[mask, col] = None
        elif action == "drop":
            df = df[~mask].reset_index(drop=True)
        modified += count
    return df, modified


def _validate_phones(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    action = op.params.get("action", "nullify")
    cols = op.columns or [
        c
        for c in df.select_dtypes("object").columns
        if "phone" in c.lower() or "tel" in c.lower() or "mobile" in c.lower()
    ]
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        stripped = df[col].astype(str).str.strip()
        mask = df[col].notna() & ~stripped.str.match(_PHONE_PATTERN)
        count = int(mask.sum())
        if count == 0:
            continue
        if action == "nullify":
            df.loc[mask, col] = None
        elif action == "normalize":
            df[col] = stripped.str.replace(r"[^\d+]", "", regex=True).where(
                df[col].notna(), None
            )
            modified += int(df[col].notna().sum())
            continue
        modified += count
    return df, modified


def _normalize_currency(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    cols = op.columns or [
        c
        for c in df.columns
        if any(
            k in c.lower()
            for k in ("price", "cost", "amount", "revenue", "salary", "fee")
        )
    ]
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        if pd.api.types.is_numeric_dtype(df[col]):
            continue
        original = df[col].astype(str)
        cleaned = original.apply(
            lambda x: _CURRENCY_STRIP.sub("", x) if x != "nan" else x
        )
        numeric = pd.to_numeric(cleaned, errors="coerce")
        changed = int((df[col].astype(str) != numeric.astype(str)).sum())
        df[col] = numeric
        modified += changed
    return df, modified


def _standardize_dates(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    fmt = op.params.get("format", "%Y-%m-%d")
    cols = op.columns or [
        c
        for c in df.columns
        if "date" in c.lower() or "time" in c.lower() or "ts" in c.lower()
    ]
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        original = df[col].astype(str)
        parsed = pd.to_datetime(df[col], errors="coerce", infer_datetime_format=True)
        formatted = parsed.dt.strftime(fmt).where(parsed.notna(), None)
        modified += int((original != formatted.astype(str)).sum())
        df[col] = formatted
    return df, modified


def _deduplicate_fuzzy(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    cols = op.columns or df.select_dtypes(include="object").columns.tolist()
    modified = 0
    for col in cols[:5]:
        if col not in df.columns:
            continue
        s = df[col].dropna().astype(str).str.strip().str.lower()
        unique_vals = s.unique()
        if len(unique_vals) < 2 or len(unique_vals) > 500:
            continue
        mapping = {}
        for val in sorted(unique_vals, key=len, reverse=True):
            if val in mapping:
                continue
            for other in unique_vals:
                if other == val or other in mapping:
                    continue
                if _normalized_edit_similarity(val, other) > 0.85:
                    mapping[other] = val
        if mapping:
            original = df[col].astype(str).str.strip().str.lower()
            df[col] = original.replace(mapping).where(df[col].notna(), None)
            modified += sum(1 for v in original if v in mapping)
    return df, modified


def _normalized_edit_similarity(a: str, b: str) -> float:
    if a == b:
        return 1.0
    max_len = max(len(a), len(b))
    if max_len == 0:
        return 1.0
    if abs(len(a) - len(b)) > max_len * 0.3:
        return 0.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        curr = [i + 1]
        for j, cb in enumerate(b):
            curr.append(
                min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (0 if ca == cb else 1))
            )
        prev = curr
    return 1.0 - prev[-1] / max_len


def _encode_categoricals(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    method = op.params.get("method", "label")
    cols = (
        op.columns or df.select_dtypes(include=["object", "category"]).columns.tolist()
    )
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        if method == "label":
            codes, uniques = pd.factorize(df[col])
            df[col] = codes
            modified += len(df)
        elif method == "onehot":
            dummies = pd.get_dummies(df[col], prefix=col, drop_first=True)
            df = pd.concat([df.drop(columns=[col]), dummies], axis=1)
            modified += len(df) * len(dummies.columns)
    return df, modified


def _remove_html_tags(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    cols = op.columns or df.select_dtypes(include="object").columns.tolist()
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        original = df[col].astype(str)
        cleaned = original.str.replace(_HTML_TAGS, "", regex=True)
        modified += int((original != cleaned).sum())
        df[col] = cleaned.where(df[col].notna(), None)
    return df, modified


def _extract_numbers(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    cols = op.columns or []
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        extracted = df[col].astype(str).str.extract(r"([\d.]+)", expand=False)
        numeric = pd.to_numeric(extracted, errors="coerce")
        modified += int(numeric.notna().sum())
        df[col] = numeric
    return df, modified


def _normalize_whitespace(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    cols = op.columns or df.select_dtypes(include="object").columns.tolist()
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        modified += cleaning_normalize_whitespace(
            df, col, op.params.get("lowercase", True)
        )
    return df, modified


def _round_numbers(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    decimals = op.params.get("decimals", 2)
    cols = op.columns or df.select_dtypes(include=np.number).columns.tolist()
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        original = df[col]
        rounded = original.round(decimals)
        modified += int((original != rounded).sum())
        df[col] = rounded
    return df, modified


def _bin_numeric(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    bins = op.params.get("bins", 5)
    labels = op.params.get("labels")
    cols = op.columns or []
    modified = 0
    for col in cols:
        if col not in df.columns or not pd.api.types.is_numeric_dtype(df[col]):
            continue
        if labels and len(labels) == bins:
            df[col] = pd.cut(
                df[col], bins=bins, labels=labels, include_lowest=True
            ).astype(str)
        else:
            df[col] = pd.cut(df[col], bins=bins, include_lowest=True).astype(str)
        modified += len(df)
    return df, modified


def _log_transform(df: pd.DataFrame, op: CleaningOp) -> tuple[pd.DataFrame, int]:
    base = op.params.get("base", "natural")
    cols = op.columns or df.select_dtypes(include=np.number).columns.tolist()
    modified = 0
    for col in cols:
        if col not in df.columns:
            continue
        s = df[col]
        positive = s[s > 0]
        if positive.empty:
            continue
        if base == "log2":
            df[col] = np.where(s > 0, np.log2(s), np.nan)
        elif base == "log10":
            df[col] = np.where(s > 0, np.log10(s), np.nan)
        else:
            df[col] = np.where(s > 0, np.log(s), np.nan)
        modified += int((s > 0).sum())
    return df, modified
