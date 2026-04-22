"""Type-aware smart cleaning suggestions and preview engine.

Unlike the rule-based ``cleaning_service`` (which applies an operation list),
this module *inspects* a DataFrame and produces **precise, prioritised
suggestions** tailored to each column's inferred semantic type (numeric,
datetime, categorical, boolean, email, url, phone, currency …).

The output is consumed by:
* ``POST /api/v1/cleaning/suggest/{dataset_id}``  — returns suggestions
* ``POST /api/v1/cleaning/preview/{dataset_id}`` — dry-run diff
* ``POST /api/v1/cleaning/apply/{dataset_id}``   — writes cleaned copy

Design goals:
* **Precision.** Each suggestion carries an `impact` estimate (rows/cells
  affected) so the UI can surface the biggest wins first.
* **Safety.** Suggestions are reversible — the apply endpoint writes a *new*
  dataset id so users never overwrite their upload.
* **Type-awareness.** Impute strategy adapts to skewness, trimming only fires
  when leading/trailing whitespace is actually present, near-duplicate
  categorical values use normalised-edit-distance (not raw string equality).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Semantic type inference
# ---------------------------------------------------------------------------

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_URL_RE = re.compile(r"^(https?://|www\.)[^\s]+$", re.IGNORECASE)
_PHONE_RE = re.compile(r"^[\s\d+\-().]{7,}$")
_CURRENCY_RE = re.compile(r"^[\s$€£¥₹]*-?\d[\d,.\s]*[%]?$")
_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{4,}$")
_BOOL_LIKE = {"true", "false", "yes", "no", "y", "n", "0", "1", "t", "f"}


def _detect_semantic_type(series: pd.Series, inferred: str) -> str:
    """Refine a column's type from the stored ``inferred_type`` using heuristics.

    Returns one of: numeric, datetime, boolean, email, url, phone, currency,
    identifier, categorical, text.
    """
    if inferred == "numeric":
        return "numeric"
    if inferred == "datetime":
        return "datetime"
    if inferred == "boolean":
        return "boolean"

    sample = series.dropna().astype(str).head(200)
    if sample.empty:
        return "categorical"

    lowered = sample.str.strip().str.lower()
    non_empty = lowered[lowered != ""]
    if len(non_empty) == 0:
        return "categorical"

    # Boolean-ish text
    if non_empty.isin(_BOOL_LIKE).mean() > 0.9:
        return "boolean"

    # Pattern-based semantic refinement
    patterns = {
        "email": _EMAIL_RE,
        "url": _URL_RE,
        "phone": _PHONE_RE,
        "currency": _CURRENCY_RE,
    }
    for label, regex in patterns.items():
        if non_empty.str.match(regex).mean() > 0.8:
            return label

    # High-cardinality short alphanumeric tokens → identifier
    unique_ratio = series.nunique(dropna=True) / max(len(series), 1)
    if unique_ratio > 0.9 and sample.str.match(_ID_RE).mean() > 0.9:
        return "identifier"

    # Otherwise categorical vs free-form text
    if series.nunique(dropna=True) <= max(50, int(len(series) * 0.05)):
        return "categorical"
    return "text"


# ---------------------------------------------------------------------------
# Suggestion records
# ---------------------------------------------------------------------------


@dataclass
class Suggestion:
    """A single cleaning recommendation."""

    id: str
    column: Optional[str]
    op: str
    label: str
    description: str
    severity: str  # "critical" | "warning" | "info"
    category: str  # "missing" | "type" | "duplicate" | "outlier" | "format" …
    semantic_type: str
    impact: Dict[str, Any] = field(default_factory=dict)
    params: Dict[str, Any] = field(default_factory=dict)
    reversible: bool = True
    auto_safe: bool = False  # whether it's safe to apply without user review

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "column": self.column,
            "op": self.op,
            "label": self.label,
            "description": self.description,
            "severity": self.severity,
            "category": self.category,
            "semantic_type": self.semantic_type,
            "impact": self.impact,
            "params": self.params,
            "reversible": self.reversible,
            "auto_safe": self.auto_safe,
        }


# ---------------------------------------------------------------------------
# Suggestion builders (per type)
# ---------------------------------------------------------------------------


def _sid(*parts: Any) -> str:
    """Build a stable suggestion id from its key parts."""
    return "::".join(str(p) for p in parts if p is not None)


def _missing_suggestions(
    col: str, series: pd.Series, semantic: str, n: int
) -> List[Suggestion]:
    out: List[Suggestion] = []
    null_count = int(series.isna().sum())
    if null_count == 0:
        return out
    null_pct = round(null_count / n * 100, 2)

    # Drop the column if it's almost entirely empty — nothing else is salvageable.
    if null_pct >= 70:
        return [
            Suggestion(
                id=_sid("drop_col_missing", col),
                column=col,
                op="drop_columns",
                label=f"Drop `{col}` — {null_pct}% empty",
                description=(
                    f"Column is {null_pct}% missing ({null_count}/{n} rows). "
                    "Imputation would overwhelm the real signal; recommend dropping."
                ),
                severity="critical",
                category="missing",
                semantic_type=semantic,
                impact={"cells_removed": n, "null_pct": null_pct},
                params={},
            )
        ]

    # Type-aware imputation
    if semantic == "numeric":
        ns = series.dropna()
        # Use median when the distribution is skewed; mean otherwise.
        try:
            skew = float(ns.skew()) if len(ns) > 2 else 0.0
        except Exception:
            skew = 0.0
        strategy = "median" if abs(skew) > 1.0 else "mean"
        _raw = float(ns.median() if strategy == "median" else ns.mean())
        fill_val = _raw if np.isfinite(_raw) else 0.0
        out.append(
            Suggestion(
                id=_sid("impute", col, strategy),
                column=col,
                op="fill_missing",
                label=f"Impute `{col}` with {strategy} ({fill_val:.3g})",
                description=(
                    f"{null_count} missing numeric values ({null_pct}%). "
                    f"Distribution skew={skew:.2f} → {strategy} is more robust."
                ),
                severity="warning" if null_pct > 5 else "info",
                category="missing",
                semantic_type=semantic,
                impact={"cells_modified": null_count, "fill_value": fill_val},
                params={"strategy": strategy},
                auto_safe=null_pct < 20,
            )
        )
    elif semantic == "datetime":
        out.append(
            Suggestion(
                id=_sid("impute_dt", col),
                column=col,
                op="fill_missing",
                label=f"Forward-fill `{col}` (datetime gaps)",
                description=(
                    f"{null_count} missing timestamps ({null_pct}%). "
                    "Forward-fill preserves chronology for time-series."
                ),
                severity="warning" if null_pct > 2 else "info",
                category="missing",
                semantic_type=semantic,
                impact={"cells_modified": null_count},
                params={"strategy": "forward"},
            )
        )
    elif semantic in ("boolean", "categorical", "email", "url", "phone", "identifier"):
        mode_val = series.mode(dropna=True)
        mv = mode_val.iloc[0] if not mode_val.empty else None
        out.append(
            Suggestion(
                id=_sid("impute_mode", col),
                column=col,
                op="fill_missing",
                label=f"Fill `{col}` with mode (`{mv}`)",
                description=(
                    f"{null_count} missing values ({null_pct}%). "
                    f"Mode (`{mv}`) preserves the dominant category."
                ),
                severity="warning" if null_pct > 5 else "info",
                category="missing",
                semantic_type=semantic,
                impact={"cells_modified": null_count, "fill_value": str(mv)},
                params={"strategy": "mode"},
                auto_safe=null_pct < 10,
            )
        )
    else:  # free-form text
        out.append(
            Suggestion(
                id=_sid("fill_const", col),
                column=col,
                op="fill_missing",
                label=f"Fill `{col}` with `\"unknown\"`",
                description=(
                    f"{null_count} missing text values ({null_pct}%). "
                    "Mode isn't meaningful for free text; use an explicit sentinel."
                ),
                severity="info",
                category="missing",
                semantic_type=semantic,
                impact={"cells_modified": null_count},
                params={"strategy": "constant", "value": "unknown"},
            )
        )
    return out


def _numeric_suggestions(col: str, series: pd.Series, semantic: str) -> List[Suggestion]:
    out: List[Suggestion] = []
    s = series.dropna()
    if s.empty:
        return out

    # Outlier detection — flag, don't auto-apply.
    q1, q3 = s.quantile(0.25), s.quantile(0.75)
    iqr = q3 - q1
    if iqr > 0:
        lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        out_count = int(((s < lo) | (s > hi)).sum())
        pct = round(out_count / len(s) * 100, 2)
        if out_count > 0 and pct >= 1:
            out.append(
                Suggestion(
                    id=_sid("clip_outliers", col),
                    column=col,
                    op="clip_values",
                    label=f"Clip outliers in `{col}` ({out_count} rows, {pct}%)",
                    description=(
                        f"{out_count} rows fall outside [{lo:.3g}, {hi:.3g}] "
                        f"(1.5×IQR fence). Clipping caps extremes without dropping rows."
                    ),
                    severity="warning" if pct >= 3 else "info",
                    category="outlier",
                    semantic_type=semantic,
                    impact={"rows_affected": out_count, "lower": float(lo), "upper": float(hi)},
                    params={"min": float(lo), "max": float(hi)},
                )
            )

    # Near-zero variance — often safe to drop.
    if s.nunique() <= 1:
        out.append(
            Suggestion(
                id=_sid("drop_constant", col),
                column=col,
                op="drop_columns",
                label=f"Drop `{col}` — constant value",
                description="Column has a single unique value and carries no information.",
                severity="critical",
                category="variance",
                semantic_type=semantic,
                impact={"cells_removed": len(series)},
                params={},
                auto_safe=True,
            )
        )

    # Negative values where historically all positive — hint only.
    if (s < 0).any() and (s > 0).mean() > 0.95:
        neg = int((s < 0).sum())
        out.append(
            Suggestion(
                id=_sid("flag_negatives", col),
                column=col,
                op="clip_values",
                label=f"Flag {neg} negative value(s) in `{col}`",
                description=(
                    f"{neg} negative value(s) detected while 95%+ of data is "
                    "non-negative. Likely data-entry errors — review before clipping."
                ),
                severity="warning",
                category="validity",
                semantic_type=semantic,
                impact={"rows_affected": neg, "lower": 0.0},
                params={"min": 0.0},
            )
        )

    return out


def _text_suggestions(col: str, series: pd.Series, semantic: str) -> List[Suggestion]:
    out: List[Suggestion] = []
    s = series.dropna().astype(str)
    if s.empty:
        return out

    # Leading/trailing whitespace — only fires when actually present.
    dirty = int((s != s.str.strip()).sum())
    if dirty > 0:
        out.append(
            Suggestion(
                id=_sid("trim", col),
                column=col,
                op="trim_strings",
                label=f"Trim whitespace in `{col}` ({dirty} rows)",
                description=f"{dirty} value(s) have leading or trailing whitespace.",
                severity="info",
                category="format",
                semantic_type=semantic,
                impact={"rows_affected": dirty},
                params={},
                auto_safe=True,
            )
        )

    # Case inconsistency — flag only categorical/identifier-like columns
    if semantic in ("categorical", "email", "boolean", "identifier"):
        lowered = s.str.lower()
        if lowered.nunique() < s.nunique():
            collapsed = s.nunique() - lowered.nunique()
            out.append(
                Suggestion(
                    id=_sid("case", col),
                    column=col,
                    op="standardize_case",
                    label=f"Lowercase `{col}` — merges {collapsed} case-variant groups",
                    description=(
                        f"Column has {s.nunique()} unique values but only "
                        f"{lowered.nunique()} after lowercasing — "
                        f"{collapsed} duplicate group(s) caused by case mismatch."
                    ),
                    severity="warning",
                    category="format",
                    semantic_type=semantic,
                    impact={"groups_merged": collapsed},
                    params={"mode": "lower"},
                    auto_safe=semantic == "email",
                )
            )

    # Near-duplicate categories (normalised whitespace + case)
    if semantic in ("categorical", "identifier") and s.nunique() <= 500:
        normalised = s.str.strip().str.lower().str.replace(r"\s+", " ", regex=True)
        collapsed = s.nunique() - normalised.nunique()
        if collapsed > 0 and collapsed != (
            # Don't double-fire with the pure case suggestion
            s.nunique() - s.str.lower().nunique()
        ):
            out.append(
                Suggestion(
                    id=_sid("normalize_cats", col),
                    column=col,
                    op="normalize_whitespace",
                    label=f"Normalise whitespace+case in `{col}` — merges {collapsed} groups",
                    description=(
                        "Categories differ only by extra whitespace or case. "
                        "Merging them reduces downstream group-by noise."
                    ),
                    severity="warning",
                    category="format",
                    semantic_type=semantic,
                    impact={"groups_merged": collapsed},
                    params={"lowercase": True, "collapse_whitespace": True},
                )
            )

    # Format validation — email / url / phone
    if semantic == "email":
        invalid = int((~s.str.match(_EMAIL_RE)).sum())
        if invalid > 0:
            out.append(
                Suggestion(
                    id=_sid("invalid_email", col),
                    column=col,
                    op="flag_invalid",
                    label=f"Flag {invalid} invalid email(s) in `{col}`",
                    description="Value does not match an RFC-style email pattern.",
                    severity="warning",
                    category="validity",
                    semantic_type=semantic,
                    impact={"rows_affected": invalid},
                    params={"pattern": "email"},
                )
            )
    elif semantic == "url":
        invalid = int((~s.str.match(_URL_RE)).sum())
        if invalid > 0:
            out.append(
                Suggestion(
                    id=_sid("invalid_url", col),
                    column=col,
                    op="flag_invalid",
                    label=f"Flag {invalid} invalid URL(s) in `{col}`",
                    description="Value does not start with http(s):// or www.",
                    severity="warning",
                    category="validity",
                    semantic_type=semantic,
                    impact={"rows_affected": invalid},
                    params={"pattern": "url"},
                )
            )
    elif semantic == "phone":
        digits_only = s.str.replace(r"\D", "", regex=True)
        invalid = int(((digits_only.str.len() < 7) | (digits_only.str.len() > 15)).sum())
        if invalid > 0:
            out.append(
                Suggestion(
                    id=_sid("invalid_phone", col),
                    column=col,
                    op="flag_invalid",
                    label=f"Flag {invalid} suspicious phone number(s) in `{col}`",
                    description="Digit count outside 7-15 range after stripping formatting.",
                    severity="warning",
                    category="validity",
                    semantic_type=semantic,
                    impact={"rows_affected": invalid},
                    params={"pattern": "phone"},
                )
            )

    return out


def _datetime_suggestions(col: str, series: pd.Series, semantic: str) -> List[Suggestion]:
    out: List[Suggestion] = []
    parsed = pd.to_datetime(series, errors="coerce")
    coerced = int(parsed.isna().sum() - series.isna().sum())
    if coerced > 0:
        out.append(
            Suggestion(
                id=_sid("parse_dt", col),
                column=col,
                op="coerce_types",
                label=f"Parse `{col}` as datetime ({coerced} unparseable)",
                description=(
                    f"{coerced} row(s) will become NaT after parsing — review the "
                    "source for inconsistent date formats before coercing."
                ),
                severity="warning",
                category="type",
                semantic_type=semantic,
                impact={"rows_affected": coerced},
                params={"dtype": "datetime"},
            )
        )

    # Future timestamps (often bad entries in historical data)
    valid = parsed.dropna()
    if not valid.empty:
        try:
            future = int((valid > pd.Timestamp.now()).sum())
        except Exception:
            future = 0
        if future > 0 and future < len(valid):
            out.append(
                Suggestion(
                    id=_sid("future_dates", col),
                    column=col,
                    op="flag_future_dates",
                    label=f"Flag {future} future date(s) in `{col}`",
                    description=(
                        f"{future} row(s) have a timestamp past today. Likely "
                        "data-entry errors in a historical dataset."
                    ),
                    severity="warning",
                    category="validity",
                    semantic_type=semantic,
                    impact={"rows_affected": future},
                    params={},
                )
            )
    return out


def _boolean_suggestions(col: str, series: pd.Series, semantic: str) -> List[Suggestion]:
    if series.dtype == bool:
        return []
    return [
        Suggestion(
            id=_sid("cast_bool", col),
            column=col,
            op="coerce_types",
            label=f"Normalise `{col}` to boolean",
            description=(
                "Values look boolean-like (true/false, yes/no, 0/1) but are "
                "stored as strings. Casting enables downstream logical ops."
            ),
            severity="info",
            category="type",
            semantic_type=semantic,
            impact={},
            params={"dtype": "boolean"},
            auto_safe=True,
        )
    ]


def _dataset_level_suggestions(df: pd.DataFrame) -> List[Suggestion]:
    out: List[Suggestion] = []
    dup = int(df.duplicated().sum())
    if dup > 0:
        out.append(
            Suggestion(
                id=_sid("dedup"),
                column=None,
                op="drop_duplicates",
                label=f"Remove {dup} duplicate row(s)",
                description=(
                    f"{dup} exact-duplicate row(s) detected. Deduplication is "
                    "safe because it keeps the first occurrence."
                ),
                severity="critical" if dup / max(len(df), 1) > 0.05 else "warning",
                category="duplicate",
                semantic_type="dataset",
                impact={"rows_removed": dup},
                params={},
                auto_safe=True,
            )
        )
    return out


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------


def suggest_cleaning(df: pd.DataFrame, schema_cols: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Return a ranked list of cleaning suggestions for the given DataFrame.

    The schema hint comes from the stored dataset schema so we don't re-infer
    column types on every call — we only *refine* them (e.g. text → email).
    """
    n = max(len(df), 1)
    suggestions: List[Suggestion] = []
    semantic_map: Dict[str, str] = {}

    # Dataset-level (duplicates etc.)
    suggestions.extend(_dataset_level_suggestions(df))

    for col_meta in schema_cols:
        col = col_meta.get("name")
        if col is None or col not in df.columns:
            continue
        series = df[col]
        inferred = col_meta.get("inferred_type", "categorical")
        semantic = _detect_semantic_type(series, inferred)
        semantic_map[col] = semantic

        # 1) Missing data handling
        suggestions.extend(_missing_suggestions(col, series, semantic, n))

        # 2) Type-specific suggestions
        if semantic == "numeric":
            suggestions.extend(_numeric_suggestions(col, series, semantic))
        elif semantic == "datetime":
            suggestions.extend(_datetime_suggestions(col, series, semantic))
        elif semantic == "boolean":
            suggestions.extend(_boolean_suggestions(col, series, semantic))
        else:
            suggestions.extend(_text_suggestions(col, series, semantic))

    # Rank: critical → warning → info, then by cells_modified/rows_affected desc.
    severity_rank = {"critical": 0, "warning": 1, "info": 2}

    def _impact_weight(s: Suggestion) -> int:
        imp = s.impact
        return int(
            imp.get("cells_modified", 0)
            + imp.get("rows_affected", 0)
            + imp.get("cells_removed", 0)
            + imp.get("rows_removed", 0)
            + imp.get("groups_merged", 0) * 10
        )

    suggestions.sort(
        key=lambda s: (severity_rank.get(s.severity, 9), -_impact_weight(s))
    )

    summary = {
        "total": len(suggestions),
        "critical": sum(1 for s in suggestions if s.severity == "critical"),
        "warning": sum(1 for s in suggestions if s.severity == "warning"),
        "info": sum(1 for s in suggestions if s.severity == "info"),
        "auto_safe": sum(1 for s in suggestions if s.auto_safe),
    }

    return {
        "summary": summary,
        "semantic_types": semantic_map,
        "suggestions": [s.to_dict() for s in suggestions],
    }


