/**
 * Query API — the single integration surface for the Query page.
 *
 * The Query page calls ``streamChatReply`` and ``runPipeline`` and pipes
 * events into the conversation store. Both functions talk directly to the
 * FastAPI backend with no mocks.
 */

import { BrainCircuit, ChartSpline, Database, ShieldCheck, Sparkles } from "lucide-react";

import { API_BASE, apiFetch, pollTask, wsUrl } from "./api-client";

export type QueryMode = "chat" | "pipeline";
export type StageStatus = "pending" | "running" | "done";

export interface PipelineStage {
  id: string;
  name: string;
  icon: typeof Database;
  status: StageStatus;
  detail?: string;
  log: string;
}

export interface AgentSummary {
  agentId: string;
  agentName: string;
  status: "success" | "error" | "skipped";
  headline: string;
  details: string[];
}

export interface QueryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  datasetId?: string;
  streaming?: boolean;
  pipeline?: PipelineStage[];
  agentSummaries?: AgentSummary[];
  mode: QueryMode;
  rows?: Record<string, unknown>[];
  charts?: any[];
  /** Model id used to generate the reply (shown as a transparency badge). */
  model?: string;
}

export interface Conversation {
  id: string;
  title: string;
  mode: QueryMode;
  updatedAt: number;
  messages: QueryMessage[];
}

/* ---------------- Pipeline blueprint ---------------- */

export const PIPELINE_BLUEPRINT: Omit<PipelineStage, "status">[] = [
  { id: "ingestion", name: "Ingestion Agent", icon: Database, log: "Validating data source and profiling schema…", detail: "Source validated" },
  { id: "understanding", name: "Understanding Agent", icon: BrainCircuit, log: "Running statistical profiling and anomaly detection…", detail: "EDA profile complete" },
  { id: "feature", name: "Feature Agent", icon: Sparkles, log: "Engineering derived features and transformations…", detail: "Features engineered" },
  { id: "insight", name: "Insight Agent", icon: Sparkles, log: "Detecting trends, correlations, and anomalies…", detail: "Insights surfaced" },
  { id: "visualization", name: "Visualization Agent", icon: ChartSpline, log: "Selecting optimal chart types and rendering…", detail: "Charts rendered" },
  { id: "report", name: "Report Agent", icon: ShieldCheck, log: "Synthesizing findings into executive narrative…", detail: "Report compiled" },
  { id: "evaluator", name: "Evaluator Agent", icon: Sparkles, log: "Evaluating analysis quality and fact-checking…", detail: "Quality validated" },
];

const iconForStage = (id: string) => {
  const known = PIPELINE_BLUEPRINT.find((s) => s.id === id);
  return known?.icon ?? Database;
};

export const newPipeline = (): PipelineStage[] =>
  PIPELINE_BLUEPRINT.map((s) => ({ ...s, status: "pending", detail: undefined }));

/* ---------------- LLM preferences ---------------- */

export interface LlmPreference {
  provider?: string;
  model?: string;
}

const STORAGE_KEY = "lumen-llm-preference";

/** Read the currently-selected LLM provider/model from localStorage. */
export const getLlmPreference = (): LlmPreference => {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as LlmPreference) : {};
  } catch {
    return {};
  }
};

/** Persist the user's provider/model selection. */
export const setLlmPreference = (pref: LlmPreference): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pref));
  } catch {
    /* ignore storage errors */
  }
};

/* ---------------- Chat streaming ---------------- */

/**
 * Stream a chat reply token-by-token.
 *
 * - When a dataset is selected, routes through `/api/v1/query/{id}` which
 *   runs the agentic query pipeline and returns a verified answer.
 * - Otherwise streams raw tokens from the SSE chat endpoint.
 */
