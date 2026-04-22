from __future__ import annotations
from typing import Any, Dict, List, Optional, Tuple
import math

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
            base = pivot.iloc[:, 0].replace(0, np.nan)
            retention = (pivot.divide(base, axis=0) * 100).round(1)

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

    # ── Distribution Analysis ─────────────────────────────────────────────────

    @staticmethod
    def distribution_analysis(
        df: pd.DataFrame, numeric_cols: List[str]
    ) -> Dict[str, Any]:
        """Histogram bins, normality tests (Shapiro-Wilk), skew/kurtosis badges."""
        from scipy import stats as sp

        results = []
        for col in numeric_cols[:12]:
            if col not in df.columns:
                continue
            s = df[col].dropna()
            if len(s) < 8:
                continue
            # Histogram with Freedman-Diaconis bins
            try:
                counts, edges = np.histogram(s, bins="fd")
                if len(counts) > 40:
                    counts, edges = np.histogram(s, bins=40)
            except Exception:
                counts, edges = np.histogram(s, bins=20)

            bins = [
                {"lo": round(float(edges[i]), 4), "hi": round(float(edges[i + 1]), 4), "count": int(counts[i])}
                for i in range(len(counts))
            ]

            # Normality
            sample = s.sample(min(len(s), 5000), random_state=42) if len(s) > 5000 else s
            try:
                shapiro_stat, shapiro_p = sp.shapiro(sample)
            except Exception:
                shapiro_stat, shapiro_p = 0.0, 0.0

            skew_val = float(sp.skew(s))
            kurt_val = float(sp.kurtosis(s))
            _mean = float(s.mean())
            cv = abs(float(s.std()) / _mean) * 100 if _mean != 0 and math.isfinite(_mean) else 0

            results.append({
                "column": col,
                "bins": bins,
                "mean": round(float(s.mean()), 4),
                "median": round(float(s.median()), 4),
                "std": round(float(s.std()), 4),
                "skewness": round(skew_val, 4),
                "kurtosis": round(kurt_val, 4),
                "cv_pct": round(cv, 2),
                "shapiro_stat": round(float(shapiro_stat), 4),
                "shapiro_p": round(float(shapiro_p), 6),
                "is_normal": bool(shapiro_p > 0.05),
                "skew_label": "right-skewed" if skew_val > 0.5 else "left-skewed" if skew_val < -0.5 else "symmetric",
                "kurt_label": "heavy-tailed" if kurt_val > 1 else "light-tailed" if kurt_val < -1 else "mesokurtic",
                "n": int(len(s)),
                "p5": round(float(s.quantile(0.05)), 4),
                "p95": round(float(s.quantile(0.95)), 4),
            })
        return {"distributions": results}

    # ── Data Quality Score ────────────────────────────────────────────────────

    @staticmethod
    def data_quality_score(df: pd.DataFrame, schema_cols: List[Dict]) -> Dict[str, Any]:
        """Multi-factor weighted quality score with per-column breakdown & auto-fix suggestions."""
        total_cells = df.size or 1
        missing_cells = int(df.isna().sum().sum())
        dup_rows = int(df.duplicated().sum())
        row_count = len(df)

        completeness = (1 - missing_cells / total_cells) * 100
        uniqueness = (1 - dup_rows / max(row_count, 1)) * 100

        # Consistency: check mixed types in object cols
        mixed_type_cols = 0
        for c in df.select_dtypes("object").columns:
            types_found = df[c].dropna().apply(type).nunique()
            if types_found > 1:
                mixed_type_cols += 1
        consistency = (1 - mixed_type_cols / max(len(df.columns), 1)) * 100

        # Validity: check for constant or near-zero-variance cols
        invalid_cols = 0
        for c in df.columns:
            if df[c].nunique() <= 1:
                invalid_cols += 1
        validity = (1 - invalid_cols / max(len(df.columns), 1)) * 100

        overall = round(completeness * 0.35 + uniqueness * 0.25 + consistency * 0.20 + validity * 0.20, 1)

        # Per-column issues
        col_issues: List[Dict[str, Any]] = []
        suggestions: List[Dict[str, str]] = []
        for col_meta in schema_cols:
            col = col_meta.get("name", "")
            if col not in df.columns:
                continue
            s = df[col]
            null_pct = round(s.isna().mean() * 100, 2)
            issues = []
            if null_pct > 30:
                issues.append("high_missing")
                suggestions.append({"column": col, "action": "drop_column", "reason": f"{null_pct}% missing — consider dropping"})
            elif null_pct > 5:
                issues.append("moderate_missing")
                fill = "median" if col_meta.get("inferred_type") == "numeric" else "mode"
                suggestions.append({"column": col, "action": f"fill_{fill}", "reason": f"{null_pct}% missing — impute with {fill}"})
            if s.nunique() <= 1:
                issues.append("constant")
                suggestions.append({"column": col, "action": "drop_column", "reason": "Column is constant — adds no information"})
            col_issues.append({"column": col, "null_pct": null_pct, "issues": issues})

        if dup_rows > 0:
            suggestions.append({"column": "_rows_", "action": "dedup", "reason": f"{dup_rows} duplicate rows found"})

        grade = "A" if overall >= 90 else "B" if overall >= 75 else "C" if overall >= 60 else "D" if overall >= 40 else "F"

        return {
            "overall_score": overall,
            "grade": grade,
            "completeness": round(completeness, 1),
            "uniqueness": round(uniqueness, 1),
            "consistency": round(consistency, 1),
            "validity": round(validity, 1),
            "missing_cells": missing_cells,
            "duplicate_rows": dup_rows,
            "total_cells": total_cells,
            "column_issues": col_issues,
            "suggestions": suggestions[:12],
        }

    # ── Column Relationship Discovery ─────────────────────────────────────────

    @staticmethod
    def column_relationships(df: pd.DataFrame) -> Dict[str, Any]:
        """Auto-detect foreign keys, functional dependencies, and join candidates."""
        relationships: List[Dict[str, Any]] = []
        cat_cols = df.select_dtypes(include=["object", "category"]).columns.tolist()
        num_cols = df.select_dtypes(include=np.number).columns.tolist()

        # FK detection: if col A's unique values are a subset of col B
        for i, a in enumerate(cat_cols):
            ua = set(df[a].dropna().unique())
            if len(ua) < 2 or len(ua) > len(df) * 0.8:
                continue
            for b in cat_cols[i + 1:]:
                ub = set(df[b].dropna().unique())
                if len(ub) < 2:
                    continue
                overlap = len(ua & ub) / max(len(ua | ub), 1)
                if overlap > 0.6:
                    relationships.append({
                        "col_a": a, "col_b": b, "type": "categorical_overlap",
                        "overlap_pct": round(overlap * 100, 1),
                        "hint": "Possible join key or FK relationship",
                    })

        # Functional dependency: if knowing col A determines col B
        for a in cat_cols[:6]:
            for b in cat_cols[:6]:
                if a == b:
                    continue
                try:
                    groups = df.groupby(a)[b].nunique()
                    if groups.max() == 1 and len(groups) > 2:
                        relationships.append({
                            "col_a": a, "col_b": b, "type": "functional_dependency",
                            "overlap_pct": 100.0,
                            "hint": f"{a} → {b} (each {a} value maps to exactly one {b})",
                        })
                except Exception:
                    pass

        # Numeric ratio detection
        for i, a in enumerate(num_cols[:8]):
            sa = df[a].dropna()
            if len(sa) < 10:
                continue
            for b in num_cols[i + 1:8]:
                sb = df[b].dropna()
                common = df[[a, b]].dropna()
                if len(common) < 10:
                    continue
                ratio = common[a] / common[b].replace(0, np.nan)
                ratio = ratio.dropna()
                if len(ratio) > 5 and ratio.std() / abs(ratio.mean() + 1e-10) < 0.05:
                    relationships.append({
                        "col_a": a, "col_b": b, "type": "constant_ratio",
                        "overlap_pct": round(ratio.mean(), 4),
                        "hint": f"{a} ≈ {ratio.mean():.2f} × {b} (nearly constant ratio)",
                    })

        return {"relationships": relationships[:20]}

    # ── Time-Series Decomposition (STL-like) ──────────────────────────────────

    @staticmethod
    def ts_decomposition(
        df: pd.DataFrame, date_col: str, value_col: str, period: int = 7
    ) -> Dict[str, Any]:
        """Additive decomposition into trend + seasonal + residual."""
        try:
            ts = df[[date_col, value_col]].copy()
            ts[date_col] = pd.to_datetime(ts[date_col], errors="coerce")
            ts = ts.dropna().sort_values(date_col)
            ts_series = ts.set_index(date_col)[value_col]

            if len(ts_series) < period * 2:
                return {"error": f"Need at least {period * 2} data points for decomposition."}

            trend = ts_series.rolling(window=period, center=True, min_periods=1).mean()
            detrended = ts_series - trend
            seasonal = detrended.groupby(np.arange(len(detrended)) % period).transform("mean")
            residual = ts_series - trend - seasonal

            # Seasonality strength
            var_resid = residual.dropna().var()
            var_deseason = (ts_series - seasonal).dropna().var()
            seasonality_strength = round(max(0, 1 - var_resid / (var_deseason + 1e-10)), 3)

            # Trend strength
            var_orig = ts_series.dropna().var()
            trend_strength = round(max(0, 1 - var_resid / (var_orig + 1e-10)), 3)

            dates = ts_series.index.astype(str).tolist()
            return {
                "dates": dates,
                "observed": [_safe(v) for v in ts_series.tolist()],
                "trend": [_safe(v) for v in trend.tolist()],
                "seasonal": [_safe(v) for v in seasonal.tolist()],
                "residual": [_safe(v) for v in residual.tolist()],
                "period": period,
                "trend_strength": trend_strength,
                "seasonality_strength": seasonality_strength,
                "data_points": len(ts_series),
            }
        except Exception as e:
            return {"error": str(e)}

    # ── Drift Detection ───────────────────────────────────────────────────────

    @staticmethod
    def drift_detection(
        df: pd.DataFrame, numeric_cols: List[str], split_ratio: float = 0.5
    ) -> Dict[str, Any]:
        """Split data in half and compare distributions using KS-test & PSI."""
        mid = int(len(df) * split_ratio)
        if mid < 10 or (len(df) - mid) < 10:
            return {"error": "Not enough rows for drift detection (need 20+)."}

        df_a, df_b = df.iloc[:mid], df.iloc[mid:]
        results = []

        for col in numeric_cols[:12]:
            if col not in df.columns:
                continue
            sa = df_a[col].dropna()
            sb = df_b[col].dropna()
            if len(sa) < 5 or len(sb) < 5:
                continue

            from scipy import stats as sp
            ks_stat, ks_p = sp.ks_2samp(sa, sb)

            # Population Stability Index (PSI)
            try:
                bins = np.linspace(min(sa.min(), sb.min()), max(sa.max(), sb.max()), 11)
                ha = np.histogram(sa, bins=bins)[0] / len(sa) + 1e-6
                hb = np.histogram(sb, bins=bins)[0] / len(sb) + 1e-6
                psi = float(np.sum((ha - hb) * np.log(ha / hb)))
            except Exception:
                psi = 0.0

            drift_level = "high" if psi > 0.25 else "moderate" if psi > 0.1 else "low"

            results.append({
                "column": col,
                "ks_statistic": round(float(ks_stat), 4),
                "ks_p_value": round(float(ks_p), 6),
                "ks_significant": bool(ks_p < 0.05),
                "psi": round(psi, 4),
                "drift_level": drift_level,
                "mean_a": round(float(sa.mean()), 4),
                "mean_b": round(float(sb.mean()), 4),
                "std_a": round(float(sa.std()), 4),
                "std_b": round(float(sb.std()), 4),
            })

        drifted = sum(1 for r in results if r["drift_level"] != "low")
        return {
            "split_at_row": mid,
            "total_rows": len(df),
            "columns_analyzed": len(results),
            "columns_drifted": drifted,
            "drift_results": results,
        }

    # ── Forecasting (with confidence intervals) ─────────────────────────────

    @staticmethod
    def forecast_series(
        df: pd.DataFrame,
        date_col: str,
        value_col: str,
        horizon: int = 14,
        method: str = "auto",
    ) -> Dict[str, Any]:
        """Produce a point forecast with 80% and 95% confidence bands.

        Strategy:
        * ``method="linear"`` — OLS trend + residual-based bands. Robust and
          always available (only scipy required).
        * ``method="holt"`` — double exponential smoothing (captures trend).
        * ``method="holt_winters"`` — triple exp smoothing if a weekly season
          is detected (len >= 14) and ``statsmodels`` is installed.
        * ``method="auto"`` — picks the best of the above by in-sample error.
        """
        try:
            ts = df[[date_col, value_col]].copy()
            ts[date_col] = pd.to_datetime(ts[date_col], errors="coerce")
            ts = ts.dropna().sort_values(date_col).set_index(date_col)[value_col]
            ts = ts.asfreq(pd.infer_freq(ts.index) or "D").interpolate()
            n = len(ts)
            if n < 5:
                return {"error": "Need at least 5 data points for forecasting."}
            horizon = max(1, min(int(horizon), 180))

            candidates = []

            # 1) Always compute the linear baseline.
            candidates.append(("linear", _forecast_linear(ts, horizon)))

            # 2) Holt/Holt-Winters via statsmodels when available.
            if method in ("auto", "holt", "holt_winters"):
                try:
                    from statsmodels.tsa.holtwinters import ExponentialSmoothing

                    if method in ("auto", "holt"):
                        candidates.append((
                            "holt",
                            _forecast_exp_smoothing(
                                ts, horizon, ExponentialSmoothing, seasonal=None
                            ),
                        ))
                    if method in ("auto", "holt_winters") and n >= 14:
                        candidates.append((
                            "holt_winters",
                            _forecast_exp_smoothing(
                                ts, horizon, ExponentialSmoothing,
                                seasonal="add", seasonal_periods=7,
                            ),
                        ))
                except Exception:
                    # statsmodels absent or fit failed — rely on linear baseline.
                    pass

            # Filter failures and pick the best by in-sample RMSE.
            valid = [(name, res) for name, res in candidates if res is not None]
            if not valid:
                return {"error": "All forecast methods failed."}

            if method == "auto":
                name, chosen = min(valid, key=lambda kv: kv[1]["rmse_in_sample"])
            else:
                preferred = [kv for kv in valid if kv[0] == method]
                name, chosen = (preferred or valid)[0]

            last_date = ts.index[-1]
            freq = pd.infer_freq(ts.index) or "D"
            future_index = pd.date_range(
                start=last_date + pd.tseries.frequencies.to_offset(freq),
                periods=horizon,
                freq=freq,
            )

            return {
                "method": name,
                "horizon": horizon,
                "dates_historical": ts.index.astype(str).tolist(),
                "values_historical": [_safe(v) for v in ts.tolist()],
                "dates_forecast": [d.isoformat() for d in future_index],
                "forecast": [_safe(v) for v in chosen["forecast"]],
                "lower_80": [_safe(v) for v in chosen["lower_80"]],
                "upper_80": [_safe(v) for v in chosen["upper_80"]],
                "lower_95": [_safe(v) for v in chosen["lower_95"]],
                "upper_95": [_safe(v) for v in chosen["upper_95"]],
                "rmse_in_sample": round(float(chosen["rmse_in_sample"]), 4),
                "mape_in_sample": round(float(chosen.get("mape_in_sample", 0.0)), 2),
                "confidence_note": (
                    "Bands derived from residual standard deviation and assume "
                    "approximately Gaussian errors."
                ),
            }
        except Exception as e:
            logger.warning("forecast failed", error=str(e))
            return {"error": str(e)}

    # ── Seasonal anomaly detection ──────────────────────────────────────────

    @staticmethod
    def seasonal_anomalies(
        df: pd.DataFrame,
        date_col: str,
        value_col: str,
        period: int = 7,
        z_threshold: float = 3.0,
    ) -> Dict[str, Any]:
        """Detect anomalies in time-series after removing trend + seasonality.

        Unlike the plain Z-score detector, this deseasonalises the series first
        so recurring weekly/monthly dips are not flagged as outliers.
        """
        try:
            ts = df[[date_col, value_col]].copy()
            ts[date_col] = pd.to_datetime(ts[date_col], errors="coerce")
            ts = ts.dropna().sort_values(date_col).set_index(date_col)[value_col]
            if len(ts) < period * 2:
                return {"error": f"Need at least {period * 2} points."}

            trend = ts.rolling(window=period, center=True, min_periods=1).mean()
            detrended = ts - trend
            seasonal = detrended.groupby(np.arange(len(detrended)) % period).transform("mean")
            residual = (ts - trend - seasonal).dropna()

            mu = float(residual.mean())
            sigma = float(residual.std()) or 1e-9
            robust_sigma = float((residual - residual.median()).abs().median() * 1.4826) or sigma

            anomalies = []
            for ts_idx, val in residual.items():
                z = (val - mu) / sigma
                robust_z = (val - residual.median()) / robust_sigma
                if abs(robust_z) >= z_threshold:
                    anomalies.append({
                        "date": ts_idx.isoformat() if hasattr(ts_idx, "isoformat") else str(ts_idx),
                        "value": _safe(ts.loc[ts_idx]),
                        "residual": round(float(val), 4),
                        "z_score": round(float(z), 3),
                        "robust_z": round(float(robust_z), 3),
                        "direction": "spike" if robust_z > 0 else "dip",
                    })

            anomalies.sort(key=lambda a: abs(a["robust_z"]), reverse=True)
            return {
                "method": "seasonal_robust_z",
                "period": period,
                "threshold": z_threshold,
                "points_checked": int(len(residual)),
                "anomaly_count": len(anomalies),
                "anomalies": anomalies[:100],
            }
        except Exception as e:
            return {"error": str(e)}

    # ── Feature Importance ────────────────────────────────────────────────────

    @staticmethod
    def feature_importance(
        df: pd.DataFrame, target_col: str, numeric_cols: List[str]
    ) -> Dict[str, Any]:
        """Rank features by mutual information and correlation magnitude."""
        if target_col not in df.columns:
            return {"error": f"Target column '{target_col}' not found."}

        features = [c for c in numeric_cols if c != target_col and c in df.columns]
        if not features:
            return {"error": "No feature columns available."}

        sub = df[[target_col] + features].dropna()
        if len(sub) < 20:
            return {"error": "Not enough complete rows for feature importance."}

        results = []
        for feat in features:
            x = sub[feat].values
            y = sub[target_col].values

            # Correlation-based importance
            try:
                from scipy import stats as sp
                corr, _ = sp.pearsonr(x, y)
                corr_importance = abs(float(corr))
            except Exception:
                corr_importance = 0.0

            # Mutual information approximation (binned)
            try:
                n_bins = min(20, max(5, int(len(x) ** 0.4)))
                x_binned = np.digitize(x, np.linspace(x.min(), x.max(), n_bins))
                y_binned = np.digitize(y, np.linspace(y.min(), y.max(), n_bins))
                contingency = np.histogram2d(x_binned, y_binned, bins=n_bins)[0]
                contingency = contingency / contingency.sum()
                px = contingency.sum(axis=1)
                py = contingency.sum(axis=0)
                mi = 0.0
                for i in range(contingency.shape[0]):
                    for j in range(contingency.shape[1]):
                        if contingency[i, j] > 0 and px[i] > 0 and py[j] > 0:
                            mi += contingency[i, j] * math.log2(contingency[i, j] / (px[i] * py[j]))
                mi_score = max(0.0, mi)
            except Exception:
                mi_score = 0.0

            combined = round(corr_importance * 0.5 + min(mi_score, 1.0) * 0.5, 4)
            results.append({
                "feature": feat,
                "correlation": round(corr_importance, 4),
                "mutual_info": round(mi_score, 4),
                "importance": combined,
            })

        results.sort(key=lambda r: r["importance"], reverse=True)

        # Normalize to 0-100
        max_imp = results[0]["importance"] if results else 1.0
        for r in results:
            r["importance_pct"] = round(r["importance"] / (max_imp or 1) * 100, 1)

        return {
            "target": target_col,
            "features": results,
            "top_feature": results[0]["feature"] if results else None,
        }


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


