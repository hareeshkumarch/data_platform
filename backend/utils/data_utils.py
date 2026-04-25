from __future__ import annotations
import hashlib
import io
import re
from typing import Any, Dict, List, Tuple

import numpy as np
import pandas as pd
from scipy import stats

from backend.config import settings

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
URL_RE = re.compile(r"^(https?://|www\.)[^\s]+$", re.IGNORECASE)
PHONE_RE = re.compile(r"^[\s\d+\-().]{7,}$")
CURRENCY_RE = re.compile(r"^[\s$€£¥₹]*-?\d[\d,.\s]*[%]?$")
CURRENCY_STRIP_RE = re.compile(r"[^\d.\-]")
HTML_TAGS_RE = re.compile(r"<[^>]+>")
MULTI_SPACE_RE = re.compile(r"\s{2,}")


def _corr_strength(r: float) -> str:
    a = abs(r)
    if a >= 0.8:
        return "very_strong"
    if a >= 0.6:
        return "strong"
    if a >= 0.4:
        return "moderate"
    if a >= 0.2:
        return "weak"
    return "negligible"


def _entropy(vc: pd.Series) -> float:
    probs = vc / vc.sum()
    return float(-(probs * np.log2(probs + 1e-10)).sum())


def _mape(actual: np.ndarray, predicted: np.ndarray) -> float:
    try:
        mask = actual != 0
        if not mask.any():
            return 0.0
        return float(
            np.mean(np.abs((actual[mask] - predicted[mask]) / actual[mask])) * 100
        )
    except Exception:
        return 0.0


def _growth_rate(df: pd.DataFrame, date_col: str, value_col: str) -> Optional[float]:
    try:
        ts = df[[date_col, value_col]].copy()
        ts[date_col] = pd.to_datetime(ts[date_col], errors="coerce")
        ts = ts.dropna().sort_values(date_col)
        if len(ts) < 2:
            return None
        mid = len(ts) // 2
        first_half = ts.iloc[:mid][value_col].sum()
        second_half = ts.iloc[mid:][value_col].sum()
        if first_half == 0:
            return None
        return round((second_half - first_half) / abs(first_half) * 100, 2)
    except Exception:
        return None


def parse_csv(content: bytes) -> pd.DataFrame:
    for enc in ["utf-8", "latin-1", "utf-16"]:
        try:
            return pd.read_csv(io.BytesIO(content), encoding=enc)
        except UnicodeDecodeError:
            continue
    raise ValueError("Cannot decode CSV.")


def parse_json(content: bytes) -> pd.DataFrame:
    import json

    data = json.loads(content.decode("utf-8"))
    if isinstance(data, list):
        return pd.DataFrame(data)
    if isinstance(data, dict):
        for v in data.values():
            if isinstance(v, list):
                return pd.DataFrame(v)
        return pd.DataFrame([data])
    raise ValueError("Unsupported JSON structure.")


