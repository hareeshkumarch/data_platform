# Lumen — Agentic Data Intelligence Platform

Lumen turns raw data into trustworthy insight. A multi-agent pipeline ingests,
understands, and visualises your data; a chat panel lets you ask questions in
plain English and verifies the answers with generated code.

> **Stack** · React 18 + Vite 5 + TypeScript · FastAPI (Python 3.11) ·
> PostgreSQL · Emergent universal LLM key (OpenAI · Anthropic · Gemini)

---

## Quick start (local dev)

Prerequisites: Python 3.11, Node 20+, PostgreSQL 14+.

```bash
# 1. Clone + configure
git clone https://github.com/hareeshkumarch/data_platform.git
cd data_platform
cp .env.example .env          # fill in EMERGENT_LLM_KEY

# 2. Backend
pip install -r requirements.txt
pip install emergentintegrations --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/
uvicorn backend.main:app --host 0.0.0.0 --port 8001

# 3. Frontend (in a second shell)
cd frontend
yarn install
yarn start                    # http://localhost:3000
```

## Quick start (Docker)

```bash
cp .env.example .env          # fill in EMERGENT_LLM_KEY
docker compose up -d --build
```

- Frontend: <http://localhost:3000>
- Backend:  <http://localhost:8001/docs>

Every service has a `healthcheck` and only becomes ready when the downstream
services are healthy.

---

## Architecture

```
┌───────────────────────── React (Vite) ─────────────────────────┐
│  pages/*.tsx  →  store/* (zustand)  →  lib/query-api.ts +      │
│                                        lib/datasets.ts         │
└─────────────────────────────┬──────────────────────────────────┘
                              │ HTTPS · SSE · WS
                              ▼
┌───────────────────────── FastAPI backend ──────────────────────┐
│ /api/v1/*        endpoints.py, warehouse.py, websocket.py      │
│ LLM              services/llm_service.py  (emergentintegrations)│
│ Cache            services/cache_service.py (in-memory TTL)     │
│ Tasks            tasks/celery_app.py       (asyncio runner)    │
│ Agents           agents/* (ingest → EDA → insight → viz → rpt) │
│ SQL              services/sql_service.py   (Postgres)          │
└─────────────────────────────┬──────────────────────────────────┘
                              │
                              ▼
                          PostgreSQL
```

- **Chat streaming** — `GET /api/v1/chat-stream?prompt=...` returns an SSE
  stream. The frontend accumulates tokens via `streamChatReply` in
  `frontend/src/lib/query-api.ts`.
- **Agent pipeline** — `WS /api/v1/ws/pipeline` emits `stage` frames and a
  final `complete` frame. Consumed by `runPipeline` in the same file.
- **SQL executor** — `POST /api/v1/warehouse/query` runs read-only SQL against
  the seeded `sales_performance` table.

---

## Environment reference

| Variable | Default | Description |
|----------|---------|-------------|
| `EMERGENT_LLM_KEY` | — | Universal key covering OpenAI / Anthropic / Gemini. |
| `DEFAULT_LLM_PROVIDER` | `openai` | Initial provider when no client choice exists. |
| `DEFAULT_LLM_MODEL` | `gpt-5.2` | Default model for the initial provider. |
| `DATABASE_URL` | `postgresql+psycopg2://postgres:postgres@localhost:5432/lumen` | SQL warehouse + persistence. |
| `MONGO_URL` | `mongodb://localhost:27017` | Optional — conversation persistence. |
| `REACT_APP_BACKEND_URL` | `http://localhost:8001` | Used by the frontend to build every API URL. |
| `LLM_TEMPERATURE` | `0.15` | Backend default generation temperature. |
| `LLM_MAX_TOKENS` | `4096` | Backend default completion cap. |
| `MAX_UPLOAD_SIZE_MB` | `500` | Hard limit for `/api/v1/upload-data`. |
| `ENABLE_PROMETHEUS` | `false` | Start the Prometheus exporter on `:9090`. |

---

## API reference (most-used routes)

### Chat & pipeline

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/chat` | Single-shot completion. |
| `GET`  | `/api/v1/chat-stream` | SSE token stream. |
| `WS`   | `/api/v1/ws/pipeline` | Multi-agent pipeline. |
| `WS`   | `/api/v1/ws/chat` | Websocket token stream. |

### Data + analytics

| Method | Path |
|--------|------|
| `POST` | `/api/v1/upload-data` |
| `POST` | `/api/v1/datasets/seed-demo` |
| `GET`  | `/api/v1/datasets` |
| `GET`  | `/api/v1/datasets/{id}/preview` |
| `GET`  | `/api/v1/schema/{id}` |
| `POST` | `/api/v1/process-data/{id}` |
| `POST` | `/api/v1/analytics/{id}` |
| `POST` | `/api/v1/generate-insights/{id}` |
| `POST` | `/api/v1/query/{id}` |
| `POST` | `/api/v1/chart/generate` |
| `POST` | `/api/v1/dashboard/{id}` |

### Warehouse (Postgres)

| Method | Path |
|--------|------|
| `GET`  | `/api/v1/warehouse/tables` |
| `GET`  | `/api/v1/warehouse/tables/{name}` |
| `POST` | `/api/v1/warehouse/query` |

### Settings

| Method | Path |
|--------|------|
| `GET`  | `/api/v1/settings/providers` |
| `POST` | `/api/v1/settings` |
| `GET`  | `/api/v1/system/stats` |
| `GET`  | `/api/v1/metrics/llm` |

Full interactive docs at `GET /docs` (Swagger) and `GET /redoc`.

---

## Frontend integration layer

Everything the frontend sends to the backend goes through two files:

- `frontend/src/lib/api-client.ts` — `apiFetch`, `pollTask`, `API_BASE`.
- `frontend/src/lib/query-api.ts` — `streamChatReply`, `runPipeline`,
  `getLlmPreference`, `setLlmPreference`.

UI components never call `fetch` directly — swap or augment these modules to
point at a different backend without touching a single component.

---

## Testing

```bash
# Backend
pytest tests -q

# Frontend
cd frontend && yarn test
```

The GitHub Actions workflow at `.github/workflows/ci.yml` runs both suites on
every push.

---

## Contributing

1. Fork & create a feature branch.
2. Follow the existing structure — put new endpoints in
   `backend/api/routes/` and keep UI state in `frontend/src/store/`.
3. Add tests for new logic in `tests/` or `frontend/src/test/`.
4. Open a PR — CI must stay green.

## License

Internal — see repository for details.