def _forecast_linear(ts: pd.Series, horizon: int) -> Optional[Dict[str, Any]]:
    """OLS linear trend forecast with residual-std based confidence bands.

    Returns ``None`` if the fit would be degenerate.
    """
    try:
        from scipy import stats as sp

        y = ts.values.astype(float)
        x = np.arange(len(y))
        slope, intercept, *_ = sp.linregress(x, y)
        fitted = intercept + slope * x
        residuals = y - fitted
        sigma = float(np.std(residuals, ddof=1)) if len(residuals) > 1 else 0.0
        # Growing uncertainty band — std scales with sqrt(step) as a simple
        # approximation of forecast-variance expansion.
        future_x = np.arange(len(y), len(y) + horizon)
        point = intercept + slope * future_x
        step = np.sqrt(np.arange(1, horizon + 1))
        band80 = 1.2816 * sigma * step
        band95 = 1.9600 * sigma * step
        mape = _mape(y, fitted)
        return {
            "forecast": point.tolist(),
            "lower_80": (point - band80).tolist(),
            "upper_80": (point + band80).tolist(),
            "lower_95": (point - band95).tolist(),
            "upper_95": (point + band95).tolist(),
            "rmse_in_sample": float(np.sqrt(np.mean(residuals ** 2))),
            "mape_in_sample": mape,
        }
    except Exception:
        return None


