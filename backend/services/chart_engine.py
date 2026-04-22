from __future__ import annotations
import math
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from backend.models.schemas import ChartType, ValidationResult
from backend.utils.logger import get_logger

logger = get_logger(__name__)

MAX_POINTS = 150


def _safe(v: Any) -> Any:
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return None if (np.isnan(v) or np.isinf(v)) else float(v)
    if isinstance(v, float):
        try:
            return None if (math.isnan(v) or math.isinf(v)) else v
        except Exception:
            pass
    return v


def _clean(lst: list) -> list:
    return [_safe(v) for v in lst]


def _nums(cols: List[Dict]) -> List[str]:
    return [c["name"] for c in cols if c.get("inferred_type") == "numeric"]


def _cats(cols: List[Dict]) -> List[str]:
    return [
        c["name"] for c in cols if c.get("inferred_type") in ("categorical", "boolean")
    ]


def _dts(cols: List[Dict]) -> List[str]:
    return [c["name"] for c in cols if c.get("inferred_type") == "datetime"]


def _card(name: str, cols: List[Dict], df: pd.DataFrame) -> int:
    meta = next((c for c in cols if c["name"] == name), None)
    if meta:
        return meta.get("unique_count", df[name].nunique() if name in df else 999)
    return 999


class ChartValidator:
    MIN_ROWS = {
        ChartType.CANDLESTICK: 5,
        ChartType.VIOLIN: 30,
        ChartType.BOXPLOT: 10,
        ChartType.RADAR: 3,
        ChartType.SANKEY: 5,
        ChartType.HEATMAP: 4,
        ChartType.WATERFALL: 2,
        ChartType.FUNNEL: 2,
    }

    def validate(
        self, chart_type: str, df: pd.DataFrame, schema_cols: List[Dict]
    ) -> ValidationResult:
        ct = chart_type.lower()
        n = len(df)
        num = _nums(schema_cols)
        cat = _cats(schema_cols)
        dts = _dts(schema_cols)

        min_r = self.MIN_ROWS.get(ct, 2)
        if n < min_r:
            return ValidationResult(
                is_valid=False,
                chart_type=ct,
                reason=f"{ct} requires ≥{min_r} rows; dataset has {n}.",
                suggested_alternative="table",
            )

        fn = getattr(self, f"_v_{ct.replace('-', '_')}", None)
        if not fn:
            return ValidationResult(
                is_valid=False,
                chart_type=ct,
                reason=f"Unknown chart type: {ct}",
                suggested_alternative=self._auto(num, cat, dts),
            )

        result = fn(num, cat, dts, n, schema_cols, df)
        result.chart_type = ct
        return result

    def _auto(self, num, cat, dts) -> str:
        if dts and num:
            return ChartType.LINE
        if cat and num:
            return ChartType.BAR
        if len(num) >= 2:
            return ChartType.SCATTER
        if num:
            return ChartType.HISTOGRAM
        return ChartType.TABLE

    def _v_bar(self, num, cat, dts, n, cols, df):
        if not num:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.BAR,
                reason="Needs ≥1 numeric column.",
                suggested_alternative="table",
            )
        if not cat and not dts:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.BAR,
                reason="Needs a categorical or datetime x-axis.",
                suggested_alternative="histogram",
            )
        x = cat[0] if cat else dts[0]
        warns = (
            [f"'{x}' has {_card(x, cols, df)} categories — top 20 shown."]
            if _card(x, cols, df) > 50
            else []
        )
        return ValidationResult(
            is_valid=True,
            chart_type=ChartType.BAR,
            warnings=warns,
            required_columns={"x": x, "y": num[0]},
        )

    def _v_line(self, num, cat, dts, n, cols, df):
        if not num:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.LINE,
                reason="Needs ≥1 numeric column.",
                suggested_alternative="table",
            )
        x = dts[0] if dts else (cat[0] if cat else None)
        if not x:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.LINE,
                reason="Needs a datetime or categorical x-axis.",
                suggested_alternative="scatter",
            )
        return ValidationResult(
            is_valid=True,
            chart_type=ChartType.LINE,
            required_columns={"x": x, "y": num[0]},
        )

    def _v_area(self, num, cat, dts, n, cols, df):
        return self._v_line(num, cat, dts, n, cols, df)

    def _v_pie(self, num, cat, dts, n, cols, df):
        if not num:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.PIE,
                reason="Needs ≥1 numeric column.",
                suggested_alternative="table",
            )
        low = [c for c in cat if _card(c, cols, df) <= 10]
        if not low:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.PIE,
                reason=f"Needs a categorical column with ≤10 unique values. Found cardinalities: {[_card(c, cols, df) for c in cat]}.",
                suggested_alternative="bar",
            )
        return ValidationResult(
            is_valid=True,
            chart_type=ChartType.PIE,
            required_columns={"label": low[0], "value": num[0]},
        )

    def _v_donut(self, num, cat, dts, n, cols, df):
        return self._v_pie(num, cat, dts, n, cols, df)

    def _v_scatter(self, num, cat, dts, n, cols, df):
        if len(num) < 2:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.SCATTER,
                reason=f"Needs ≥2 numeric columns; found {len(num)}.",
                suggested_alternative="histogram" if num else "table",
            )
        return ValidationResult(
            is_valid=True,
            chart_type=ChartType.SCATTER,
            required_columns={"x": num[0], "y": num[1]},
        )

    def _v_bubble(self, num, cat, dts, n, cols, df):
        if len(num) < 3:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.BUBBLE,
                reason=f"Needs ≥3 numeric columns (x, y, size); found {len(num)}.",
                suggested_alternative="scatter",
            )
        return ValidationResult(
            is_valid=True,
            chart_type=ChartType.BUBBLE,
            required_columns={"x": num[0], "y": num[1], "size": num[2]},
        )

    def _v_heatmap(self, num, cat, dts, n, cols, df):
        if len(num) < 2:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.HEATMAP,
                reason="Needs ≥2 numeric columns for correlation matrix.",
                suggested_alternative="bar",
            )
        return ValidationResult(
            is_valid=True,
            chart_type=ChartType.HEATMAP,
            required_columns={"matrix": ",".join(num[:8])},
        )

    def _v_histogram(self, num, cat, dts, n, cols, df):
        if not num:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.HISTOGRAM,
                reason="Needs ≥1 numeric column.",
                suggested_alternative="bar",
            )
        return ValidationResult(
            is_valid=True,
            chart_type=ChartType.HISTOGRAM,
            required_columns={"value": num[0]},
        )

    def _v_boxplot(self, num, cat, dts, n, cols, df):
        if not num:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.BOXPLOT,
                reason="Needs ≥1 numeric column.",
                suggested_alternative="histogram",
            )
        return ValidationResult(
            is_valid=True,
            chart_type=ChartType.BOXPLOT,
            required_columns={"value": num[0], "group": cat[0] if cat else ""},
        )

    def _v_radar(self, num, cat, dts, n, cols, df):
        if len(num) < 3:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.RADAR,
                reason=f"Needs ≥3 numeric columns for axes; found {len(num)}.",
                suggested_alternative="bar" if num else "table",
            )
        axes = num[:10]
        warns = (
            ["Radar chart truncated to 10 axes for readability."]
            if len(num) > 10
            else []
        )
        return ValidationResult(
            is_valid=True,
            chart_type=ChartType.RADAR,
            warnings=warns,
            required_columns={"axes": ",".join(axes)},
        )

    def _v_treemap(self, num, cat, dts, n, cols, df):
        if not num or not cat:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.TREEMAP,
                reason="Needs ≥1 categorical and ≥1 numeric column.",
                suggested_alternative="bar",
            )
        return ValidationResult(
            is_valid=True,
            chart_type=ChartType.TREEMAP,
            required_columns={
                "label": cat[0],
                "value": num[0],
                "parent": cat[1] if len(cat) > 1 else "",
            },
        )

    def _v_waterfall(self, num, cat, dts, n, cols, df):
        if not num or (not cat and not dts):
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.WATERFALL,
                reason="Needs a numeric column and a category/date column.",
                suggested_alternative="bar",
            )
        return ValidationResult(
            is_valid=True,
            chart_type=ChartType.WATERFALL,
            required_columns={"x": (cat[0] if cat else dts[0]), "y": num[0]},
        )

    def _v_funnel(self, num, cat, dts, n, cols, df):
        if not num or not cat:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.FUNNEL,
                reason="Needs a stage (categorical) and value (numeric) column.",
                suggested_alternative="bar",
            )
        c = _card(cat[0], cols, df)
        if c > 12:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.FUNNEL,
                reason=f"Funnel needs ≤12 stages; '{cat[0]}' has {c}.",
                suggested_alternative="bar",
            )
        return ValidationResult(
            is_valid=True,
            chart_type=ChartType.FUNNEL,
            required_columns={"stage": cat[0], "value": num[0]},
        )

    def _v_candlestick(self, num, cat, dts, n, cols, df):
        if len(num) < 4:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.CANDLESTICK,
                reason=f"Needs 4 numeric columns (open, high, low, close); found {len(num)}.",
                suggested_alternative="line",
            )
        return ValidationResult(
            is_valid=True,
            chart_type=ChartType.CANDLESTICK,
            required_columns={
                "date": dts[0] if dts else "",
                "open": num[0],
                "high": num[1],
                "low": num[2],
                "close": num[3],
            },
        )

    def _v_gauge(self, num, cat, dts, n, cols, df):
        if not num:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.GAUGE,
                reason="Needs ≥1 numeric column.",
                suggested_alternative="table",
            )
        return ValidationResult(
            is_valid=True,
            chart_type=ChartType.GAUGE,
            required_columns={"value": num[0]},
        )

    def _v_sankey(self, num, cat, dts, n, cols, df):
        if len(cat) < 2 or not num:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.SANKEY,
                reason="Needs 2 categorical columns (source, target) and 1 numeric column.",
                suggested_alternative="bar",
            )
        return ValidationResult(
            is_valid=True,
            chart_type=ChartType.SANKEY,
            required_columns={"source": cat[0], "target": cat[1], "value": num[0]},
        )

    def _v_violin(self, num, cat, dts, n, cols, df):
        if not num:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.VIOLIN,
                reason="Needs ≥1 numeric column.",
                suggested_alternative="histogram",
            )
        if n < 30:
            return ValidationResult(
                is_valid=False,
                chart_type=ChartType.VIOLIN,
                reason=f"Violin needs ≥30 rows for reliable KDE; dataset has {n}.",
                suggested_alternative="boxplot",
            )
        return ValidationResult(
            is_valid=True,
            chart_type=ChartType.VIOLIN,
            required_columns={"value": num[0], "group": cat[0] if cat else ""},
        )

    def _v_table(self, num, cat, dts, n, cols, df):
        return ValidationResult(is_valid=True, chart_type=ChartType.TABLE)


