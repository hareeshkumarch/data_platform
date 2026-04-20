# Lumen — Frontend ↔ Backend Integration Guide

This document is the **single source of truth** for backend engineers wiring real services to the Lumen frontend.

The frontend is intentionally structured so that **all backend touchpoints are isolated to two files**. You should not need to touch React components, stores, or pages.

---

## TL;DR — What you need to implement

| What | Where to plug it in | Contract |
|------|---------------------|----------|
| Chat streaming | `frontend/src/lib/query-api.ts` → `streamChatReply` | Token stream → `onToken(partial, done)` |
| Agent pipeline | `frontend/src/lib/query-api.ts` → `runPipeline` | Stage events → `onStage(stages)`, then `onComplete(reply)` |
| Dataset rows (charts) | `frontend/src/lib/datasets.ts` → `loader` per dataset | `() => Promise<Row[]>` |
| LLM keys / model config | Backend secrets + Edge Function | Never store in frontend |

Everything else (UI, state, animations, history persistence) is already wired and reactive.

---

## Project stack

- **React 18 + Vite 5 + TypeScript 5**
- **Tailwind CSS v3** with semantic HSL design tokens (`frontend/src/index.css`, `frontend/tailwind.config.ts`)
- **Zustand** (with `persist`) for state — `frontend/src/store/`
- **shadcn/ui** + **lucide-react** + **Recharts**

## Running Locally

### Using Docker (Recommended)
The platform is fully dockerized for ease of use and production-readiness. To build and start the environment:
```bash
docker compose up -d --build
```
The application will be accessible at your defined local port (defaults typically to `http://localhost:80` or `http://localhost:3000`).

### Manual Setup (Development)
If you need to run the development server directly for UI modifications:
```bash
cd frontend
npm install
npm run dev
```

---

## Architecture overview

```
┌──────────────────────────────────────────────────────────┐
│ Pages (frontend/src/pages/*.tsx)                         │
│ Query, Dashboards, Insights, DataSources, Reports, …     │
└─────────────────┬────────────────────────────────────────┘
                  │  read/write
                  ▼
┌──────────────────────────────────────────────────────────┐
│ Stores (Zustand, persisted to localStorage)              │
│   frontend/src/store/useAppStore.ts    — theme, etc      │
│   frontend/src/store/useQueryStore.ts  — conversations   │
└─────────────────┬────────────────────────────────────────┘
                  │  call
                  ▼
┌──────────────────────────────────────────────────────────┐
│ Integration layer (THE ONLY THING YOU EDIT)              │
│   frontend/src/lib/query-api.ts   — chat + agent         │
│   frontend/src/lib/datasets.ts    — chart data loaders   │
└─────────────────┬────────────────────────────────────────┘
                  │  HTTPS / SSE / WebSocket
                  ▼
              YOUR BACKEND
```

**Golden rule:** UI components never call `fetch` directly. Always go through the integration layer.

---

## 1. Chat & Agent Pipeline — `frontend/src/lib/query-api.ts`

This file exposes two functions and a few types. The Query page (`frontend/src/pages/Query.tsx`) calls them and pipes events into the conversation store.

### Types

```ts
export type QueryMode = "chat" | "pipeline";
export type StageStatus = "pending" | "running" | "done";

export interface PipelineStage {
  id: string;            // "data" | "reason" | "viz" | "verify"
  name: string;
  icon: LucideIcon;
  status: StageStatus;
  detail?: string;       // shown when done
  log: string;           // shown while running
}

export interface QueryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  datasetId?: string;    // matches an id in datasets.ts → renders a chart
  streaming?: boolean;
  pipeline?: PipelineStage[];
  mode: QueryMode;
}
```

### 1a. `streamChatReply` — token streaming

**Current (mock):** `setInterval` pushes characters from a hardcoded string.

**Required signature — DO NOT CHANGE:**
```ts
streamChatReply(
  prompt: string,
  onToken: (partial: string, done: boolean) => void,
): () => void  // returns a cancel function
```