def _forecast_exp_smoothing(
    ts: pd.Series,
    horizon: int,
    ExponentialSmoothing,
    seasonal: Optional[str] = None,
    seasonal_periods: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """Holt / Holt-Winters forecast with residual-based confidence bands."""
    try:
        model = ExponentialSmoothing(
            ts,
            trend="add",
            seasonal=seasonal,
            seasonal_periods=seasonal_periods,
            initialization_method="estimated",
        ).fit(optimized=True)
        fitted = model.fittedvalues
        residuals = (ts - fitted).dropna().values
        sigma = float(np.std(residuals, ddof=1)) if len(residuals) > 1 else 0.0
        point = np.asarray(model.forecast(horizon))
        step = np.sqrt(np.arange(1, horizon + 1))
        band80 = 1.2816 * sigma * step
        band95 = 1.9600 * sigma * step
        mape = _mape(ts.values.astype(float), fitted.values.astype(float))
        return {
            "forecast": point.tolist(),
            "lower_80": (point - band80).tolist(),
            "upper_80": (point + band80).tolist(),
            "lower_95": (point - band95).tolist(),
            "upper_95": (point + band95).tolist(),
            "rmse_in_sample": float(np.sqrt(np.mean(residuals ** 2))) if len(residuals) else 0.0,
            "mape_in_sample": mape,
        }
    except Exception:
        return None


def _mape(actual: np.ndarray, predicted: np.ndarray) -> float:
    try:
        mask = actual != 0
        if not mask.any():
            return 0.0
        return float(np.mean(np.abs((actual[mask] - predicted[mask]) / actual[mask])) * 100)
    except Exception:
        return 0.0
