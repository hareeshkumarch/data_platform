"""WebSocket endpoint for the agent pipeline.

Emits granular stage updates as the multi-agent pipeline runs. The frontend
``runPipeline`` function subscribes to this channel and renders a realtime
timeline with per-stage status, logs and completion metadata.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from backend.services.cache_service import CacheService
from backend.services.llm_service import LLMService
from backend.utils.logger import get_logger

logger = get_logger(__name__)


_PIPELINE_BLUEPRINT: List[Dict[str, Any]] = [
    {
        "id": "ingestion",
        "name": "Ingestion Agent",
        "log": "Validating data source and profiling schema…",
        "detail": "Source validated and schema profiled.",
    },
    {
        "id": "understanding",
        "name": "Understanding Agent",
        "log": "Running statistical profiling and anomaly detection…",
        "detail": "EDA profile complete with quality score.",
    },
    {
        "id": "feature",
        "name": "Feature Agent",
        "log": "Engineering derived features and transformations…",
        "detail": "New features engineered from raw columns.",
    },
    {
        "id": "insight",
        "name": "Insight Agent",
        "log": "Detecting trends, correlations, and anomalies…",
        "detail": "Key insights ranked by business impact.",
    },
    {
        "id": "visualization",
        "name": "Visualization Agent",
        "log": "Selecting optimal chart types and rendering…",
        "detail": "Interactive visualisations rendered.",
    },
    {
        "id": "report",
        "name": "Report Agent",
        "log": "Synthesizing findings into executive narrative…",
        "detail": "Executive report compiled.",
    },
    {
        "id": "evaluator",
        "name": "Evaluator Agent",
        "log": "Evaluating analysis quality and fact-checking…",
        "detail": "Quality evaluation complete.",
    },
]


def _build_agent_summaries(result_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Build structured per-agent summaries from orchestrator result data."""
    summaries: List[Dict[str, Any]] = []

    # --- Ingestion ---
    ing = result_data.get("ingestion", {})
    ing_err = result_data.get("ingestion_error")
    if ing_err:
        summaries.append({"agentId": "ingestion", "agentName": "Ingestion Agent", "status": "error", "headline": "Data ingestion failed", "details": [str(ing_err)]})
    elif ing:
        rows = ing.get("schema", {}).get("row_count", 0)
        cols = ing.get("schema", {}).get("col_count", 0)
        columns = ing.get("schema", {}).get("columns", [])
        numeric_count = sum(1 for c in columns if isinstance(c, dict) and c.get("inferred_type") == "numeric")
        cat_count = sum(1 for c in columns if isinstance(c, dict) and c.get("inferred_type") == "categorical")
        quality = ing.get("schema", {}).get("quality_score", 0)
        details = [f"Loaded **{rows:,}** rows × **{cols}** columns"]
        if numeric_count or cat_count:
            details.append(f"**{numeric_count}** numeric, **{cat_count}** categorical, **{cols - numeric_count - cat_count}** other columns detected")
        if quality:
            details.append(f"Initial quality score: **{quality:.0f}/100**")
        details.append("Schema validated — no structural errors found")
        summaries.append({"agentId": "ingestion", "agentName": "Ingestion Agent", "status": "success", "headline": f"Validated {rows:,} rows across {cols} columns", "details": details})
    else:
        summaries.append({"agentId": "ingestion", "agentName": "Ingestion Agent", "status": "skipped", "headline": "Skipped", "details": []})

    # --- Understanding ---
    und = result_data.get("understanding", {})
    und_err = result_data.get("understanding_error")
    if und_err:
        summaries.append({"agentId": "understanding", "agentName": "Understanding Agent", "status": "error", "headline": "Profiling encountered an error", "details": [str(und_err)]})
    elif und:
        score = und.get("quality_score", "N/A")
        anomalies = und.get("anomalies", [])
        anom_count = len(anomalies) if isinstance(anomalies, list) else 0
        # quality_score is 0-100, not 0-10
        details = [f"Data quality score: **{score}/100**"]
        if anom_count > 0:
            details.append(f"Detected **{anom_count}** anomalies requiring attention")
            for a in anomalies[:3]:
                if isinstance(a, dict):
                    col = a.get("column", "Unknown")
                    method = a.get("method", "")
                    count = a.get("anomaly_count", 0)
                    pct = a.get("anomaly_pct", 0)
                    details.append(f"• **{col}**: {count} outliers ({pct}%) via {method}")
                elif isinstance(a, str):
                    details.append(f"• {a}")
        else:
            details.append("No anomalies detected — data is clean")
        # Correct key: missing_value_report (not missing_summary)
        missing_report = und.get("missing_value_report", {})
        per_col = missing_report.get("per_column", {})
        if per_col:
            top_missing = sorted(per_col.items(), key=lambda x: -x[1].get("pct", 0) if isinstance(x[1], dict) else 0)[:3]
            items = [f"**{k}** ({v.get('pct', 0)}%)" for k, v in top_missing if isinstance(v, dict) and v.get("pct", 0) > 0]
            if items:
                details.append(f"Columns with missing values: {', '.join(items)}")
        completeness = missing_report.get("completeness_pct")
        if completeness is not None:
            details.append(f"Overall completeness: **{completeness}%**")
        summaries.append({"agentId": "understanding", "agentName": "Understanding Agent", "status": "success", "headline": f"Quality {score}/100 — {anom_count} anomalies detected", "details": details})
    else:
        summaries.append({"agentId": "understanding", "agentName": "Understanding Agent", "status": "skipped", "headline": "Skipped", "details": []})

    # --- Feature ---
    feat = result_data.get("feature", {})
    feat_err = result_data.get("feature_error")
    if feat_err:
        summaries.append({"agentId": "feature", "agentName": "Feature Agent", "status": "error", "headline": "Feature engineering failed", "details": [str(feat_err)]})
    elif feat:
        # Agent returns "transformations" (list of strings) not "engineered_features"
        transformations = feat.get("transformations", [])
        new_cols = feat.get("new_columns", 0)
        feat_count = len(transformations) if isinstance(transformations, list) else 0
        details = [f"Applied **{feat_count}** feature transformations"]
        if new_cols:
            details.append(f"Feature space expanded to **{new_cols}** total columns")
        for f_item in (transformations[:5] if isinstance(transformations, list) else []):
            if isinstance(f_item, str):
                details.append(f"• {f_item}")
        summaries.append({"agentId": "feature", "agentName": "Feature Agent", "status": "success", "headline": f"Applied {feat_count} transformations ({new_cols} columns)", "details": details})
    else:
        summaries.append({"agentId": "feature", "agentName": "Feature Agent", "status": "skipped", "headline": "Skipped", "details": []})

    # --- Insight ---
    ins = result_data.get("insight", {})
    ins_err = result_data.get("insight_error")
    if ins_err:
        summaries.append({"agentId": "insight", "agentName": "Insight Agent", "status": "error", "headline": "Insight detection failed", "details": [str(ins_err)]})
    elif ins and ins.get("insights"):
        insights_list = ins.get("insights", [])
        ins_count = len(insights_list) if isinstance(insights_list, list) else 0
        top_insight = insights_list[0] if insights_list else {}
        # Prefer key_finding from improved prompts, fall back to title
        headline = (
            top_insight.get("key_finding")
            or top_insight.get("title")
            or f"Surfaced {ins_count} key insights"
        ) if isinstance(top_insight, dict) else f"Surfaced {ins_count} key insights"
        details = [f"Discovered **{ins_count}** actionable insights ranked by impact"]
        for item in (insights_list[:5] if isinstance(insights_list, list) else []):
            if isinstance(item, dict):
                title = item.get("title", "Insight")
                # Use key_finding for richer detail if available
                finding = item.get("key_finding", item.get("description", ""))
                conf = item.get("confidence")
                line = f"**{title}**"
                if finding:
                    short_desc = finding[:140] + "…" if len(finding) > 140 else finding
                    line += f" — {short_desc}"
                if conf is not None:
                    line += f" (confidence: {conf:.0%})"
                details.append(line)
                # Include business impact if available
                impact = item.get("business_impact")
                if impact:
                    details.append(f"  ↳ Impact: {impact}")
        summaries.append({"agentId": "insight", "agentName": "Insight Agent", "status": "success", "headline": headline, "details": details})
    else:
        summaries.append({"agentId": "insight", "agentName": "Insight Agent", "status": "skipped", "headline": "Skipped", "details": []})

    # --- Visualization ---
    viz = result_data.get("visualization", {})
    viz_err = result_data.get("visualization_error")
    charts = viz.get("charts", []) if isinstance(viz, dict) else []
    chart_count = len(charts) if isinstance(charts, list) else 0
    if viz_err:
        summaries.append({"agentId": "visualization", "agentName": "Visualization Agent", "status": "error", "headline": "Chart generation failed", "details": [str(viz_err)]})
    elif chart_count > 0:
        details = [f"Generated **{chart_count}** interactive charts"]
        for c in (charts[:4] if isinstance(charts, list) else []):
            if isinstance(c, dict):
                ctype = c.get("chart", c.get("type", "chart"))
                ctitle = c.get("title", "Untitled")
                details.append(f"• **{ctitle}** ({ctype})")
        summaries.append({"agentId": "visualization", "agentName": "Visualization Agent", "status": "success", "headline": f"Rendered {chart_count} interactive charts", "details": details})
    else:
        summaries.append({"agentId": "visualization", "agentName": "Visualization Agent", "status": "skipped", "headline": "No charts generated", "details": ["No suitable chart types for this data configuration"]})

    # --- Report ---
    rep = result_data.get("report", {})
    rep_err = result_data.get("report_error")
    if rep_err:
        summaries.append({"agentId": "report", "agentName": "Report Agent", "status": "error", "headline": "Report compilation failed", "details": [str(rep_err)]})
    elif rep:
        sections = rep.get("sections", [])
        sec_count = len(sections) if isinstance(sections, list) else 0
        # Prefer executive_headline from improved prompts
        exec_headline = rep.get("executive_headline", "")
        headline = exec_headline if exec_headline else f"Executive report compiled — {sec_count} sections"
        details = [f"Compiled **{sec_count}** report sections"]
        for sec in (sections[:4] if isinstance(sections, list) else []):
            if isinstance(sec, dict):
                sec_title = sec.get('title', 'Section')
                key_metric = sec.get('key_metric', '')
                if key_metric:
                    details.append(f"• **{sec_title}** — {key_metric}")
                else:
                    details.append(f"• {sec_title}")
        if rep.get("executive_summary"):
            summary_text = rep["executive_summary"]
            short = summary_text[:150] + "…" if len(summary_text) > 150 else summary_text
            details.append(f"Executive summary: {short}")
        summaries.append({"agentId": "report", "agentName": "Report Agent", "status": "success", "headline": headline, "details": details})
    else:
        summaries.append({"agentId": "report", "agentName": "Report Agent", "status": "skipped", "headline": "Skipped", "details": []})

    # --- Evaluator ---
    eva = result_data.get("evaluator", {})
    eva_err = result_data.get("evaluator_error")
    if eva_err:
        summaries.append({"agentId": "evaluator", "agentName": "Evaluator Agent", "status": "error", "headline": "Evaluation failed", "details": [str(eva_err)]})
    elif eva:
        score = eva.get("evaluator_score", 0)
        satisfied = eva.get("satisfied", True)
        status = "success" if satisfied else "warning"
        headline = f"Quality score: {score}/10 — {eva.get('refinement_instruction', 'Ready')}"
        details = [f"LLM-based quality evaluation: **{score}/10**"]
        findings = eva.get("findings", [])
        if findings:
            for f in findings:
                details.append(f"• {f}")
        if not satisfied:
            details.append(f"⚠️ **Refinement suggested**: {eva.get('refinement_instruction')}")
        summaries.append({"agentId": "evaluator", "agentName": "Evaluator Agent", "status": status, "headline": headline, "details": details})
    else:
        summaries.append({"agentId": "evaluator", "agentName": "Evaluator Agent", "status": "skipped", "headline": "Skipped", "details": []})

    return summaries