class ChartDataBuilder:
    def build(
        self,
        ct: str,
        df: pd.DataFrame,
        req_cols: Dict[str, str],
        schema_cols: List[Dict],
    ) -> Dict[str, Any]:
        fn = getattr(self, f"_d_{ct.replace('-', '_')}", self._d_table)
        try:
            return fn(df, req_cols, schema_cols)
        except Exception as e:
            logger.warning("Chart data build failed", chart=ct, error=str(e))
            return {}

    def _d_bar(self, df, c, s):
        x, y = c.get("x", ""), c.get("y", "")
        if not x or not y or x not in df or y not in df:
            return {}
        g = (
            df.groupby(x)[y]
            .sum()
            .reset_index()
            .sort_values(y, ascending=False)
            .head(30)
        )
        return {
            "categories": g[x].astype(str).tolist(),
            "series": [{"name": y, "data": _clean(g[y].tolist())}],
            "aggregation": "sum",
        }

    def _d_line(self, df, c, s):
        x, y = c.get("x", ""), c.get("y", "")
        if not x or not y or x not in df or y not in df:
            return {}
        is_dt = any(
            col["name"] == x and col.get("inferred_type") == "datetime" for col in s
        )
        ts = df[[x, y]].copy()
        if is_dt:
            ts[x] = pd.to_datetime(ts[x], errors="coerce")
        ts = ts.dropna().sort_values(x)
        if len(ts) > MAX_POINTS:
            step = math.ceil(len(ts) / MAX_POINTS)
            ts = ts.iloc[::step]
        return {
            "categories": ts[x].astype(str).tolist(),
            "series": [{"name": y, "data": _clean(ts[y].tolist())}],
        }

    def _d_area(self, df, c, s):
        return self._d_line(df, c, s)

    def _d_pie(self, df, c, s):
        label, value = c.get("label", ""), c.get("value", "")
        if not label or not value:
            return {}
        g = (
            df.groupby(label)[value]
            .sum()
            .reset_index()
            .sort_values(value, ascending=False)
            .head(12)
        )
        total = g[value].sum()
        return {
            "series": [
                {
                    "name": str(r[label]),
                    "value": _safe(r[value]),
                    "pct": round(r[value] / total * 100, 1) if total else 0,
                }
                for _, r in g.iterrows()
            ]
        }

    def _d_donut(self, df, c, s):
        return self._d_pie(df, c, s)

    def _d_scatter(self, df, c, s):
        x, y = c.get("x", ""), c.get("y", "")
        sub = df[[x, y]].dropna()
        if len(sub) > 1000:
            sub = sub.sample(1000, random_state=42)
        return {
            "series": [
                {
                    "name": f"{x} vs {y}",
                    "data": [
                        {"x": _safe(r[x]), "y": _safe(r[y])} for _, r in sub.iterrows()
                    ],
                }
            ]
        }

    def _d_bubble(self, df, c, s):
        x, y, z = c.get("x", ""), c.get("y", ""), c.get("size", "")
        sub = df[[x, y, z]].dropna()
        if len(sub) > 500:
            sub = sub.sample(500, random_state=42)
        return {
            "series": [
                {
                    "name": "Bubble",
                    "data": [
                        {"x": _safe(r[x]), "y": _safe(r[y]), "z": _safe(r[z])}
                        for _, r in sub.iterrows()
                    ],
                }
            ]
        }

    def _d_heatmap(self, df, c, s):
        cols = [col for col in c.get("matrix", "").split(",") if col in df.columns]
        corr = df[cols].corr().round(3)
        return {"columns": list(corr.columns), "matrix": _clean(corr.values.tolist())}

    def _d_histogram(self, df, c, s):
        col = c.get("value", "")
        if not col or col not in df:
            return {}
        series = df[col].dropna()
        counts, edges = np.histogram(series, bins=min(30, max(5, series.nunique())))
        mids = [(edges[i] + edges[i + 1]) / 2 for i in range(len(edges) - 1)]
        return {
            "categories": [round(m, 4) for m in mids],
            "series": [{"name": "Frequency", "data": counts.tolist()}],
        }

    def _d_boxplot(self, df, c, s):
        val, grp = c.get("value", ""), c.get("group", "")
        if not val or val not in df:
            return {}

        def _stats(series):
            return {
                "min": _safe(series.min()),
                "q1": _safe(series.quantile(0.25)),
                "median": _safe(series.median()),
                "q3": _safe(series.quantile(0.75)),
                "max": _safe(series.max()),
            }

        if grp and grp in df:
            return {
                "series": [
                    {"name": str(g), **_stats(gdf)}
                    for g, gdf in df.groupby(grp)[val]
                    if len(gdf.dropna()) >= 2
                ]
            }
        return {"series": [{"name": val, **_stats(df[val].dropna())}]}

    def _d_radar(self, df, c, s):
        axes = [a for a in c.get("axes", "").split(",") if a in df.columns]
        if not axes:
            return {}
        means = df[axes].mean()
        mn, mx = means.min(), means.max()
        norm = ((means - mn) / (mx - mn) * 100).round(2) if mx > mn else means
        return {
            "axes": [{"name": a, "max": float(df[a].max())} for a in axes],
            "series": [{"name": "Average", "data": norm.tolist()}],
        }

    def _d_treemap(self, df, c, s):
        label, value = c.get("label", ""), c.get("value", "")
        if not label or not value:
            return {}
        g = (
            df.groupby(label)[value]
            .sum()
            .reset_index()
            .sort_values(value, ascending=False)
            .head(40)
        )
        return {
            "series": [
                {
                    "id": str(r[label]),
                    "name": str(r[label]),
                    "value": _safe(r[value]),
                    "parent": "",
                }
                for _, r in g.iterrows()
            ]
        }

    def _d_waterfall(self, df, c, s):
        x, y = c.get("x", ""), c.get("y", "")
        if not x or not y:
            return {}
        sub = df[[x, y]].dropna().head(20)
        return {
            "categories": sub[x].astype(str).tolist(),
            "series": [{"name": y, "data": _clean(sub[y].tolist())}],
        }

    def _d_funnel(self, df, c, s):
        stage, value = c.get("stage", ""), c.get("value", "")
        if not stage or not value:
            return {}
        g = (
            df.groupby(stage)[value]
            .sum()
            .reset_index()
            .sort_values(value, ascending=False)
            .head(12)
        )
        return {
            "series": [
                {"name": str(r[stage]), "value": _safe(r[value])}
                for _, r in g.iterrows()
            ]
        }

    def _d_candlestick(self, df, c, s):
        date, o, h, lo, cl = (
            c.get("date", ""),
            c.get("open", ""),
            c.get("high", ""),
            c.get("low", ""),
            c.get("close", ""),
        )
        valid = [k for k in [o, h, lo, cl] if k in df.columns]
        if len(valid) < 4:
            return {}
        sub = df[([date] if date in df.columns else []) + valid].dropna().head(200)
        return {
            "categories": sub[date].astype(str).tolist()
            if date in sub
            else list(range(len(sub))),
            "series": [
                {
                    "name": "OHLC",
                    "data": [
                        [_safe(r[o]), _safe(r[h]), _safe(r[lo]), _safe(r[cl])]
                        for _, r in sub.iterrows()
                    ],
                }
            ],
        }

    def _d_gauge(self, df, c, s):
        col = c.get("value", "")
        if not col or col not in df:
            return {}
        v = df[col].dropna()
        return {
            "value": _safe(v.mean()),
            "min": _safe(v.min()),
            "max": _safe(v.max()),
            "label": col,
        }

    def _d_sankey(self, df, c, s):
        src, tgt, val = c.get("source", ""), c.get("target", ""), c.get("value", "")
        if not src or not tgt or not val:
            return {}
        g = df.groupby([src, tgt])[val].sum().reset_index().head(50)
        nodes = list(set(g[src].tolist() + g[tgt].tolist()))
        return {
            "nodes": [{"name": n} for n in nodes],
            "links": [
                {"source": r[src], "target": r[tgt], "value": _safe(r[val])}
                for _, r in g.iterrows()
            ],
        }

    def _d_violin(self, df, c, s):
        val, grp = c.get("value", ""), c.get("group", "")
        if not val or val not in df:
            return {}
        from scipy.stats import gaussian_kde

        result = []
        groups = df[grp].unique() if grp and grp in df else [None]
        for g in groups:
            series = (
                df[df[grp] == g][val].dropna() if g is not None else df[val].dropna()
            )
            if len(series) < 10:
                continue
            kde = gaussian_kde(series)
            xs = np.linspace(series.min(), series.max(), 50)
            result.append(
                {
                    "name": str(g) if g is not None else val,
                    "density": [
                        {"x": round(float(x), 4), "y": round(float(kde(x)[0]), 6)}
                        for x in xs
                    ],
                    "q1": _safe(series.quantile(0.25)),
                    "median": _safe(series.median()),
                    "q3": _safe(series.quantile(0.75)),
                }
            )
        return {"series": result}

    def _d_table(self, df, c, s):
        sub = df.head(200)
        return {
            "columns": list(sub.columns),
            "rows": sub.fillna("").to_dict("records"),
            "row_count": len(df),
        }


