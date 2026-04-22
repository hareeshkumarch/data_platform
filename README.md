# Lumen — Agentic Data Intelligence Platform

Lumen turns raw data into trustworthy insight. A multi-agent pipeline ingests, understands, and visualizes your data; a chat panel lets you ask questions in plain English and verifies the answers with generated code.

> **Stack** · React 18 + Vite 5 + TypeScript · FastAPI (Python 3.11) · PostgreSQL 15 · Unified LLM support (OpenAI · Anthropic · Gemini · **Groq**)

---

## 🚀 Quick Start (Local Dev)

Prerequisites: Python 3.11, Node 20+, PostgreSQL 15+.

```bash
# 1. Clone + Configure
git clone https://github.com/hareeshkumarch/data_platform.git
cd data_platform
cp .env.example .env          # Add OPENAI_API_KEY and/or GROQ_API_KEY

# 2. Backend
pip install -r requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8001

# 3. Frontend (in a second shell)
cd frontend
yarn install
yarn start                    # http://localhost:3000
```

---

## 🧠 Agentic Architecture

Lumen uses a sophisticated multi-agent orchestrator to process data through a specialized pipeline:

1.  **Ingestion Agent**: Loads CSV/JSON/Parquet, infers schema, and performs smart sampling.
2.  **Understanding Agent (EDA)**: Computes summary stats, correlation matrices, and detects anomalies.
3.  **Feature Agent**: Automatically generates derived features (e.g., date parts, log-transforms, scaling).
4.  **Insight Agent**: Uses LLMs to identify trends, outliers, and business-relevant "Aha!" moments.
5.  **Visualization Agent**: Dynamically generates chart configurations (Bar, Line, Scatter, Heatmap, etc.).
6.  **Report Agent**: Synthesizes all previous findings into a structured, executive-ready report.
7.  **Evaluator Agent**: Performs a final quality pass, verifying data consistency and suggesting refinements.

### 💬 Chat & Query Engine
The chat interface uses a **Query Agent** that converts Natural Language to Python/Pandas code. It executes this code in a secure, isolated environment to provide verified answers backed by the actual dataset.

---

## 🎨 Frontend Architecture

The frontend is built for high-performance data density and real-time feedback:

### Core Pages
- **Data Sources**: Unified hub for file uploads (CSV, JSON, Parquet) and dataset management.
- **Query (Chat)**: Natural language interface with streaming responses and interactive code verification.
- **Insights**: Deep-dive exploratory data analysis (EDA) workspace showing correlations and anomalies.
- **Dashboards**: Automated visualization gallery with smart chart selection.
- **Reports**: Long-form structured analysis synthesized by the agent pipeline.
- **Settings**: Global configuration and real-time LLM telemetry.

### Key Components
- **Agent Timeline**: A real-time visualization of the multi-agent pipeline progress via WebSockets.
- **Dynamic Chart Engine**: A robust Recharts-based wrapper that handles automatic scale selection, labeling, and interactivity for 10+ chart types.
- **Data Grid**: High-performance preview component for exploring raw and processed data.
- **Command Palette**: Global shortcut (`Ctrl+K`) for navigation and quick actions.

---

## 📊 Analytics Capabilities

Lumen provides a full spectrum of data intelligence:

- **Descriptive Analytics**: Automated summary statistics, data quality scoring, and distribution profiling.
- **Diagnostic Analytics**: Multi-variable correlation analysis and intelligent anomaly detection (Z-Score/IQR).
- **Time-Series Intelligence**: Trend decomposition, moving averages, and naive 14-day forecasting.
- **Segment Analysis**: Dimension contribution analysis and categorical ranking.
- **Prescriptive Insights**: LLM-generated business recommendations based on discovered patterns.

---

## 🛠️ Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 18, Vite 5, TypeScript, Tailwind CSS, shadcn/ui, Zustand |
| **Backend** | FastAPI, Python 3.11, Pydantic v2 |
| **Agents** | Multi-agent Orchestrator, Pandas, Scipy, Scikit-learn |
| **LLM Integration** | LiteLLM (Unified interface for OpenAI, Anthropic, Gemini, Groq) |
| **Storage** | PostgreSQL 15 (Warehouse), In-memory TTL Cache |
| **Real-time** | Server-Sent Events (SSE) for chat, WebSockets for pipeline |

---

## 🔑 Environment Reference

| Variable | Description |
| :--- | :--- |
| `OPENAI_API_KEY` | Unified key used for OpenAI, Anthropic, and Gemini. |
| `GROQ_API_KEY` | Required for high-speed Llama 3 / Mixtral inference. |
| `DATABASE_URL` | PostgreSQL connection string for the warehouse. |
| `DEFAULT_LLM_PROVIDER` | Initial provider (default: `openai`). |
| `REACT_APP_BACKEND_URL` | Base URL for frontend-to-backend communication. |

---

## 📡 API Reference

### Chat & Pipeline
- `GET /api/v1/chat-stream`: SSE token stream for interactive chat.
- `WS /api/v1/ws/pipeline`: Real-time multi-agent pipeline updates.
- `POST /api/v1/query/{id}`: Execute an NL query against a specific dataset.

### Data Management
- `POST /api/v1/upload-data`: Ingest new files (CSV, JSON, etc.).
- `GET /api/v1/datasets`: List available datasets and their metadata.
- `GET /api/v1/schema/{id}`: View inferred column types and quality scores.

---

## 🧪 Testing
```bash
# Run all backend tests
pytest tests -q

# Run frontend tests
cd frontend && yarn test
```

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