**Reference implementation (SSE / fetch streaming):**
```ts
export const streamChatReply = (prompt, onToken) => {
  const ctrl = new AbortController();
  let acc = "";

  fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal: ctrl.signal,
  }).then(async (res) => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) { onToken(acc, true); break; }
      acc += decoder.decode(value);
      onToken(acc, false);
    }
  }).catch(() => onToken(acc, true));

  return () => ctrl.abort();
};
```

**Backend contract for `POST /api/chat`:**
- Request: `{ "prompt": string, "conversationId"?: string }`
- Response: `text/event-stream` OR plain chunked text — the frontend treats the body as an incremental string accumulator.

### 1b. `runPipeline` — multi-agent execution

**Required signature — DO NOT CHANGE:**
```ts
runPipeline(
  prompt: string,
  onStage: (stages: PipelineStage[]) => void,
  onComplete: (reply: string) => void,
): () => void
```

**Stage progression rules** the UI relies on:
1. Emit the full `PipelineStage[]` array on every change (not deltas).
2. Exactly one stage at a time should be `running`.
3. Once a stage is `done`, set its `detail` to a short human summary (e.g. `"3 drivers identified"`).
4. After the final stage flips to `done`, call `onComplete(finalText)` — the page will then stream that text into the message.

**Reference implementation (WebSocket):**
```ts
export const runPipeline = (prompt, onStage, onComplete) => {
  const ws = new WebSocket(`${WS_BASE}/pipeline`);
  ws.onopen = () => ws.send(JSON.stringify({ prompt }));
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "stage") onStage(msg.stages);
    if (msg.type === "complete") { onComplete(msg.reply); ws.close(); }
  };
  return () => ws.close();
};
```

**Backend WebSocket message shapes:**
```jsonc
// stage update
{ "type": "stage", "stages": [{ "id": "data", "name": "Data Agent",
                                "status": "running", "log": "Loading rows…" }, …] }

// final
{ "type": "complete", "reply": "All four agents completed…" }
```

> ⚠️ Keep the four canonical stage `id`s (`data`, `reason`, `viz`, `verify`) so the existing icons render correctly. To add a new agent, also add it to `PIPELINE_BLUEPRINT` in `query-api.ts`.

---

## 2. Datasets & Charts — `frontend/src/lib/datasets.ts`

The frontend has a **dataset registry**. Each dataset declares where it comes from and exposes a loader. `ChartViewer` uses the registry to render a chart with selectable type.

### Mock Data & Schemas
> 💡 **For Backend Engineers:** The application currently relies on a comprehensive set of dummy data located in `frontend/src/lib/mock-data.ts`. This file exports the exact data structures and shape arrays used by the Dashboards and Reports pages (e.g., `revenueTrend`, `churnTrend`, `segmentBreakdown`). You can consult `mock-data.ts` to see the exact TypeScript structures and JSON payloads your APIs must replicate.

### Adding a real dataset

```ts
{
  id: "revenue_trend",
  label: "Revenue trend",
  description: "Monthly revenue vs. forecast",
  source: "warehouse",                    // "warehouse" | "rest_api" | "file"
  supportedCharts: ["area", "line", "bar"],
  spec: {
    xKey: "month",
    series: [
      { dataKey: "revenue",  label: "Revenue",  color: "hsl(var(--accent))" },
      { dataKey: "forecast", label: "Forecast", color: "hsl(var(--clay))" },
    ],
    data: [],                             // can stay empty; loader fills it
  },
  loader: async () => {
    const res = await fetch("/api/datasets/revenue_trend");
    return res.json();                    // must be Row[]
  },
},
```

**Row shape:** any `Record<string, unknown>` whose keys match `xKey` and each `series.dataKey`.

**Loader rules:**
- Must return `Promise<Row[]>`.
- Should be idempotent (called on dataset switch).
- Throw to surface errors — `ChartViewer` will keep the previous rows.

### Different sources