def infer_column_type(series: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"
    if pd.api.types.is_numeric_dtype(series):
        return "numeric"
    if series.dtype == object:
        sample = series.dropna().head(50)
        try:
            pd.to_datetime(sample)
            return "datetime"
        except Exception:
            pass
        if sample.astype(str).str.len().mean() > 40:
            return "text"
        return "categorical"
    return "categorical"


def get_cardinality(series: pd.Series) -> str:
    u = series.nunique()
    ratio = u / max(len(series), 1)
    if u <= 10:
        return "low"
    if ratio > 0.8:
        return "high"
    return "medium"


def infer_schema(df: pd.DataFrame) -> List[Dict[str, Any]]:
    cols = []
    for col in df.columns:
        s = df[col]
        ct = infer_column_type(s)
        null_count = int(s.isna().sum())
        meta: Dict[str, Any] = {
            "name": col,
            "dtype": str(s.dtype),
            "inferred_type": ct,
            "null_count": null_count,
            "null_pct": round(null_count / max(len(s), 1) * 100, 2),
            "unique_count": int(s.nunique()),
            "cardinality": get_cardinality(s),
            "sample_values": s.dropna().head(5).tolist(),
            "min_val": None,
            "max_val": None,
            "mean_val": None,
            "std_val": None,
        }
        if ct == "numeric":
            meta["min_val"] = _safe(s.min())
            meta["max_val"] = _safe(s.max())
            meta["mean_val"] = _safe(s.mean())
            meta["std_val"] = _safe(s.std())
        elif ct == "datetime":
            dt = pd.to_datetime(s, errors="coerce")
            meta["min_val"] = str(dt.min()) if not dt.isna().all() else None
            meta["max_val"] = str(dt.max()) if not dt.isna().all() else None
        cols.append(meta)
    return cols


def compute_quality_score(df: pd.DataFrame) -> float:
    if df.empty:
        return 0.0
    total = df.shape[0] * df.shape[1]
    completeness = (1 - df.isna().sum().sum() / total) * 40
    uniqueness = (1 - df.duplicated().sum() / df.shape[0]) * 30
    mixed = sum(
        1
        for c in df.select_dtypes("object").columns
        if df[c].dropna().apply(type).nunique() > 1
    )
    consistency = (1 - mixed / max(df.shape[1], 1)) * 30
    return round(completeness + uniqueness + consistency, 2)


def smart_sample(df: pd.DataFrame) -> pd.DataFrame:
    if len(df) <= settings.SAMPLE_THRESHOLD:
        return df
    cat_cols = [
        c
        for c in df.select_dtypes(["object", "category"]).columns
        if df[c].nunique() <= settings.MAX_CARDINALITY
    ]
    if cat_cols:
        try:
            return (
                df.groupby(cat_cols[0], group_keys=False)
                .apply(
                    lambda g: g.sample(
                        min(
                            len(g), max(1, int(settings.SAMPLE_SIZE * len(g) / len(df)))
                        ),
                        random_state=42,
                    )
                )
                .reset_index(drop=True)
            )
        except Exception:
            pass
    return df.sample(n=settings.SAMPLE_SIZE, random_state=42).reset_index(drop=True)


def compute_distribution(s: pd.Series) -> Dict[str, Any]:
    s = s.dropna()
    if s.empty:
        return {}
    try:
        sk, ku = float(stats.skew(s)), float(stats.kurtosis(s))
    except Exception:
        sk, ku = 0.0, 0.0
    counts, edges = np.histogram(s, bins=min(20, s.nunique()))
    return {
        "skewness": round(sk, 4),
        "kurtosis": round(ku, 4),
        "histogram": {
            "counts": counts.tolist(),
            "edges": [round(e, 4) for e in edges.tolist()],
        },
        "p5": float(s.quantile(0.05)),
        "p25": float(s.quantile(0.25)),
        "p50": float(s.quantile(0.50)),
        "p75": float(s.quantile(0.75)),
        "p95": float(s.quantile(0.95)),
    }


def compute_summary_stats(df: pd.DataFrame) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    num = df.select_dtypes("number")
    if not num.empty:
        result["numeric"] = _convert(
            num.describe(percentiles=[0.25, 0.5, 0.75, 0.9]).to_dict()
        )
    cat = df.select_dtypes(["object", "category"])
    if not cat.empty:
        result["categorical"] = {
            c: {
                "top_values": _convert(df[c].value_counts().head(10).to_dict()),
                "unique_count": int(df[c].nunique()),
                "null_pct": round(df[c].isna().mean() * 100, 2),
            }
            for c in cat.columns
        }
    return result


def compute_correlation(df: pd.DataFrame) -> Dict[str, Any]:
    num = df.select_dtypes("number")
    if len(df) < settings.CORRELATION_MIN_ROWS or num.shape[1] < 2:
        return {}
    return _convert(num.corr(method="pearson").to_dict())


def detect_anomalies_zscore(
    series: pd.Series, threshold: float = 3.0
) -> Tuple[List[int], float]:
    z = np.abs(stats.zscore(series.dropna()))
    return series.dropna().index[z > threshold].tolist(), threshold


def detect_anomalies_iqr(series: pd.Series) -> Tuple[List[int], float]:
    q1, q3 = series.quantile(0.25), series.quantile(0.75)
    iqr = q3 - q1
    mask = (series < q1 - 1.5 * iqr) | (series > q3 + 1.5 * iqr)
    return series.index[mask].tolist(), 1.5


def time_series_decompose(
    df: pd.DataFrame, time_col: str, value_col: str, period: int = 7
) -> Dict[str, Any]:
    ts = df[[time_col, value_col]].copy()
    ts[time_col] = pd.to_datetime(ts[time_col], errors="coerce")
    ts = ts.dropna().sort_values(time_col).set_index(time_col)[value_col]
    if len(ts) < period * 2:
        return {"error": "Insufficient data"}
    trend = ts.rolling(window=period, center=True).mean()
    detrended = ts - trend
    seasonal = detrended.groupby(np.arange(len(detrended)) % period).transform("mean")
    residual = ts - trend - seasonal
    return {
        "dates": ts.index.astype(str).tolist(),
        "observed": _safe_list(ts),
        "trend": _safe_list(trend),
        "seasonal": _safe_list(seasonal),
        "residual": _safe_list(residual),
    }


def compute_moving_averages(
    df: pd.DataFrame, time_col: str, value_col: str
) -> Dict[str, Any]:
    ts = df[[time_col, value_col]].copy()
    ts[time_col] = pd.to_datetime(ts[time_col], errors="coerce")
    ts = ts.dropna().sort_values(time_col).set_index(time_col)
    result: Dict[str, Any] = {
        "dates": ts.index.astype(str).tolist(),
        "raw": _safe_list(ts[value_col]),
    }
    for w in [7, 14, 30]:
        if len(ts) >= w:
            result[f"sma_{w}"] = _safe_list(ts[value_col].rolling(w).mean())
            result[f"ewma_{w}"] = _safe_list(ts[value_col].ewm(span=w).mean())
    return result


def naive_forecast(series: pd.Series, steps: int = 14) -> Dict[str, Any]:
    if len(series) < 5:
        return {"method": "none", "predictions": []}

    recent_trend = series.tail(7).diff().mean()
    if pd.isna(recent_trend):
        recent_trend = 0

    last_val = float(series.iloc[-1])
    std_dev = float(series.std() if len(series) > 5 else last_val * 0.1)
    if pd.isna(std_dev):
        std_dev = last_val * 0.1

    forecast = []
    for i in range(1, steps + 1):
        predicted_val = last_val + (recent_trend * i)
        bound = std_dev * (1 + 0.6 * i)
        forecast.append(
            {
                "step": i,
                "prediction": _safe(predicted_val),
                "lower_bound": _safe(max(0, predicted_val - bound)),
                "upper_bound": _safe(predicted_val + bound),
            }
        )

    return {
        "method": "trend_projected",
        "steps": steps,
        "predictions": forecast,
        "confidence_level": 0.85,
    }


def contribution_analysis(
    df: pd.DataFrame, dim_col: str, metric_col: str
) -> List[Dict[str, Any]]:
    g = df.groupby(dim_col)[metric_col].sum().reset_index()
    total = g[metric_col].sum()
    g["pct"] = (g[metric_col] / (total if total != 0 else 1) * 100).round(2)
    return _convert(g.sort_values("pct", ascending=False).head(20).to_dict("records"))


def df_fingerprint(df: pd.DataFrame) -> str:
    key = str(list(df.columns)) + str(df.shape)
    return hashlib.sha256(key.encode()).hexdigest()


def sanitize_rows(records: list) -> list:
    result = []
    for row in records:
        clean = {}
        for k, v in row.items():
            clean[k] = _sanitize_value(v)
        result.append(clean)
    return result


def _sanitize_value(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return None if (np.isnan(v) or np.isinf(v)) else float(v)
    if isinstance(v, np.bool_):
        return bool(v)
    if isinstance(v, (np.ndarray,)):
        return [_sanitize_value(x) for x in v.tolist()]
    if isinstance(v, (np.datetime64, np.timedelta64)):
        return str(v)
    if isinstance(v, np.dtype):
        return str(v)
    if hasattr(np, "dtypes") and isinstance(v, type) and issubclass(type(v), type):
        return str(v)
    if isinstance(v, pd.Timestamp):
        return v.isoformat() if not pd.isna(v) else None
    if isinstance(v, pd.Timedelta):
        return str(v)
    type_name = type(v).__module__
    if type_name.startswith("numpy.dtypes") or type_name.startswith("numpy"):
        try:
            if not isinstance(v, (int, float, str, bool, list, dict)):
                return str(v)
        except Exception:
            return str(v)
    try:
        if pd.isna(v):
            return None
    except Exception:
        pass
    return v


def _safe(v: Any) -> Any:
    if v is None:
        return None
    try:
        if np.isnan(v) or np.isinf(v):
            return None
    except Exception:
        pass
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    if isinstance(v, float):
        import math

        try:
            if math.isnan(v) or math.isinf(v):
                return None
        except Exception:
            pass
    return v


def _safe_list(series_or_list) -> List[Any]:
    if isinstance(series_or_list, pd.Series):
        return [_safe(v) for v in series_or_list.tolist()]
    return [_safe(v) for v in series_or_list]


def _to_list(series: pd.Series) -> List[Any]:
    return _safe_list(series)


def _convert(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _convert(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return None if (np.isnan(obj) or np.isinf(obj)) else float(obj)
    if isinstance(obj, np.ndarray):
        return _convert(obj.tolist())
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, (np.datetime64, np.timedelta64)):
        return str(obj)
    if isinstance(obj, np.dtype):
        return str(obj)
    if isinstance(obj, pd.Timestamp):
        return obj.isoformat() if not pd.isna(obj) else None
    if isinstance(obj, pd.Timedelta):
        return str(obj)
    type_mod = getattr(type(obj), "__module__", "")
    if type_mod.startswith("numpy") and not isinstance(obj, (int, float, str, bool)):
        return str(obj)
    return obj


_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{4,}$")
_BOOL_LIKE = {"true", "false", "yes", "no", "y", "n", "0", "1", "t", "f"}


def get_semantic_type(series: pd.Series, inferred: str) -> str:
    if inferred in ("numeric", "datetime", "boolean"):
        return inferred
    sample = series.dropna().astype(str).head(200)
    if sample.empty:
        return "categorical"
    lowered = sample.str.strip().str.lower()
    non_empty = lowered[lowered != ""]
    if len(non_empty) == 0:
        return "categorical"
    if non_empty.isin(_BOOL_LIKE).mean() > 0.9:
        return "boolean"
    patterns = {
        "email": EMAIL_RE,
        "url": URL_RE,
        "phone": PHONE_RE,
        "currency": CURRENCY_RE,
    }
    for label, regex in patterns.items():
        if non_empty.str.match(regex).mean() > 0.8:
            return label
    ratio = series.nunique(dropna=True) / max(len(series), 1)
    if ratio > 0.9 and sample.str.match(_ID_RE).mean() > 0.9:
        return "identifier"
    if series.nunique(dropna=True) <= max(50, int(len(series) * 0.05)):
        return "categorical"
    return "text"


def cleaning_fill_missing(
    df: pd.DataFrame, column: str, strategy: str, value: Any = None
) -> int:
    s = df[column]
    null_mask = s.isna()
    if not null_mask.any():
        return 0
    if strategy == "forward":
        df[column] = s.ffill()
    elif strategy == "backward":
        df[column] = s.bfill()
    elif strategy == "constant":
        df.loc[null_mask, column] = value
    elif strategy == "zero":
        df.loc[null_mask, column] = 0
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
    return int(null_mask.sum())


def cleaning_trim_strings(df: pd.DataFrame, column: str) -> int:
    s = df[column].astype(str)
    trimmed = s.str.strip()
    modified = int((s != trimmed).sum())
    df[column] = trimmed.where(df[column].notna(), None)
    return modified


def cleaning_standardize_case(
    df: pd.DataFrame, column: str, mode: str = "lower"
) -> int:
    s = df[column].astype(str)
    if mode == "upper":
        new = s.str.upper()
    elif mode == "title":
        new = s.str.title()
    else:
        new = s.str.lower()
    modified = int((s != new).sum())
    df[column] = new.where(df[column].notna(), None)
    return modified


def cleaning_normalize_whitespace(
    df: pd.DataFrame, column: str, lowercase: bool = True
) -> int:
    s = df[column].astype(str)
    new = s.str.strip().str.replace(r"\s+", " ", regex=True)
    if lowercase:
        new = new.str.lower()
    modified = int((s != new).sum())
    df[column] = new.where(df[column].notna(), None)
    return modified


def cleaning_coerce_types(df: pd.DataFrame, column: str, dtype: str = "numeric") -> int:
    s = df[column]
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
    return modified


def cleaning_clip_values(
    df: pd.DataFrame, column: str, min_val: Any = None, max_val: Any = None
) -> int:
    s = df[column]
    before = s.copy()
    df[column] = s.clip(lower=min_val, upper=max_val)
    return int((before != df[column]).sum())
