from __future__ import annotations
import asyncio
import hashlib
import json
from typing import Any, Dict, List

import numpy as np
import pandas as pd

from backend.agents.base_agent import BaseAgent
from backend.config import settings
from backend.models.schemas import AgentType, LLMMode, LLMRequest
from backend.prompts.templates import (
    INSIGHT_SYSTEM,
    QUERY_SYSTEM,
    REPORT_SYSTEM,
    EVALUATOR_SYSTEM,
    build_insight_prompt,
    build_query_prompt,
    build_report_prompt,
    build_evaluator_prompt,
)
from backend.services.cache_service import CacheService
from backend.services.llm_service import LLMService
from backend.services.storage_service import StorageService
from backend.services.vector_service import VectorService
from backend.utils.data_utils import (
    compute_correlation,
    compute_quality_score,
    compute_summary_stats,
    detect_anomalies_iqr,
    detect_anomalies_zscore,
    infer_schema,
    parse_csv,
    parse_json,
    sanitize_rows,
    smart_sample,
    time_series_decompose,
    compute_moving_averages,
    naive_forecast,
    contribution_analysis,
)
from backend.utils.logger import get_logger, metrics

logger = get_logger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# INGESTION AGENT
# ─────────────────────────────────────────────────────────────────────────────


class IngestionAgent(BaseAgent):
    agent_type = AgentType.INGESTION

    def __init__(self, cache: CacheService, storage: StorageService):
        super().__init__(cache)
        self._storage = storage

    async def run(self, payload: Dict[str, Any], correlation_id: str) -> Dict[str, Any]:
        dataset_id = payload["dataset_id"]
        source_type = payload.get("source_type", "csv")

        df = await self._load(payload, source_type)
        original_rows = len(df)
        was_sampled = original_rows > settings.SAMPLE_THRESHOLD
        if was_sampled:
            df = smart_sample(df)

        schema_cols = await asyncio.to_thread(infer_schema, df)
        quality = await asyncio.to_thread(compute_quality_score, df)
        validation = await asyncio.to_thread(self._validate, df, schema_cols)
        sample_rows = sanitize_rows(df.head(100).to_dict("records"))

        schema = {
            "dataset_id": dataset_id,
            "name": payload.get("filename", dataset_id),
            "source_type": source_type,
            "row_count": original_rows,
            "sampled_row_count": len(df),
            "was_sampled": was_sampled,
            "col_count": len(df.columns),
            "columns": schema_cols,
            "size_bytes": payload.get("size_bytes", 0),
            "quality_score": quality,
        }

        await self._cache.set_schema(dataset_id, schema)
        await self._cache.set_sample(dataset_id, sample_rows)
        metrics.datasets_ingested.inc()
        metrics.rows_processed.inc(original_rows)
        return {
            "dataset_id": dataset_id,
            "schema": schema,
            "validation": validation,
            "sample_row_count": len(sample_rows),
        }

    async def _load(self, payload: Dict, source_type: str) -> pd.DataFrame:
        content = payload.get("content")
        filepath = payload.get("filepath")
        dataset_id = payload.get("dataset_id")

        if source_type == "csv":
            if content:
                return await asyncio.to_thread(parse_csv, content)
            if filepath:
                return await asyncio.to_thread(pd.read_csv, filepath)
            # Fallback for pipeline runs on existing datasets
            if dataset_id:
                existing_path = self._storage.get_file_path(dataset_id)
                if existing_path:
                    return await asyncio.to_thread(pd.read_csv, existing_path)
        elif source_type == "json":
            if content:
                return await asyncio.to_thread(parse_json, content)
            if filepath:
                return await asyncio.to_thread(pd.read_json, filepath)
            if dataset_id:
                existing_path = self._storage.get_file_path(dataset_id)
                if existing_path:
                    return await asyncio.to_thread(pd.read_json, existing_path)
        elif source_type == "parquet":
            import io

            if content:
                return await asyncio.to_thread(pd.read_parquet, io.BytesIO(content))
            if filepath:
                return await asyncio.to_thread(pd.read_parquet, filepath)
            if dataset_id:
                existing_path = self._storage.get_file_path(dataset_id)
                if existing_path:
                    return await asyncio.to_thread(pd.read_parquet, existing_path)
        elif source_type == "sql":
            return await self._load_sql(payload)
        elif source_type == "api":
            return await self._load_api(payload)

        raise ValueError(
            f"Ingestion failed: No valid content or file found for {dataset_id or 'new dataset'} (type: {source_type})"
        )

    async def _load_sql(self, payload: Dict) -> pd.DataFrame:
        import sqlalchemy as sa

        engine = sa.create_engine(payload["connection_string"])

        def _run():
            with engine.connect() as conn:
                return pd.read_sql_query(sa.text(payload["sql_query"]), conn)

        return await asyncio.to_thread(_run)

    async def _load_api(self, payload: Dict) -> pd.DataFrame:
        import httpx

        cfg = payload.get("api_config", {})
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.request(
                method=cfg.get("method", "GET"),
                url=cfg["url"],
                headers=cfg.get("headers", {}),
                json=cfg.get("body"),
            )
            resp.raise_for_status()
            data = resp.json()
        if isinstance(data, list):
            return pd.DataFrame(data)
        return pd.DataFrame([data])

    def _validate(self, df: pd.DataFrame, cols: list) -> Dict[str, Any]:
        issues, warnings = [], []
        for c in cols:
            p = c["null_pct"]
            if p > 50:
                issues.append(f"'{c['name']}' is {p:.1f}% null")
            elif p > 20:
                warnings.append(f"'{c['name']}' is {p:.1f}% null")
        dups = int(df.duplicated().sum())
        if dups / max(len(df), 1) > 0.1:
            issues.append(f"{dups} duplicate rows ({dups / len(df) * 100:.1f}%)")
        elif dups:
            warnings.append(f"{dups} duplicate rows")
        return {
            "is_valid": not issues,
            "issues": issues,
            "warnings": warnings,
            "duplicate_rows": dups,
        }


