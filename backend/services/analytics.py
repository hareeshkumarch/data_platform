from __future__ import annotations
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from backend.utils.data_utils import _convert, _safe
from backend.utils.logger import get_logger

logger = get_logger(__name__)


class AdvancedAnalytics:
    # ── KPI Engine ───────────────────────────────────────────────────────────

    @staticmethod
    def compute_kpis(
        df: pd.DataFrame, numeric_cols: List[str], date_col: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        kpis = []
        for col in numeric_cols[:8]:
            if col not in df.columns:
                continue
            s = df[col].dropna()
            if len(s) == 0:
                continue
            kpi: Dict[str, Any] = {
                "column": col,
                "total": _safe(s.sum()),
                "mean": round(float(s.mean()), 4),
                "median": _safe(s.median()),
                "min": _safe(s.min()),
                "max": _safe(s.max()),
                "std": _safe(s.std()),
                "count": int(len(s)),
                "null_pct": round(df[col].isna().mean() * 100, 2),
            }
            # Growth rate if date col available
            if date_col and date_col in df.columns:
                kpi["growth_rate"] = AdvancedAnalytics._growth_rate(df, date_col, col)
            kpis.append(kpi)
        return kpis

    @staticmethod
    def _growth_rate(
        df: pd.DataFrame, date_col: str, value_col: str
    ) -> Optional[float]:
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

    # ── Cohort Analysis ──────────────────────────────────────────────────────

    @staticmethod
    def cohort_analysis(
        df: pd.DataFrame, date_col: str, user_col: str, value_col: str
    ) -> Dict[str, Any]:
        try:
            data = df[[date_col, user_col, value_col]].copy()
            data[date_col] = pd.to_datetime(data[date_col], errors="coerce")
            data = data.dropna()
            data["cohort"] = (
                data.groupby(user_col)[date_col].transform("min").dt.to_period("M")
            )
            data["period"] = data[date_col].dt.to_period("M")
            data["period_index"] = (data["period"] - data["cohort"]).apply(
                lambda x: x.n
            )

            grouped = (
                data.groupby(["cohort", "period_index"])[user_col]
                .nunique()
                .reset_index()
                .rename(columns={user_col: "users"})
            )
            pivot = grouped.pivot(
                index="cohort", columns="period_index", values="users"
            )
            retention = (pivot.divide(pivot.iloc[:, 0], axis=0) * 100).round(1)

            return {
                "cohorts": [str(c) for c in retention.index],
                "periods": list(retention.columns.astype(str)),
                "retention_matrix": _convert(retention.fillna(0).values.tolist()),
                "raw_pivot": _convert(pivot.fillna(0).values.tolist()),
            }
        except Exception as e:
            logger.warning("Cohort analysis failed", error=str(e))
            return {"error": str(e)}

    # ── Funnel Analysis ──────────────────────────────────────────────────────

    @staticmethod
    def funnel_analysis(
        df: pd.DataFrame,
        stage_col: str,
        value_col: str,
        stage_order: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        try:
            grouped = (
                df.groupby(stage_col)[value_col].agg(["sum", "count"]).reset_index()
            )
            grouped.columns = ["stage", "total", "count"]
            if stage_order:
                order_map = {s: i for i, s in enumerate(stage_order)}
                grouped["_order"] = grouped["stage"].map(order_map).fillna(999)
                grouped = grouped.sort_values("_order").drop("_order", axis=1)
            else:
                grouped = grouped.sort_values("total", ascending=False)

            top_total = grouped["total"].iloc[0] if len(grouped) else 1
            grouped["conversion_pct"] = (grouped["total"] / top_total * 100).round(1)
            grouped["drop_off_pct"] = (100 - grouped["conversion_pct"]).round(1)

            return {
                "stages": grouped["stage"].astype(str).tolist(),
                "totals": _clean_list(grouped["total"].tolist()),
                "counts": grouped["count"].tolist(),
                "conversion_pct": grouped["conversion_pct"].tolist(),
                "drop_off_pct": grouped["drop_off_pct"].tolist(),
            }
        except Exception as e:
            return {"error": str(e)}

    # ── Aggregation Engine ────────────────────────────────────────────────────

    @staticmethod
    def group_aggregate(
        df: pd.DataFrame,
        group_cols: List[str],
        agg_col: str,
        agg_func: str = "sum",
        top_n: int = 20,
    ) -> Dict[str, Any]:
        valid_funcs = {"sum", "mean", "count", "min", "max", "median", "std", "nunique"}
        if agg_func not in valid_funcs:
            return {"error": f"Invalid agg function. Use: {valid_funcs}"}
        try:
            result = df.groupby(group_cols)[agg_col].agg(agg_func).reset_index()
            result = result.sort_values(agg_col, ascending=False).head(top_n)
            return {
                "group_cols": group_cols,
                "agg_col": agg_col,
                "agg_func": agg_func,
                "rows": _convert(result.to_dict("records")),
                "total_groups": int(df.groupby(group_cols).ngroups),
            }
        except Exception as e:
            return {"error": str(e)}

    # ── Correlation Deep Dive ─────────────────────────────────────────────────

    @staticmethod
    def deep_correlation(
        df: pd.DataFrame, target_col: str, numeric_cols: List[str]
    ) -> Dict[str, Any]:
        try:
            results = []
            for col in numeric_cols:
                if col == target_col or col not in df.columns:
                    continue
                sub = df[[target_col, col]].dropna()
                if len(sub) < 10:
                    continue
                from scipy import stats as sp

                pearson_r, pearson_p = sp.pearsonr(sub[target_col], sub[col])
                spearman_r, spearman_p = sp.spearmanr(sub[target_col], sub[col])
                results.append(
                    {
                        "column": col,
                        "pearson_r": round(float(pearson_r), 4),
                        "pearson_p": round(float(pearson_p), 6),
                        "spearman_r": round(float(spearman_r), 4),
                        "spearman_p": round(float(spearman_p), 6),
                        "significant": bool(pearson_p < 0.05),
                        "strength": _corr_strength(pearson_r),
                    }
                )
            results.sort(key=lambda x: abs(x["pearson_r"]), reverse=True)
            return {"target": target_col, "correlations": results}
        except Exception as e:
            return {"error": str(e)}

    # ── Outlier Summary ───────────────────────────────────────────────────────

    @staticmethod
    def outlier_summary(
        df: pd.DataFrame, numeric_cols: List[str]
    ) -> List[Dict[str, Any]]:
        results = []
        for col in numeric_cols:
            if col not in df.columns:
                continue
            s = df[col].dropna()
            if len(s) < 5:
                continue
            q1, q3 = s.quantile(0.25), s.quantile(0.75)
            iqr = q3 - q1
            lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            outliers = s[(s < lo) | (s > hi)]
            results.append(
                {
                    "column": col,
                    "outlier_count": int(len(outliers)),
                    "outlier_pct": round(len(outliers) / len(s) * 100, 2),
                    "lower_fence": _safe(lo),
                    "upper_fence": _safe(hi),
                    "extreme_low": _safe(s[s < lo].min()) if len(s[s < lo]) else None,
                    "extreme_high": _safe(s[s > hi].max()) if len(s[s > hi]) else None,
                }
            )
        return results

    # ── Data Profiling ────────────────────────────────────────────────────────

    @staticmethod
    def profile_dataset(df: pd.DataFrame, schema_cols: List[Dict]) -> Dict[str, Any]:
        profiles = []
        for col_meta in schema_cols:
            col = col_meta["name"]
            if col not in df.columns:
                continue
            s = df[col]
            profile: Dict[str, Any] = {
                "name": col,
                "type": col_meta.get("inferred_type"),
                "dtype": str(s.dtype),
                "total_count": int(len(s)),
                "null_count": int(s.isna().sum()),
                "null_pct": round(s.isna().mean() * 100, 2),
                "unique_count": int(s.nunique()),
                "is_constant": bool(s.nunique() <= 1),
                "is_unique": bool(s.nunique() == len(s)),
            }
            if col_meta.get("inferred_type") == "numeric":
                ns = s.dropna()
                if len(ns):
                    from scipy import stats as sp

                    profile.update(
                        {
                            "mean": _safe(ns.mean()),
                            "std": _safe(ns.std()),
                            "min": _safe(ns.min()),
                            "max": _safe(ns.max()),
                            "p25": _safe(ns.quantile(0.25)),
                            "p50": _safe(ns.quantile(0.50)),
                            "p75": _safe(ns.quantile(0.75)),
                            "p95": _safe(ns.quantile(0.95)),
                            "skewness": round(float(sp.skew(ns)), 4),
                            "kurtosis": round(float(sp.kurtosis(ns)), 4),
                            "has_negatives": bool((ns < 0).any()),
                            "has_zeros": bool((ns == 0).any()),
                        }
                    )
            elif col_meta.get("inferred_type") == "categorical":
                vc = s.value_counts()
                profile.update(
                    {
                        "top_value": str(vc.index[0]) if len(vc) else None,
                        "top_value_pct": round(vc.iloc[0] / len(s) * 100, 2)
                        if len(vc)
                        else 0,
                        "top_10": {str(k): int(v) for k, v in vc.head(10).items()},
                        "entropy": round(float(_entropy(vc)), 4),
                    }
                )
            profiles.append(profile)
        return {
            "row_count": int(len(df)),
            "col_count": int(len(df.columns)),
            "total_cells": int(df.size),
            "missing_cells": int(df.isna().sum().sum()),
            "duplicate_rows": int(df.duplicated().sum()),
            "columns": profiles,
        }

    # ── Trend Detection ───────────────────────────────────────────────────────

    @staticmethod
    def detect_trends(
        df: pd.DataFrame, date_col: str, value_col: str
    ) -> Dict[str, Any]:
        try:
            ts = df[[date_col, value_col]].copy()
            ts[date_col] = pd.to_datetime(ts[date_col], errors="coerce")
            ts = ts.dropna().sort_values(date_col).set_index(date_col)[value_col]
            if len(ts) < 3:
                return {"error": "Not enough data points."}

            from scipy import stats as sp

            x = np.arange(len(ts))
            slope, intercept, r, p, se = sp.linregress(x, ts.values)

            pct_change = (
                ((ts.iloc[-1] - ts.iloc[0]) / abs(ts.iloc[0]) * 100)
                if ts.iloc[0] != 0
                else 0
            )
            direction = "upward" if slope > 0 else "downward" if slope < 0 else "flat"
            strength = (
                "strong" if abs(r) > 0.7 else "moderate" if abs(r) > 0.4 else "weak"
            )

            return {
                "direction": direction,
                "strength": strength,
                "slope": round(float(slope), 6),
                "r_squared": round(float(r**2), 4),
                "p_value": round(float(p), 6),
                "significant": bool(p < 0.05),
                "pct_change_total": round(float(pct_change), 2),
                "first_value": _safe(ts.iloc[0]),
                "last_value": _safe(ts.iloc[-1]),
                "data_points": int(len(ts)),
            }
        except Exception as e:
            return {"error": str(e)}

    # ── Segment Analysis ──────────────────────────────────────────────────────

    @staticmethod
    def segment_analysis(
        df: pd.DataFrame, segment_col: str, metric_cols: List[str]
    ) -> Dict[str, Any]:
        try:
            result: Dict[str, Any] = {"segment_col": segment_col, "segments": []}
            for segment, gdf in df.groupby(segment_col):
                seg: Dict[str, Any] = {
                    "name": str(segment),
                    "row_count": int(len(gdf)),
                    "metrics": {},
                }
                for col in metric_cols:
                    if col not in gdf.columns:
                        continue
                    s = gdf[col].dropna()
                    if len(s) == 0:
                        continue
                    seg["metrics"][col] = {
                        "mean": _safe(s.mean()),
                        "sum": _safe(s.sum()),
                        "min": _safe(s.min()),
                        "max": _safe(s.max()),
                    }
                result["segments"].append(seg)
            result["segments"].sort(key=lambda x: x["row_count"], reverse=True)
            return result
        except Exception as e:
            return {"error": str(e)}


# ── Helpers ─────────────────────────────────────────────────────────────────


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


def _clean_list(lst: list) -> list:
    return [_safe(v) for v in lst]