| Source kind | Suggested backend route |
|-------------|-------------------------|
| `warehouse` | `POST /api/warehouse/query` with SQL or a saved-query id |
| `rest_api`  | `GET  /api/datasets/:id`                                  |
| `file`      | `GET  /api/files/:id/rows`                                |

The `source` field only drives the icon + label in the chart card. The loader is what actually runs.

---

## 3. State stores — read-only for backend devs

You shouldn't need to modify these, but understanding them helps debugging.

### `frontend/src/store/useQueryStore.ts`
Holds **all conversations**. Persisted to `localStorage` under `lumen-query-state`.

```ts
{
  conversations: Conversation[],
  activeId: string | null,
  mode: "chat" | "pipeline",
  // actions: newConversation, selectConversation, deleteConversation,
  //          appendMessage, updateLastMessage, renameFromFirstMessage
}
```

If you later move history to a backend, replace the `persist` middleware with a sync layer — the action surface stays identical.

### `frontend/src/store/useAppStore.ts`
Theme, sidebar, global search, active dataset id.

---

## 4. Settings page — LLM keys & model config

The Settings page (`frontend/src/pages/Settings.tsx`) is the UI for configuring providers and models. **Never store private API keys in the frontend.**

Recommended flow:
1. Set up a secure backend.
2. Store provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) securely on your backend.
3. Expose an endpoint (`/api/llm/chat`) that reads the secret server-side and proxies to the provider.
4. The Settings page should only display **masked status** (`••••••••3f2a`) and selected model — never the raw key.

Backend metrics shown on Settings (LLM call count, tokens, latency) should come from a `/api/metrics/llm` endpoint returning:
```jsonc
{
  "calls_24h": 1284,
  "tokens_in": 482103,
  "tokens_out": 91220,
  "avg_latency_ms": 642,
  "errors_24h": 3
}
```

---

## 5. Auth (when you add it)

Add an `apiClient` wrapper at `frontend/src/lib/api/client.ts`:
```ts
export const api = (path: string, init: RequestInit = {}) =>
  fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
```
Then refactor `query-api.ts` and dataset loaders to use it. **Do not import auth logic into components.**

---

## 6. End-to-end checklist

Before you ship a backend integration, verify:

- [ ] `streamChatReply` streams tokens visibly in the Query page (chat mode).
- [ ] `runPipeline` advances stages one at a time and finishes with the reply.
- [ ] Each dataset in `datasets.ts` has a working `loader` and renders in `ChartViewer`.
- [ ] Switching the chart type (line/bar/area) still works.
- [ ] Conversation history persists across page reloads (already wired via Zustand).
- [ ] No private API keys appear in `import.meta.env` or the browser bundle.
- [ ] `npm run build` (inside the `frontend` folder) passes with no TypeScript errors.

---

## 7. Folder map (for orientation)

All frontend application code is encapsulated within the `frontend/` directory to separate it from backend or platform-level deployment configurations.

```
frontend/src/
├── lib/
│   ├── query-api.ts        ← EDIT: chat + pipeline integration
│   ├── datasets.ts         ← EDIT: chart data loaders
│   ├── mock-data.ts        ← seed/mock fallback
│   └── utils.ts
├── store/
│   ├── useAppStore.ts      ← global UI state
│   └── useQueryStore.ts    ← conversation history
├── components/
│   ├── query/QueryHistory.tsx
│   ├── charts/ChartViewer.tsx, DynamicChart.tsx
│   ├── agents/AgentTimeline.tsx
│   ├── layout/{AppShell,AppSidebar,TopBar}.tsx
│   └── ui/                 ← shadcn primitives (don't modify)
├── pages/
│   ├── Query.tsx           ← chat + agent pipeline UI
│   ├── Dashboards.tsx
│   ├── Insights.tsx
│   ├── DataSources.tsx
│   ├── Reports.tsx
│   └── Settings.tsx        ← LLM/model/key config UI
└── index.css               ← design tokens (HSL only)
```

---

## Questions?

Open an issue or ping the frontend team. As long as you respect the function signatures in `query-api.ts` and `datasets.ts`, the rest of the app will pick up your backend with zero UI changes.