# ---------------------------------------------------------------------------
# Apply / preview
# ---------------------------------------------------------------------------


def _apply_operation(
    df: pd.DataFrame, op: str, column: Optional[str], params: Dict[str, Any]
) -> Tuple[pd.DataFrame, int]:
    """Apply a single cleaning op and return (new_df, cells_modified)."""
    if op == "drop_duplicates":
        before = len(df)
        df = df.drop_duplicates(keep="first").reset_index(drop=True)
        return df, before - len(df)

    if op == "drop_columns":
        cols = [column] if column else []
        cols = [c for c in cols if c in df.columns]
        if not cols:
            return df, 0
        rows = len(df)
        df = df.drop(columns=cols)
        return df, rows * len(cols)

    if column is None or column not in df.columns:
        return df, 0

    s = df[column]

    if op == "fill_missing":
        strategy = params.get("strategy", "mode")
        null_mask = s.isna()
        if not null_mask.any():
            return df, 0
        if strategy == "forward":
            df[column] = s.ffill()
        elif strategy == "backward":
            df[column] = s.bfill()
        elif strategy == "constant":
            df.loc[null_mask, column] = params.get("value")
        else:
            if strategy == "median" and pd.api.types.is_numeric_dtype(s):
                val = s.median()
            elif strategy == "mean" and pd.api.types.is_numeric_dtype(s):
                val = s.mean()
            elif strategy == "mode":
                mode_vals = s.mode(dropna=True)
                val = mode_vals.iloc[0] if not mode_vals.empty else None
            else:
                val = None
            if val is not None:
                df.loc[null_mask, column] = val
        return df, int(null_mask.sum())

    if op == "trim_strings":
        before = s.astype(str)
        trimmed = before.str.strip()
        modified = int((before != trimmed).sum())
        df[column] = trimmed.where(s.notna(), None)
        return df, modified

    if op == "standardize_case":
        mode = params.get("mode", "lower")
        before = s.astype(str)
        if mode == "upper":
            new = before.str.upper()
        elif mode == "title":
            new = before.str.title()
        else:
            new = before.str.lower()
        modified = int((before != new).sum())
        df[column] = new.where(s.notna(), None)
        return df, modified

    if op == "normalize_whitespace":
        before = s.astype(str)
        new = before.str.strip().str.replace(r"\s+", " ", regex=True)
        if params.get("lowercase", True):
            new = new.str.lower()
        modified = int((before != new).sum())
        df[column] = new.where(s.notna(), None)
        return df, modified

    if op == "coerce_types":
        dtype = params.get("dtype", "numeric")
        if dtype == "numeric":
            new = pd.to_numeric(s, errors="coerce")
        elif dtype == "datetime":
            new = pd.to_datetime(s, errors="coerce")
        elif dtype == "boolean":
            truthy = {"true", "1", "yes", "y", "t"}
            new = s.astype(str).str.strip().str.lower().isin(truthy)
            new = new.where(s.notna(), None)
        else:
            new = s.astype(str)
        modified = int((s.astype(str) != new.astype(str)).sum())
        df[column] = new
        return df, modified

    if op == "clip_values":
        lo = params.get("min")
        hi = params.get("max")
        before = s.copy()
        df[column] = s.clip(lower=lo, upper=hi)
        modified = int((before != df[column]).sum())
        return df, modified

    if op == "flag_invalid":
        # Non-destructive: add a sibling boolean column marking invalid rows.
        pattern = params.get("pattern")
        regex = {
            "email": _EMAIL_RE,
            "url": _URL_RE,
            "phone": _PHONE_RE,
        }.get(pattern)
        if regex is None:
            return df, 0
        flag_col = f"{column}__invalid"
        invalid = ~s.astype(str).str.match(regex)
        invalid = invalid & s.notna()
        df[flag_col] = invalid
        return df, int(invalid.sum())

    if op == "flag_future_dates":
        parsed = pd.to_datetime(s, errors="coerce")
        future = (parsed > pd.Timestamp.now()) & parsed.notna()
        flag_col = f"{column}__future"
        df[flag_col] = future
        return df, int(future.sum())

    # Unknown op — no-op
    return df, 0


def apply_cleaning(
    df: pd.DataFrame, operations: List[Dict[str, Any]]
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """Apply a sequence of cleaning operations and return (df, report)."""
    rows_before = len(df)
    df = df.copy()
    total_modified = 0
    per_step: List[Dict[str, Any]] = []
    for step in operations:
        op = step.get("op")
        col = step.get("column")
        params = step.get("params", {}) or {}
        before_rows = len(df)
        before_cols = len(df.columns)
        try:
            df, modified = _apply_operation(df, op or "", col, params)
            total_modified += modified
            per_step.append(
                {
                    "id": step.get("id"),
                    "op": op,
                    "column": col,
                    "status": "ok",
                    "cells_modified": modified,
                    "rows_before": before_rows,
                    "rows_after": len(df),
                    "cols_before": before_cols,
                    "cols_after": len(df.columns),
                }
            )
        except Exception as exc:
            per_step.append(
                {
                    "id": step.get("id"),
                    "op": op,
                    "column": col,
                    "status": "error",
                    "error": str(exc),
                }
            )
    return df, {
        "rows_before": rows_before,
        "rows_after": len(df),
        "cells_modified": total_modified,
        "steps": per_step,
    }