def register_websockets(app: FastAPI) -> None:
    """Attach realtime endpoints to the provided FastAPI instance."""

    @app.websocket("/api/v1/ws/pipeline")
    async def pipeline_ws(websocket: WebSocket) -> None:
        await websocket.accept()
        try:
            payload = await websocket.receive_json()
        except Exception as exc:  # pragma: no cover
            await websocket.send_json(
                {"type": "error", "message": f"Invalid request: {exc}"}
            )
            await websocket.close()
            return

        prompt = (payload.get("prompt") or "").strip()
        if not prompt:
            await websocket.send_json({"type": "error", "message": "Missing prompt."})
            await websocket.close()
            return

        stages = [dict(s, status="pending") for s in _PIPELINE_BLUEPRINT]

        async def send_snapshot(current_idx: int, running: bool = True) -> None:
            for idx, stage in enumerate(stages):
                if idx < current_idx:
                    stage["status"] = "done"
                elif idx == current_idx:
                    stage["status"] = "running" if running else "done"
                else:
                    stage["status"] = "pending"
            await websocket.send_json({"type": "stage", "stages": stages})

        started = time.perf_counter()
        cache = CacheService()
        llm = LLMService(cache)
        from backend.services.vector_service import VectorService
        from backend.services.storage_service import StorageService

        vector = VectorService()
        storage = StorageService()

        from backend.agents.orchestrator.orchestrator_agent import OrchestratorAgent

        orchestrator = OrchestratorAgent(cache, llm, vector, storage)

        async def stage_cb(stage_info: Dict[str, Any]) -> None:
            pct = stage_info.get("progress", 0.0)
            # Map progress 0-100 to index 0-6 (for 7 stages)
            current_idx = min(len(stages) - 1, int(pct / (100.0 / len(stages))))
            await send_snapshot(current_idx, running=True)

        orchestrator.progress_cb = stage_cb

        try:
            await send_snapshot(0, running=True)

            result = await orchestrator.execute(
                payload, payload.get("correlation_id", str(uuid.uuid4()))
            )

            reply = ""
            per_agent_summary: List[Dict[str, Any]] = []

            if result.success and result.data:
                mode = payload.get("mode", "full")

                if mode == "upload":
                    ingestion_data = result.data.get("ingestion", {})
                    schema = ingestion_data.get("schema", {})
                    rows = schema.get("row_count", 0)
                    cols = schema.get("col_count", 0)
                    reply = f"Dataset ingested successfully. Profiling complete: {rows:,} rows across {cols} columns."
                elif mode == "process":
                    reply = "Data processed and features engineered successfully."
                elif mode in ["full", "insights", "report", "dashboard"]:
                    # Build clean executive summary as the main reply
                    rep_data = result.data.get("report", {})
                    rep_err = result.data.get("report_error")
                    sections = rep_data.get("sections", [])

                    if rep_err:
                        reply = f"> ⚠️ **Report Generation Error:** {rep_err}"
                    elif sections:
                        reply = "\n\n".join(
                            f"#### {sec.get('title')}\n{sec.get('content')}"
                            for sec in sections
                        )
                    elif rep_data.get("executive_summary"):
                        reply = rep_data["executive_summary"]
                    else:
                        reply = "Analysis completed successfully."

                    # Build structured per-agent summaries
                    per_agent_summary = _build_agent_summaries(result.data)
                else:
                    reply = "Pipeline completed successfully."
            else:
                reply = f"Pipeline encountered an issue: {result.error or 'Unknown error'}"

            # Show 100% done
            await send_snapshot(len(stages), running=False)

            elapsed_ms = round((time.perf_counter() - started) * 1000, 1)

            await websocket.send_json(
                {
                    "type": "complete",
                    "reply": reply,
                    "dataset_id": result.data.get("dataset_id") if result.data else None,
                    "charts": result.data.get("visualization", {}).get("charts", []) if result.data else [],
                    "per_agent_summary": per_agent_summary,
                    "elapsed_ms": elapsed_ms,
                    "run_id": str(uuid.uuid4()),
                }
            )
        except WebSocketDisconnect:
            return
        except Exception as exc:
            logger.error("pipeline ws failed", error=str(exc))
            try:
                await websocket.send_json({"type": "error", "message": str(exc)})
            except Exception:
                pass
        finally:
            try:
                await websocket.close()
            except Exception:
                pass

    @app.websocket("/api/v1/ws/chat")
    async def chat_ws(websocket: WebSocket) -> None:
        """Stream chat tokens over a websocket (used as a fallback)."""
        await websocket.accept()
        try:
            payload = await websocket.receive_json()
        except Exception:
            await websocket.close()
            return
        prompt = (payload.get("prompt") or "").strip()
        if not prompt:
            await websocket.send_json({"type": "error", "message": "Missing prompt"})
            await websocket.close()
            return

        cache = CacheService()
        llm = LLMService(cache)
        try:
            from backend.models.schemas import LLMMode, LLMRequest

            request = LLMRequest(
                prompt=prompt,
                system_prompt="You are Lumen, an AI data analyst.",
                provider=payload.get("provider"),
                model_override=payload.get("model"),
                mode=LLMMode.FAST,
            )
            async for token in llm.stream_complete(request):
                await websocket.send_json({"type": "token", "value": token})
            await websocket.send_json({"type": "done"})
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.error("chat ws failed", error=str(exc))
            try:
                await websocket.send_json({"type": "error", "message": str(exc)})
            except Exception:
                pass
        finally:
            try:
                await websocket.close()
            except Exception:
                pass