class ChartConfigBuilder:
    def build(
        self,
        ct: str,
        data: Dict,
        validation: ValidationResult,
        title: str,
        insight: str = "",
        drilldown: Dict = None,
        realtime: bool = False,
    ) -> Dict[str, Any]:
        # Transform to frontend ChartSpec format natively
        xKey = "x"
        flat_data = []
        frontend_series = []
        
        categories = data.get("categories", [])
        series = data.get("series", [])
        
        if ct in ["pie", "donut"]:
            xKey = "name"
            if series and isinstance(series[0], dict) and "value" in series[0]:
                flat_data = [{"name": str(s.get("name", "")), "value": s.get("value", 0)} for s in series]
            frontend_series = [{"key": "value", "label": "Value"}]
        elif ct in ["scatter", "bubble"]:
            xKey = "x"
            if series and isinstance(series[0], dict) and "data" in series[0]:
                for p in series[0].get("data", []):
                    flat_data.append({"x": p.get("x", 0), "y": p.get("y", 0), "z": p.get("z", 0)})
            frontend_series = [{"key": "y", "label": series[0].get("name", "Y") if series else "Y"}]
            if ct == "bubble":
                frontend_series.append({"key": "z", "label": "Size"})
        elif ct == "heatmap":
            xKey = "category"
            cols = data.get("columns", [])
            matrix = data.get("matrix", [])
            for ri, row in enumerate(matrix):
                obj = {xKey: cols[ri] if ri < len(cols) else f"Row {ri}"}
                for ci, val in enumerate(row):
                    if ci < len(cols):
                        obj[cols[ci]] = val
                flat_data.append(obj)
            frontend_series = [{"key": c, "label": c} for c in cols]
        else:
            # Standard Line/Bar/Area/etc
            xKey = "x"
            data_len = max([len(categories)] + [len(s.get("data", [])) for s in series])
            for i in range(data_len):
                row = {xKey: categories[i] if i < len(categories) else str(i)}
                for idx, s in enumerate(series):
                    key = str(s.get("name", f"series_{idx}")).replace(" ", "_").lower()
                    row[key] = s.get("data", [])[i] if i < len(s.get("data", [])) else 0
                flat_data.append(row)
            frontend_series = [{"key": str(s.get("name", f"series_{idx}")).replace(" ", "_").lower(), "label": s.get("name", f"Series {idx}")} for idx, s in enumerate(series)]

        return {
            "chart": ct,
            "title": title,
            "insight": insight,
            "is_valid": validation.is_valid,
            "warnings": validation.warnings,
            "data": flat_data,
            "xKey": xKey,
            "series": frontend_series,
            "realtime": realtime,
            "drilldown": drilldown,
            "renderers": {
                "echarts": self._echarts(ct, data, title),
                "chartjs": self._chartjs(ct, data, title),
            },
            "meta": {
                "series_count": len(series),
                "point_count": sum(len(s.get("data", [])) for s in series)
            },
        }

    def _echarts(self, ct: str, data: Dict, title: str) -> Dict:
        base: Dict[str, Any] = {"title": {"text": title}, "tooltip": {}, "legend": {}}
        cats = data.get("categories", [])
        if ct == "bar":
            base.update(
                {
                    "xAxis": {"type": "category", "data": cats},
                    "yAxis": {"type": "value"},
                    "series": [
                        {"type": "bar", "data": s["data"], "name": s["name"]}
                        for s in data.get("series", [])
                    ],
                }
            )
        elif ct in ("line", "area"):
            base.update(
                {
                    "xAxis": {"type": "category", "data": cats},
                    "yAxis": {"type": "value"},
                    "series": [
                        {
                            "type": "line",
                            "data": s["data"],
                            "name": s["name"],
                            "areaStyle": {} if ct == "area" else None,
                        }
                        for s in data.get("series", [])
                    ],
                }
            )
        elif ct in ("pie", "donut"):
            items = data.get("series", [])
            base["series"] = [
                {
                    "type": "pie",
                    "radius": "50%" if ct == "pie" else ["30%", "50%"],
                    "data": [{"name": i["name"], "value": i["value"]} for i in items],
                }
            ]
        elif ct == "scatter":
            for s in data.get("series", []):
                base["series"] = [
                    {
                        "type": "scatter",
                        "data": [[p["x"], p["y"]] for p in s.get("data", [])],
                        "name": s["name"],
                    }
                ]
            base.update({"xAxis": {"type": "value"}, "yAxis": {"type": "value"}})
        elif ct == "radar":
            base["radar"] = {"indicator": data.get("axes", [])}
            base["series"] = [
                {"type": "radar", "data": [{"value": s["data"], "name": s["name"]}]}
                for s in data.get("series", [])
            ]
        elif ct == "heatmap":
            cols = data.get("columns", [])
            mat = data.get("matrix", [])
            flat = [
                [j, i, (mat[i][j] if mat else None)]
                for i in range(len(cols))
                for j in range(len(cols))
            ]
            base.update(
                {
                    "xAxis": {"type": "category", "data": cols},
                    "yAxis": {"type": "category", "data": cols},
                    "series": [
                        {"type": "heatmap", "data": flat, "label": {"show": True}}
                    ],
                    "visualMap": {"min": -1, "max": 1, "calculable": True},
                }
            )
        elif ct == "histogram":
            base.update(
                {
                    "xAxis": {"type": "category", "data": data.get("categories", [])},
                    "yAxis": {"type": "value"},
                    "series": [
                        {"type": "bar", "data": s["data"], "name": s["name"]}
                        for s in data.get("series", [])
                    ],
                }
            )
        elif ct == "funnel":
            base["series"] = [
                {
                    "type": "funnel",
                    "data": [
                        {"name": s["name"], "value": s["value"]}
                        for s in data.get("series", [])
                    ],
                }
            ]
        elif ct == "treemap":
            base["series"] = [
                {
                    "type": "treemap",
                    "data": [
                        {"name": i["name"], "value": i["value"]}
                        for i in data.get("series", [])
                    ],
                }
            ]
        elif ct == "sankey":
            base["series"] = [
                {
                    "type": "sankey",
                    "nodes": data.get("nodes", []),
                    "links": data.get("links", []),
                }
            ]
        elif ct == "gauge":
            base["series"] = [
                {
                    "type": "gauge",
                    "min": data.get("min", 0),
                    "max": data.get("max", 100),
                    "data": [
                        {"value": data.get("value", 0), "name": data.get("label", "")}
                    ],
                }
            ]
        elif ct == "candlestick":
            base.update(
                {
                    "xAxis": {"type": "category", "data": data.get("categories", [])},
                    "yAxis": {"type": "value"},
                    "series": [
                        {
                            "type": "candlestick",
                            "data": data.get("series", [{}])[0].get("data", []),
                        }
                    ],
                }
            )
        return base

    def _chartjs(self, ct: str, data: Dict, title: str) -> Dict:
        TYPE_MAP = {
            "bar": "bar",
            "line": "line",
            "area": "line",
            "pie": "pie",
            "donut": "doughnut",
            "scatter": "scatter",
            "bubble": "bubble",
            "histogram": "bar",
            "radar": "radar",
        }
        cjs = TYPE_MAP.get(ct, "bar")
        cats = data.get("categories", [])
        opts = {"plugins": {"title": {"display": True, "text": title}}}
        if ct in ("pie", "donut"):
            items = data.get("series", [])
            return {
                "type": cjs,
                "data": {
                    "labels": [i["name"] for i in items],
                    "datasets": [{"data": [i["value"] for i in items]}],
                },
                "options": opts,
            }
        if ct == "radar":
            axes = [a["name"] for a in data.get("axes", [])]
            return {
                "type": "radar",
                "data": {
                    "labels": axes,
                    "datasets": [
                        {"label": s["name"], "data": s["data"]}
                        for s in data.get("series", [])
                    ],
                },
            }
        return {
            "type": cjs,
            "data": {
                "labels": cats,
                "datasets": [
                    {
                        "label": s["name"],
                        "data": s.get("data", []),
                        "fill": ct == "area",
                    }
                    for s in data.get("series", [])
                ],
            },
            "options": opts,
        }


