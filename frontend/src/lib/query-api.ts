/**
 * Query API — single integration surface for the Query page.
 *
 * Swap the in-memory implementations below with real fetch / WebSocket /
 * SSE calls to your backend. The page only depends on the exported
 * functions and types — keeping integration mechanical.
 */

import { Database, BrainCircuit, ChartSpline, ShieldCheck, Sparkles } from "lucide-react";

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

export interface QueryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  datasetId?: string;
  streaming?: boolean;
  pipeline?: PipelineStage[];
  mode: QueryMode;
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
  { id: "ingestion",     name: "Ingestion Agent",      icon: Database,     log: "Processing source data…", detail: "Validated source rows" },
  { id: "understanding", name: "Understanding Agent",  icon: BrainCircuit, log: "Analyzing schema & stats…", detail: "EDA profile generated" },
  { id: "insight",       name: "Insight Agent",        icon: Sparkles,     log: "Detecting patterns…",    detail: "4 patterns surfaced" },
  { id: "visualization", name: "Visualization Agent",  icon: ChartSpline,  log: "Composing charts…",      detail: "Dashboards updated" },
  { id: "report",        name: "Report Agent",         icon: ShieldCheck,  log: "Compiling findings…",    detail: "Report compiled ✓" },
];

export const newPipeline = (): PipelineStage[] =>
  PIPELINE_BLUEPRINT.map((s) => ({ ...s, status: "pending", detail: undefined }));

/* ---------------- Backend integration ---------------- */

import { apiFetch, pollTask } from "./api-client";

export const streamChatReply = (
  prompt: string,
  datasetId: string,
  onToken: (partial: string, done: boolean) => void,
): (() => void) => {
  const ctrl = new AbortController();
  const hasDataset = datasetId && datasetId !== "Select dataset";

  if (hasDataset) {
    // Use the query endpoint which has full dataset context
    apiFetch<{ task_id: string }>(`/query/${datasetId}`, {
      method: 'POST',
      body: JSON.stringify({ question: prompt, output_format: 'text' }),
      signal: ctrl.signal,
    })
      .then(async (data) => {
        onToken("Analyzing your data...", false);
        const result = await pollTask(data.task_id);
        // Result from Celery is {success, data, error} — real answer is in data.summary/data.answer (#4)
        const answer = result?.data?.summary || result?.data?.answer || result?.summary || result?.answer || JSON.stringify(result);
        onToken(answer, true);
      })
      .catch(err => {
        if (err.name !== 'AbortError') onToken("Error: " + err.message, true);
      });

    return () => ctrl.abort();
  }

  // Fallback: generic chat stream for when no dataset is selected
  (async () => {
    try {
      const response = await fetch(`/api/v1/chat-stream?prompt=${encodeURIComponent(prompt)}&dataset_id=${encodeURIComponent(datasetId)}`, {
        signal: ctrl.signal,
      });

      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              onToken(accumulated, true);
              return;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.token) {
                accumulated += parsed.token;
                onToken(accumulated, false);
              } else if (parsed.error) {
                onToken("Error: " + parsed.error, true);
                return;
              }
            } catch (e) {
              console.error("Parse error", e, data);
            }
          }
        }
      }
      onToken(accumulated, true);
    } catch (err: any) {
      if (err.name !== 'AbortError') onToken("Error: " + err.message, true);
    }
  })();

  return () => ctrl.abort();
};

export const runPipeline = (
  prompt: string,
  datasetId: string,
  onStage: (stages: PipelineStage[]) => void,
  onComplete: (reply: string) => void,
): (() => void) => {
  let active = true;
  const stages = newPipeline();
  
  const updateStageState = (progress: number) => {
    const n = stages.length;
    let currentIdx = Math.floor((progress / 100) * (n - 1));
    if (progress >= 100) currentIdx = n - 1;
    
    stages.forEach((s, idx) => {
      if (idx < currentIdx) s.status = "done";
      else if (idx === currentIdx) s.status = progress >= 100 ? "done" : "running";
      else s.status = "pending";
    });
    onStage([...stages]);
  };

  apiFetch<{ task_id: string }>(`/query/${datasetId}`, {
    method: 'POST',
    body: JSON.stringify({ question: prompt, output_format: 'text' })
  })
    .then(async (data) => {
      if (!active) return;
      
      const result = await pollTask(data.task_id, (progress) => {
        if (active) updateStageState(progress);
      });
      
      // Read from result.data for Celery wrapper (#5)
      if (active) onComplete(result?.data?.summary || result?.summary || "Pipeline completed successfully.");
    })
    .catch(err => {
      if (active) {
        // Show failure state — do NOT mark all stages as done (#32)
        stages.forEach(s => { s.status = s.status === "done" ? "done" : "pending"; });
        const failedStage = stages.find(s => s.status === "running") || stages.find(s => s.status === "pending");
        if (failedStage) failedStage.status = "pending";
        onStage([...stages]);
        onComplete(`Pipeline failed: ${err.message}. Please check that a dataset is selected and try again.`);
      }
    });

  return () => { active = false; };
};

/* ---------------- Helpers ---------------- */

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export const titleFromPrompt = (prompt: string, max = 48) => {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? trimmed.slice(0, max - 1) + "…" : trimmed;
};