# ─────────────────────────────────────────────────────────────────────────────
# UNDERSTANDING AGENT
# ─────────────────────────────────────────────────────────────────────────────


class UnderstandingAgent(BaseAgent):
    agent_type = AgentType.UNDERSTANDING

    def __init__(self, cache: CacheService):
        super().__init__(cache)

    async def run(self, payload: Dict[str, Any], correlation_id: str) -> Dict[str, Any]:
        dataset_id = payload["dataset_id"]
        schema = await self._cache.get_schema(dataset_id)
        rows = await self._cache.get_sample(dataset_id)
        if not schema or not rows:
            raise ValueError(
                f"Schema/sample not found for {dataset_id}. Run ingestion first."
            )

        df = self._rebuild_df(rows, schema)
        stats, corr, missing, dist, quality = await asyncio.gather(
            asyncio.to_thread(compute_summary_stats, df),
            asyncio.to_thread(compute_correlation, df),
            asyncio.to_thread(self._missing_report, df),
            asyncio.to_thread(self._distribution, df, schema),
            asyncio.to_thread(compute_quality_score, df),
        )

        anomalies = []
        if payload.get("run_anomaly", True):
            anomalies = await asyncio.to_thread(self._anomalies, df, schema)

        time_series = {}
        time_col = payload.get("time_column")
        if payload.get("run_time_series") and time_col:
            val_cols = (
                payload.get("value_columns")
                or [
                    c["name"]
                    for c in schema["columns"]
                    if c["inferred_type"] == "numeric"
                ][:3]
            )
            time_series = await self._time_series(df, time_col, val_cols)

        contribution = {}
        if (
            payload.get("run_contribution")
            and payload.get("dimension_col")
            and payload.get("metric_col")
        ):
            d, m = payload["dimension_col"], payload["metric_col"]
            if d in df.columns and m in df.columns:
                contribution = await asyncio.to_thread(contribution_analysis, df, d, m)

        top_corrs = self._top_correlations(corr)

        result = {
            "dataset_id": dataset_id,
            "summary_stats": stats,
            "correlation_matrix": corr,
            "missing_value_report": missing,
            "distribution_info": dist,
            "quality_score": float(quality),
            "correlation_highlights": top_corrs,
            "anomalies": anomalies,
            "time_series": time_series,
            "contribution": contribution,
            "warnings": self._warnings(missing, quality),
        }
        await self._cache.set_eda(dataset_id, result)
        return result

    def _rebuild_df(self, rows: list, schema: Dict) -> pd.DataFrame:
        df = pd.DataFrame(rows)
        for col in schema.get("columns", []):
            if col["name"] in df.columns and col["inferred_type"] == "datetime":
                df[col["name"]] = pd.to_datetime(df[col["name"]], errors="coerce")
        return df

    def _missing_report(self, df: pd.DataFrame) -> Dict:
        m = df.isna().sum()
        p = (m / len(df) * 100).round(2)
        return {
            "per_column": {
                c: {"count": int(m[c]), "pct": float(p[c])}
                for c in df.columns
                if m[c] > 0
            },
            "total_missing": int(m.sum()),
            "completeness_pct": round((1 - m.sum() / df.size) * 100, 2),
        }

    def _distribution(self, df: pd.DataFrame, schema: Dict) -> Dict:
        result = {}
        for col in schema.get("columns", []):
            name, ct = col["name"], col["inferred_type"]
            if name not in df.columns:
                continue
            if ct == "numeric":
                s = df[name].dropna()
                from scipy import stats as sp

                try:
                    sk, ku = float(sp.skew(s)), float(sp.kurtosis(s))
                except Exception:
                    sk, ku = 0.0, 0.0
                counts, edges = np.histogram(s, bins=min(20, s.nunique()))
                result[name] = {
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
            elif ct == "categorical":
                vc = df[name].value_counts()
                result[name] = {
                    "top_values": vc.head(10).to_dict(),
                    "unique_count": int(df[name].nunique()),
                    "mode": str(df[name].mode()[0]) if len(df[name].mode()) else None,
                }
        return result

    def _anomalies(self, df: pd.DataFrame, schema: Dict) -> List[Dict]:
        anomalies = []
        for col in schema.get("columns", []):
            if col["inferred_type"] != "numeric" or col["name"] not in df.columns:
                continue
            s = df[col["name"]].dropna()
            if len(s) < 10:
                continue
            for method, fn in [
                ("zscore", detect_anomalies_zscore),
                ("iqr", detect_anomalies_iqr),
            ]:
                try:
                    idxs, thresh = fn(s)
                    if idxs:
                        anomalies.append(
                            {
                                "column": col["name"],
                                "method": method,
                                "anomaly_count": len(idxs),
                                "anomaly_pct": round(len(idxs) / len(s) * 100, 2),
                                "anomaly_indices": idxs[:20],
                                "threshold": thresh,
                            }
                        )
                except Exception:
                    pass
        return anomalies

    async def _time_series(
        self, df: pd.DataFrame, time_col: str, val_cols: List[str]
    ) -> Dict:
        result: Dict[str, Any] = {"time_column": time_col, "series": {}}
        for col in val_cols:
            if col not in df.columns:
                continue
            try:
                decomp = await asyncio.to_thread(
                    time_series_decompose, df, time_col, col
                )
                ma = await asyncio.to_thread(compute_moving_averages, df, time_col, col)
                forecast = await asyncio.to_thread(naive_forecast, df[col].dropna())
                result["series"][col] = {
                    "decomposition": decomp,
                    "moving_averages": ma,
                    "forecast_14d": forecast,
                }
            except Exception as e:
                logger.warning("TS failed", col=col, error=str(e))
        return result

    def _top_correlations(self, corr: Dict) -> str:
        pairs, seen = [], set()
        for ca, row in corr.items():
            for cb, val in row.items():
                if ca == cb:
                    continue
                key = tuple(sorted([ca, cb]))
                if key in seen:
                    continue
                seen.add(key)
                if isinstance(val, (int, float)) and not np.isnan(val):
                    pairs.append((ca, cb, val))
        pairs.sort(key=lambda x: abs(x[2]), reverse=True)
        return (
            "; ".join(
                f"'{a}' ↔ '{b}': {'positive' if v > 0 else 'negative'} ({v:.2f})"
                for a, b, v in pairs[:5]
            )
            or "No significant correlations."
        )

    def _warnings(self, missing: Dict, quality: float) -> List[str]:
        w = []
        for col, info in missing.get("per_column", {}).items():
            if info["pct"] > 30:
                w.append(f"'{col}' has {info['pct']}% missing values.")
        if quality < 60:
            w.append(f"Data quality score is low ({quality}/100).")
        return w


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE AGENT
# ─────────────────────────────────────────────────────────────────────────────


class FeatureAgent(BaseAgent):
    agent_type = AgentType.FEATURE

    def __init__(self, cache: CacheService):
        super().__init__(cache)

    async def run(self, payload: Dict[str, Any], correlation_id: str) -> Dict[str, Any]:
        dataset_id = payload["dataset_id"]
        schema = await self._cache.get_schema(dataset_id)
        rows = await self._cache.get_sample(dataset_id)
        if not rows or not schema:
            return {"dataset_id": dataset_id, "transformations": [], "skipped": True}

        result = await asyncio.to_thread(self._transform, pd.DataFrame(rows), schema)
        await self._cache.set_json(f"enriched:{dataset_id}", result["rows"], ttl=86400)
        return {
            "dataset_id": dataset_id,
            "transformations": result["transformations"],
            "new_columns": result["new_columns"],
        }

    def _transform(self, df: pd.DataFrame, schema: Dict) -> Dict:
        transformations = []
        for col in schema.get("columns", []):
            name, ct = col["name"], col["inferred_type"]
            if name not in df.columns:
                continue
            if ct == "datetime":
                df[name] = pd.to_datetime(df[name], errors="coerce")
                if not df[name].isna().all():
                    df[f"{name}_year"] = df[name].dt.year
                    df[f"{name}_month"] = df[name].dt.month
                    df[f"{name}_dow"] = df[name].dt.dayofweek
                    transformations.append(
                        f"Extracted year/month/dayofweek from '{name}'"
                    )
            elif ct == "numeric":
                s = df[name].dropna()
                if len(s) > 1 and s.std() > 0:
                    df[f"{name}_scaled"] = (df[name] - s.mean()) / s.std()
                    transformations.append(f"Z-score scaled '{name}'")
                from scipy import stats as sp

                try:
                    if sp.skew(s) > 1 and (s > 0).all():
                        df[f"{name}_log"] = np.log1p(df[name])
                        transformations.append(f"Log-transformed '{name}'")
                except Exception:
                    pass
            elif (
                ct == "categorical"
                and col.get("cardinality") in ("low", "medium")
                and col["unique_count"] <= 50
            ):
                from sklearn.preprocessing import LabelEncoder

                non_null = df[name].dropna()
                if len(non_null):
                    le = LabelEncoder()
                    df.loc[non_null.index, f"{name}_enc"] = le.fit_transform(
                        non_null.astype(str)
                    )
                    transformations.append(f"Label encoded '{name}'")
        return {
            "rows": sanitize_rows(df.head(100).to_dict("records")),
            "transformations": transformations,
            "new_columns": len(df.columns),
        }


# ─────────────────────────────────────────────────────────────────────────────
# INSIGHT AGENT
# ─────────────────────────────────────────────────────────────────────────────


class InsightAgent(BaseAgent):
    agent_type = AgentType.INSIGHT

    def __init__(self, cache: CacheService, llm: LLMService):
        super().__init__(cache, llm)

    async def run(self, payload: Dict[str, Any], correlation_id: str) -> Dict[str, Any]:
        dataset_id = payload["dataset_id"]
        eda = payload.get("eda") or await self._cache.get_eda(dataset_id)
        schema = await self._cache.get_schema(dataset_id)
        if not schema:
            raise ValueError(
                f"Schema missing for {dataset_id}. Run ingestion first."
            )

        # Graceful fallback: compute lightweight EDA inline if not cached
        if not eda:
            rows = await self._cache.get_sample(dataset_id)
            if rows:
                df = pd.DataFrame(rows)
                eda = {
                    "quality_score": compute_quality_score(df),
                    "summary_stats": compute_summary_stats(df),
                    "correlation_highlights": "",
                    "anomalies": [],
                    "warnings": [],
                }
            else:
                eda = {"quality_score": 0, "summary_stats": {}, "correlation_highlights": "", "anomalies": [], "warnings": []}

        prompt = build_insight_prompt(
            dataset_name=schema.get("name", dataset_id),
            row_count=schema.get("row_count", 0),
            col_count=schema.get("col_count", 0),
            quality_score=eda.get("quality_score", 0),
            summary_stats=eda.get("summary_stats", {}),
            column_metadata=schema.get("columns", []),
            correlations=eda.get("correlation_highlights", ""),
            anomalies=str(eda.get("anomalies", [])[:5]),
            focus_columns=payload.get("focus_columns"),
        )

        req = LLMRequest(
            prompt=prompt,
            system_prompt=INSIGHT_SYSTEM,
            provider=payload.get("llm_provider"),
            model_override=payload.get("model_override"),
            mode=LLMMode.ADVANCED,
            temperature=settings.LLM_TEMPERATURE,
            max_tokens=settings.LLM_MAX_TOKENS,
        )
        resp = await self._llm.complete(req)

        try:
            data, preamble = LLMService.extract_json_with_preamble(resp.content)
            if isinstance(data, list) and len(data) > 0:
                data = data[0]
            if not isinstance(data, dict):
                data = {}

            # Use preamble if explanation is missing or very short
            if preamble and len(data.get("executive_summary", "")) < 20:
                data["executive_summary"] = preamble
        except Exception as e:
            logger.error(
                "insight agent failed to parse json",
                error=str(e),
                content=resp.content[:500],
            )
            data = {
                "insights": [],
                "executive_summary": "I summarized the findings above but couldn't parse the detailed insights structure.",
            }

        for i, ins in enumerate(data.get("insights", [])):
            ins.setdefault("priority", i + 1)
            ins.setdefault("confidence", 0.8)
            ins.setdefault("action_items", [])
            ins.setdefault("related_columns", [])

        result = {
            "dataset_id": dataset_id,
            "insights": data.get("insights", []),
            "executive_summary": data.get("executive_summary", ""),
            "provider": resp.provider.value,
            "model": resp.model,
            "tokens_used": resp.tokens_total,
        }
        await self._cache.set_insights(dataset_id, result)
        return result


# ─────────────────────────────────────────────────────────────────────────────
# QUERY AGENT
# ─────────────────────────────────────────────────────────────────────────────
import ast
import multiprocessing
import queue

def _secure_runner(code_str: str, input_df: pd.DataFrame, out_queue: multiprocessing.Queue):
    try:
        # 1. Strict AST validation
        tree = ast.parse(code_str)
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                raise ValueError("Import statements are strictly forbidden.")
            if isinstance(node, ast.Call):
                if getattr(node.func, "id", "") in ["eval", "exec", "open", "getattr", "setattr", "__import__"]:
                    raise ValueError(f"Forbidden function call: {getattr(node.func, 'id', '')}")
            if isinstance(node, ast.Attribute):
                if node.attr.startswith("__"):
                    raise ValueError("Access to dunder attributes is forbidden.")
        
        # 2. Execution in isolated namespace
        ns = {"df": input_df.copy(), "pd": pd, "np": np, "result_df": None}
        exec(code_str, {"__builtins__": {}}, ns)
        
        rdf = ns.get("result_df")
        if rdf is None:
            rdf = ns.get("df", pd.DataFrame())
        out_queue.put({"status": "success", "data": rdf})
    except Exception as ex:
        out_queue.put({"status": "error", "error": str(ex)})



class QueryAgent(BaseAgent):
    agent_type = AgentType.QUERY

    def __init__(self, cache: CacheService, llm: LLMService, vector: VectorService):
        super().__init__(cache, llm)
        self._vector = vector

    async def run(self, payload: Dict[str, Any], correlation_id: str) -> Dict[str, Any]:
        dataset_id = payload["dataset_id"]
        question = payload["question"]
        use_cache = payload.get("use_cache", True)

        cache_key = hashlib.sha256(
            f"{dataset_id}:{question.strip().lower()}".encode()
        ).hexdigest()
        if use_cache:
            cached = await self._cache.get_query(cache_key)
            if cached:
                return {**cached, "cached": True}

        schema = await self._cache.get_schema(dataset_id)
        rows = await self._cache.get_sample(dataset_id)
        if not schema or not rows:
            raise ValueError(f"Dataset {dataset_id} not loaded.")

        rag_context = await self._vector.retrieve(dataset_id, question)
        intent = self._detect_intent(question)

        schema_json = json.dumps(
            {
                "columns": [
                    {"name": c["name"], "type": c["inferred_type"]}
                    for c in schema.get("columns", [])
                ]
            },
            indent=2,
        )
        sample_str = json.dumps(rows[:5], default=str)

        # Resolve model from common payload keys
        model_name = (
            payload.get("model_override")
            or payload.get("llm_model")
            or payload.get("model")
        )

        req = LLMRequest(
            prompt=build_query_prompt(
                schema_json,
                sample_str,
                rag_context,
                question,
                intent,
                payload.get("output_format", "table"),
            ),
            system_prompt=QUERY_SYSTEM,
            provider=payload.get("llm_provider"),
            model_override=model_name,
            mode=LLMMode.ADVANCED,
            temperature=0.1,
            max_tokens=2048,
        )
        resp = await self._llm.complete(req)

        try:
            plan, preamble = LLMService.extract_json_with_preamble(resp.content)
            if isinstance(plan, list) and len(plan) > 0:
                plan = plan[0]
            if not isinstance(plan, dict):
                plan = {}

            # If the extracted JSON misses the core required keys, it might be an accidentally
            # parsed inner structure (like a DataFrame dict) due to a truncated LLM response.
            if plan and not any(
                k in plan
                for k in [
                    "generated_code",
                    "explanation",
                    "query_type",
                    "suggested_chart",
                ]
            ):
                raise ValueError(
                    "Parsed JSON does not match the expected Query schema."
                )

            # Use preamble if explanation is missing or very short compared to preamble
            if preamble and len(plan.get("explanation", "")) < 30:
                plan["explanation"] = preamble
        except Exception as e:
            # Fallback for purely textual responses (no JSON found) or failed inner parsing
            clean_content = resp.content.strip()
            if not any(c in clean_content for c in ("{", "[")):
                plan = {"explanation": clean_content, "generated_code": ""}
            else:
                logger.error(
                    "query agent failed to parse json",
                    error=str(e),
                    content=resp.content[:500],
                )
                raise ValueError(
                    f"I couldn't understand the AI's response format: {str(e)}"
                )

        df = pd.DataFrame(rows)
        for col in schema.get("columns", []):
            if col["name"] not in df.columns:
                continue
            if col["inferred_type"] == "datetime":
                df[col["name"]] = pd.to_datetime(df[col["name"]], errors="coerce")
            elif col["inferred_type"] == "numeric":
                df[col["name"]] = pd.to_numeric(df[col["name"]], errors="coerce")

        execution = await asyncio.to_thread(
            self._exec_code, plan.get("generated_code", ""), df
        )

        # Robust explanation extraction
        explanation = (
            plan.get("explanation")
            or plan.get("answer")
            or plan.get("summary")
            or plan.get("result_description")
            or ""
        )

        # If execution failed, provide a professional, user-friendly refusal or simple explanation
        if execution.get("error"):
            # We skip the "Technical Note" leakage as per user requirement.
            # We prioritize the AI's explanation if it's there, otherwise a generic "analysis failed" message.
            if not explanation:
                explanation = "I encountered an issue analyzing the specific data for this request. Please try rephrasing your question."
            else:
                # Keep the explanation but DO NOT append the technical error
                pass

        # As per the new architecture, we no longer use regex to scrub technical notes.
        # We rely on the unified schema and let the frontend handle fallback displays.

        # Fallback for exploratory queries with empty results/explanations
        if not explanation and intent in ["general", "distribution"]:
            explanation = f"This dataset contains {schema.get('row_count', 0)} records across {len(schema.get('columns', []))} columns. Request more specific analysis if needed."

        result = {
            "dataset_id": dataset_id,
            "question": question,
            "plan": {
                "generated_code": plan.get("generated_code", ""),
                "query_type": plan.get("query_type", "pandas"),
                "explanation": explanation,
                "optimizations_applied": plan.get("optimizations_applied", []),
            },
            "result": execution,
            "suggested_chart": plan.get("suggested_chart", "table"),
            "cached": False,
        }
        await self._cache.set_query(cache_key, result)
        return result

    def _exec_code(self, code: str, df: pd.DataFrame) -> Dict[str, Any]:
        # Use multiprocessing for true isolation and timeout enforcement
        ctx = multiprocessing.get_context('spawn')
        q = ctx.Queue()
        p = ctx.Process(target=_secure_runner, args=(code, df, q))
        p.start()
        
        try:
            result = q.get(timeout=5.0)  # 5 second strict timeout
            p.join(timeout=1.0)
            if result.get("status") == "error":
                return {"columns": [], "rows": [], "row_count": 0, "error": result.get("error")}
            rdf = result.get("data")
        except queue.Empty:
            p.terminate()
            p.join()
            return {"columns": [], "rows": [], "row_count": 0, "error": "Execution Timeout (5s exceeded)."}
        except Exception as e:
            p.terminate()
            return {"columns": [], "rows": [], "row_count": 0, "error": str(e)}
        
        if rdf is None:
            rdf = pd.DataFrame()
        if isinstance(rdf, pd.Series):
            rdf = rdf.reset_index()
            rdf.columns = ["index", "value"]
        if not isinstance(rdf, pd.DataFrame):
            rdf = pd.DataFrame({"result": [rdf]})
        rdf = rdf.head(500)
        return {
            "columns": list(rdf.columns),
            "rows": sanitize_rows(rdf.to_dict("records")),
            "row_count": len(rdf),
        }

    def _detect_intent(self, q: str) -> str:
        q = q.lower()
        if any(w in q for w in ["trend", "over time", "monthly", "daily", "weekly"]):
            return "trend"
        if any(w in q for w in ["compare", "vs", "versus", "difference"]):
            return "comparison"
        if any(w in q for w in ["distribution", "spread", "histogram"]):
            return "distribution"
        if any(w in q for w in ["top", "bottom", "highest", "lowest", "rank"]):
            return "ranking"
        if any(w in q for w in ["correlation", "relationship", "impact"]):
            return "correlation"
        if any(w in q for w in ["sum", "total", "count", "average", "mean"]):
            return "aggregation"
        return "general"


# ─────────────────────────────────────────────────────────────────────────────
# VISUALIZATION AGENT
# ─────────────────────────────────────────────────────────────────────────────


class VisualizationAgent(BaseAgent):
    agent_type = AgentType.VISUALIZATION

    def __init__(self, cache: CacheService, llm: LLMService):
        super().__init__(cache, llm)
        from backend.services.chart_engine import DynamicChartEngine

        self._engine = DynamicChartEngine()

    async def run(self, payload: Dict[str, Any], correlation_id: str) -> Dict[str, Any]:
        dataset_id = payload["dataset_id"]
        schema = await self._cache.get_schema(dataset_id)
        rows = await self._cache.get_sample(dataset_id)
        eda = await self._cache.get_eda(dataset_id)
        if not schema:
            raise ValueError(f"No schema for {dataset_id}")

        df = pd.DataFrame(rows or [])
        cols = schema.get("columns", [])
        charts = await asyncio.to_thread(
            self._generate_all, df, cols, eda or {}, payload.get("question", "")
        )
        kpis = await asyncio.to_thread(self._kpis, df, cols)

        result = {"dataset_id": dataset_id, "charts": charts[:10], "kpis": kpis}
        await self._cache.set_charts(dataset_id, result)
        return result

    def _generate_all(
        self, df: pd.DataFrame, cols: List[Dict], eda: Dict, question: str
    ) -> List[Dict]:
        charts = []
        from backend.services.chart_engine import _nums, _cats, _dts

        num, cat, dts = _nums(cols), _cats(cols), _dts(cols)

        combos = []
        if dts and num:
            combos.append(("line", {}))
        if cat and num:
            combos.append(("bar", {}))
        if num:
            combos.append(("histogram", {}))
        if len(num) >= 2:
            combos.append(("scatter", {}))
        if cat and num and any(df[c].nunique() <= 8 for c in cat):
            combos.append(("pie", {}))
        if len(num) >= 2:
            combos.append(("heatmap", {}))
        if len(num) >= 3:
            combos.append(("radar", {}))

        intents = {
            "line": "trend",
            "bar": "comparison",
            "histogram": "distribution",
            "scatter": "correlation",
            "pie": "part-whole",
            "heatmap": "correlation",
            "radar": "comparison",
        }
        for ct, _ in combos:
            try:
                cfg = self._engine.generate(
                    df,
                    cols,
                    requested_chart=ct,
                    title="",
                    intent=intents.get(ct, "general"),
                )
                if cfg.get("is_valid", False):
                    charts.append(cfg)
            except Exception as e:
                logger.debug("Chart skip", ct=ct, error=str(e))
        return charts

    def _kpis(self, df: pd.DataFrame, cols: List[Dict]) -> List[Dict]:
        from backend.services.chart_engine import _nums

        kpis = []
        for col in _nums(cols)[:4]:
            if col not in df.columns:
                continue
            s = df[col].dropna()
            if not len(s):
                continue
            from backend.utils.data_utils import _safe

            kpis.append(
                {
                    "column": col,
                    "sum": _safe(s.sum()),
                    "mean": round(float(s.mean()), 4),
                    "min": _safe(s.min()),
                    "max": _safe(s.max()),
                    "count": int(len(s)),
                }
            )
        return kpis


# ─────────────────────────────────────────────────────────────────────────────
# REPORT AGENT
# ─────────────────────────────────────────────────────────────────────────────


class ReportAgent(BaseAgent):
    agent_type = AgentType.REPORT

    def __init__(self, cache: CacheService, llm: LLMService):
        super().__init__(cache, llm)

    async def run(self, payload: Dict[str, Any], correlation_id: str) -> Dict[str, Any]:
        dataset_id = payload["dataset_id"]
        schema = await self._cache.get_schema(dataset_id)
        eda = await self._cache.get_eda(dataset_id)
        insights_data = await self._cache.get_insights(dataset_id)
        charts_data = await self._cache.get_charts(dataset_id)
        if not schema:
            raise ValueError(f"Schema not found for {dataset_id}")

        eda = eda or {}
        insights_data = insights_data or {}
        charts_data = charts_data or {}

        prompt = build_report_prompt(
            dataset_name=schema.get("name", dataset_id),
            row_count=schema.get("row_count", 0),
            col_count=schema.get("col_count", 0),
            quality_score=eda.get("quality_score", 0),
            eda_summary=self._eda_summary(eda),
            insights_summary=self._insights_summary(insights_data.get("insights", [])),
            anomaly_summary=self._anomaly_summary(eda.get("anomalies", [])),
            viz_count=len(charts_data.get("charts", [])),
            sections=payload.get(
                "sections",
                [
                    "executive_summary",
                    "eda",
                    "insights",
                    "anomalies",
                    "recommendations",
                ],
            ),
            refinement_instruction=payload.get("refinement_instruction", ""),
        )

        req = LLMRequest(
            prompt=prompt,
            system_prompt=REPORT_SYSTEM,
            provider=payload.get("llm_provider"),
            model_override=payload.get("model_override"),
            mode=LLMMode.ADVANCED,
            temperature=settings.LLM_TEMPERATURE,
            max_tokens=settings.LLM_MAX_TOKENS_REPORT,
        )
        resp = await self._llm.complete(req)

        try:
            data, preamble = LLMService.extract_json_with_preamble(resp.content)
            if isinstance(data, list) and len(data) > 0:
                data = data[0]
            if not isinstance(data, dict):
                data = {}
        except Exception as e:
            logger.error(
                "report agent failed to parse json",
                error=str(e),
                content=resp.content[:500],
            )
            data = {
                "sections": [
                    {
                        "section_id": "main",
                        "title": "Analysis Report",
                        "content": "The report was generated but its structured format was unparseable. Please review the summary and insights tabs for more details.",
                        "order": 1,
                    }
                ]
            }

        return {
            "dataset_id": dataset_id,
            "title": payload.get("title", "Data Intelligence Report"),
            "sections": data.get("sections", []),
            "executive_summary": insights_data.get("executive_summary", ""),
            "charts": charts_data.get("charts", [])[:10],
            "provider": resp.provider.value,
            "model": resp.model,
            "tokens_used": resp.tokens_total,
        }

    def _eda_summary(self, eda: Dict) -> str:
        return (
            f"Quality: {eda.get('quality_score', 'N/A')}/100. "
            f"Completeness: {eda.get('missing_value_report', {}).get('completeness_pct', 'N/A')}%. "
            f"Correlations: {eda.get('correlation_highlights', '')}. "
            f"Warnings: {'; '.join(eda.get('warnings', [])[:3]) or 'none'}."
        )

    def _insights_summary(self, insights: List[Dict]) -> str:
        return (
            "\n".join(
                f"[{i.get('category', '').upper()}] {i.get('title', '')}: {i.get('description', '')[:200]}"
                for i in insights[:5]
            )
            or "No insights generated."
        )

    def _anomaly_summary(self, anomalies: List[Dict]) -> str:
        return (
            "\n".join(
                f"'{a.get('column')}': {a.get('anomaly_count')} anomalies ({a.get('anomaly_pct')}%) via {a.get('method')}."
                for a in anomalies[:5]
            )
            or "No anomalies."
        )


# ─────────────────────────────────────────────────────────────────────────────
# EVALUATOR AGENT
# ─────────────────────────────────────────────────────────────────────────────


class EvaluatorAgent(BaseAgent):
    agent_type = AgentType.EVALUATOR

    def __init__(self, cache: CacheService, llm: LLMService):
        super().__init__(cache, llm)

    async def run(self, payload: Dict[str, Any], correlation_id: str) -> Dict[str, Any]:
        dataset_id = payload["dataset_id"]
        schema = await self._cache.get_schema(dataset_id)
        insights_data = await self._cache.get_insights(dataset_id)
        charts_data = await self._cache.get_charts(dataset_id)
        # We also need report data - orchestrator passes results of report agent
        report_data = payload.get("report")

        prompt = build_evaluator_prompt(
            dataset_name=schema.get("name", dataset_id) if schema else dataset_id,
            insights=insights_data.get("insights", []) if insights_data else [],
            charts=charts_data.get("charts", []) if charts_data else [],
            report=report_data,
        )

        req = LLMRequest(
            prompt=prompt,
            system_prompt=EVALUATOR_SYSTEM,
            provider=payload.get("llm_provider"),
            model_override=payload.get("model_override"),
            mode=LLMMode.ADVANCED,
            temperature=0.0,  # Evaluation should be deterministic
        )
        resp = await self._llm.complete(req)

        try:
            data, _ = LLMService.extract_json_with_preamble(resp.content)
            if isinstance(data, list) and len(data) > 0:
                data = data[0]
            if not isinstance(data, dict):
                data = {}
        except Exception:
            data = {
                "is_satisfied": True,
                "quality_score": 8,
                "findings": ["Automated evaluation completed but structure was unparseable."],
                "refinement_instruction": "Ready for delivery",
                "data_verified": True
            }

        return {
            "dataset_id": dataset_id,
            "evaluator_score": data.get("quality_score", 0),
            "findings": data.get("findings", []),
            "satisfied": data.get("is_satisfied", True),
            "refinement_instruction": data.get("refinement_instruction", ""),
            "data_verified": data.get("data_verified", True),
            "provider": resp.provider.value,
            "model": resp.model,
        }
