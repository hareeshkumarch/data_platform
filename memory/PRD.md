# Lumen — Data Intelligence Platform

Last updated: 2026-02 — initial production wire-up complete.

## Problem Statement

Lumen is a full-stack data intelligence platform. The original repo at
<https://github.com/hareeshkumarch/data_platform> shipped with rich UI and a
mock/stub backend. The task was to:

1. Wire the React + TypeScript frontend to the FastAPI backend with no mocks.
2. Replace placeholder LLM providers with a real, switchable setup (OpenAI +
   Anthropic via the Emergent universal key).
3. Add a PostgreSQL-backed SQL executor and persistent dataset registry.
4. Ship a real multi-agent pipeline driven over WebSocket.
5. Deliver a polished, responsive UI for chat, pipeline timeline, dashboards,
   insights, data sources, reports and settings.

## Architecture

- **Frontend**: React 18 + Vite 5 + TypeScript + Tailwind + shadcn/ui + zustand +
  react-query + recharts. `start` script runs vite on :3000 (supervisor).
- **Backend**: FastAPI on :8001 (supervisor). All routes under `/api/v1/*`.
- **Task runner**: in-process asyncio background runner (`backend/tasks/celery_app.py`)
  exposes a Celery-compatible surface so existing call sites keep working.
- **Cache**: in-memory TTL store (`backend/services/cache_service.py`).
- **LLM**: `backend/services/llm_service.py` wraps `emergentintegrations`. The
  universal key covers OpenAI / Anthropic / Gemini.
- **SQL warehouse**: PostgreSQL via SQLAlchemy (`backend/services/sql_service.py`),
  seeds a `sales_performance` table, plus a restricted SELECT/WITH executor.
- **Realtime**: WebSocket `/api/v1/ws/pipeline` drives the agent timeline;
  `/api/v1/ws/chat` optional token stream.
- **Persistence**: Postgres `datasets` & `conversations` tables for durable state.

## What's implemented (2026-02)

- Full React UI — Insights, Data Sources, Query, Dashboards, Reports, Settings.
- Chat streaming via `/api/v1/chat-stream` (SSE) with provider/model selection.
- Agent pipeline via `/api/v1/ws/pipeline` with 5 stages and realtime updates.
- Dataset upload + demo seed via `/api/v1/datasets/seed-demo`.
- Dataset preview, schema, exports (CSV/XLSX), pipeline processors.
- SQL warehouse endpoints (`/api/v1/warehouse/tables`, `/warehouse/query`).
- Settings page: provider switcher, model picker, masked key display,
  temperature & max tokens, persisted to localStorage + backend `/settings`.
- System stats endpoint `/api/v1/system/stats` + `/api/v1/metrics/llm` for
  live LLM telemetry on the Settings page.
- Theme persistence (light/dark) — syncs across reloads.

## Outstanding / Backlog

### P1

- Conversation persistence — currently localStorage only, schema ready in
  Postgres `conversations` table.
- GitHub Actions workflow (lint + pytest).
- Pytest tests for backend routes + vitest for the integration layer.
- Docker image optimisation (multi-stage build, slim base).

### P2

- Streaming token chunks from actual LLM (requires litellm `stream=True`).
- Rate limiting on LLM endpoints.
- Full report export to PDF.
- Admin-level observability dashboard.

## Next Actions

- CI workflow (`.github/workflows/ci.yml`).
- Vitest tests covering `api-client` + `query-api`.
- Push to `origin/main` of the source repo.