class DynamicChartEngine:
    def __init__(self):
        self._validator = ChartValidator()
        self._builder = ChartDataBuilder()
        self._config = ChartConfigBuilder()

    def generate(
        self,
        df: pd.DataFrame,
        schema_cols: List[Dict],
        requested_chart: Optional[str],
        title: str = "",
        intent: str = "general",
        insight: str = "",
        drilldown: Dict = None,
        realtime: bool = False,
    ) -> Dict[str, Any]:
        if requested_chart:
            validation = self._validator.validate(requested_chart, df, schema_cols)
            if not validation.is_valid:
                logger.info(
                    "Chart invalid, using fallback",
                    requested=requested_chart,
                    reason=validation.reason,
                )
                alt = validation.suggested_alternative or "table"
                alt_val = self._validator.validate(alt, df, schema_cols)
                data = self._builder.build(
                    alt, df, alt_val.required_columns, schema_cols
                )
                cfg = self._config.build(
                    alt,
                    data,
                    alt_val,
                    title or alt.title(),
                    insight,
                    drilldown,
                    realtime,
                )
                cfg["original_request"] = requested_chart
                cfg["fallback_reason"] = validation.reason
                return cfg
            ct = requested_chart
        else:
            ct = self._auto_select(schema_cols, df, intent)
            validation = self._validator.validate(ct, df, schema_cols)

        data = self._builder.build(ct, df, validation.required_columns, schema_cols)
        return self._config.build(
            ct,
            data,
            validation,
            title or ct.replace("_", " ").title(),
            insight,
            drilldown,
            realtime,
        )

    def validate_only(
        self, df: pd.DataFrame, schema_cols: List[Dict], chart_type: str
    ) -> ValidationResult:
        return self._validator.validate(chart_type, df, schema_cols)

    def _auto_select(
        self, schema_cols: List[Dict], df: pd.DataFrame, intent: str
    ) -> str:
        num = _nums(schema_cols)
        cat = _cats(schema_cols)
        dts = _dts(schema_cols)
        INTENT_MAP = {
            "trend": [ChartType.LINE, ChartType.AREA],
            "comparison": [ChartType.BAR, ChartType.RADAR],
            "distribution": [ChartType.HISTOGRAM, ChartType.VIOLIN, ChartType.BOXPLOT],
            "correlation": [ChartType.SCATTER, ChartType.HEATMAP],
            "part-whole": [
                ChartType.PIE,
                ChartType.DONUT,
                ChartType.TREEMAP,
                ChartType.FUNNEL,
            ],
            "ranking": [ChartType.BAR, ChartType.TREEMAP],
            "flow": [ChartType.SANKEY, ChartType.WATERFALL],
            "financial": [ChartType.CANDLESTICK, ChartType.LINE],
            "kpi": [ChartType.GAUGE],
        }
        for ct in INTENT_MAP.get(intent, [ChartType.BAR, ChartType.LINE]):
            if self._validator.validate(ct, df, schema_cols).is_valid:
                return ct
        if dts and num:
            return ChartType.LINE
        if cat and num:
            return ChartType.BAR
        if len(num) >= 2:
            return ChartType.SCATTER
        if num:
            return ChartType.HISTOGRAM
        return ChartType.TABLE