export const streamChatReply = (
  prompt: string,
  datasetId: string,
  onToken: (partial: string, done: boolean, rows?: Record<string, unknown>[]) => void,
): (() => void) => {
  const ctrl = new AbortController();
  const hasDataset = Boolean(datasetId) && datasetId !== "Select dataset";
  const pref = getLlmPreference();

  if (hasDataset) {
    apiFetch<{ task_id: string }>(`/query/${datasetId}`, {
      method: "POST",
      body: JSON.stringify({
        question: prompt,
        output_format: "table",
        llm_provider: pref.provider,
        model_override: pref.model,
      }),
      signal: ctrl.signal,
    })
      .then(async (data) => {
        onToken("Running query agents…", false);
        interface QueryResult {
          dataset_id: string;
          plan?: { explanation?: string };
          result?: { rows?: Record<string, unknown>[]; error?: string };
          // Legacy support for older structures if they exist
          data?: { 
            plan?: { explanation?: string };
            result?: { rows?: Record<string, unknown>[]; error?: string };
          };
        }
        const raw = (await pollTask<QueryResult>(data.task_id)) as QueryResult;
        
        // Robust extraction from multiple possible nesting levels
        const res = raw?.result || raw?.data?.result;
        const plan = raw?.plan || raw?.data?.plan;
        
        const rows = (res?.rows ?? []) as Record<string, unknown>[];
        let explanation = plan?.explanation || "No explanation returned.";

        // If we have an error but no explanation, show the error
        if (res?.error && explanation === "No explanation returned.") {
          explanation = `I encountered a problem analyzing the data: ${res.error}`;
        }

        onToken(explanation, true, rows);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") onToken(`I couldn't run the query: ${err.message}`, true);
      });
    return () => ctrl.abort();
  }

  (async () => {
    try {
      const params = new URLSearchParams({ prompt });
      if (pref.provider) params.set("provider", pref.provider);
      if (pref.model) params.set("model", pref.model);
      const response = await fetch(`${API_BASE}/chat-stream?${params.toString()}`, {
        signal: ctrl.signal,
        headers: { Accept: "text/event-stream" },
      });
      if (!response.body) throw new Error("Streaming is unavailable.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") {
            onToken(accumulated, true);
            return;
          }
          try {
            const parsed = JSON.parse(payload) as { token?: string; error?: string };
            if (parsed.token) {
              accumulated += parsed.token;
              onToken(accumulated, false);
            } else if (parsed.error) {
              onToken(`Error: ${parsed.error}`, true);
              return;
            }
          } catch {
            /* ignore malformed keepalive */
          }
        }
      }
      onToken(accumulated, true);
    } catch (err) {
      const error = err as Error;
      if (error.name !== "AbortError") onToken(`Error: ${error.message}`, true);
    }
  })();

  return () => ctrl.abort();
};

/* ---------------- Pipeline (realtime WebSocket) ---------------- */

/**
 * Run the multi-agent pipeline via a server-driven WebSocket.
 * Built with auto-reconnection and exponential backoff.
 */
export const runPipeline = (
  prompt: string,
  datasetId: string,
  onStage: (stages: PipelineStage[]) => void,
  onComplete: (reply: string, datasetId?: string, charts?: any[], agentSummaries?: AgentSummary[]) => void,
): (() => void) => {
  let active = true;
  let socket: WebSocket | null = null;
  let reconnectAttempts = 0;
  let reconnectTimeout: ReturnType<typeof setTimeout>;

  const connect = () => {
    if (!active) return;
    try {
      socket = new WebSocket(wsUrl("/api/v1/ws/pipeline"));
    } catch {
      onComplete("Realtime pipeline unavailable on this environment.");
      return;
    }

    const pref = getLlmPreference();
    socket.onopen = () => {
      if (!active || !socket) return;
      reconnectAttempts = 0; // Reset on successful connect
      socket.send(
        JSON.stringify({
          prompt,
          dataset_id: datasetId && datasetId !== "Select dataset" ? datasetId : "",
          provider: pref.provider,
          model: pref.model,
        }),
      );
    };

    socket.onmessage = (event) => {
      if (!active) return;
      try {
        const msg = JSON.parse(event.data) as {
          type: string;
          stages?: Array<{ id: string; name: string; status: StageStatus; log?: string; detail?: string }>;
          reply?: string;
          message?: string;
        };
        if (msg.type === "stage" && msg.stages) {
          const mapped: PipelineStage[] = msg.stages.map((s) => ({
            id: s.id,
            name: s.name,
            icon: iconForStage(s.id),
            status: s.status,
            log: s.log ?? "",
            detail: s.detail,
          }));
          onStage(mapped);
        } else if (msg.type === "complete" && msg.reply) {
          onComplete(msg.reply, (msg as any).dataset_id, (msg as any).charts, (msg as any).per_agent_summary);
          active = false;
          socket?.close();
        } else if (msg.type === "error" && msg.message) {
          onComplete(`Pipeline failed: ${msg.message}`);
          active = false;
          socket?.close();
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    socket.onclose = (event) => {
      if (!active) return;
      // If closed normally by us or server after completion, don't reconnect
      if (event.code === 1000) return;
      
      if (reconnectAttempts < 3) {
        reconnectAttempts++;
        const backoff = Math.min(1000 * Math.pow(2, reconnectAttempts), 5000);
        console.warn(`WebSocket disconnected. Reconnecting in ${backoff}ms... (Attempt ${reconnectAttempts})`);
        reconnectTimeout = setTimeout(connect, backoff);
      } else {
        const stages = newPipeline();
        stages[0].status = "pending";
        onStage(stages);
        onComplete("Connection lost. Pipeline failed to reconnect after 3 attempts.");
      }
    };
    
    socket.onerror = () => {
      // Error is handled by onclose, which will trigger reconnect logic
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close(); 
      }
    };
  };

  connect();

  return () => {
    active = false;
    clearTimeout(reconnectTimeout);
    socket?.close(1000, "Component unmounted");
  };
};

/* ---------------- Helpers ---------------- */

export const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export const titleFromPrompt = (prompt: string, max = 48): string => {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
};
