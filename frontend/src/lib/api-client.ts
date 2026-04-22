/**
 * Unified API client for Lumen's frontend → backend communication.
 *
 * - Resolves the base URL from environment (`REACT_APP_BACKEND_URL` /
 *   `VITE_BACKEND_URL`) so the same code runs in dev, preview and prod.
 * - Surfaces user-friendly errors with status-aware messages.
 * - Handles one automatic retry for transient network / 429 responses.
 */

import { ApiResponse, TaskResult } from "./types";

const BACKEND_ROOT: string =
  (typeof import.meta !== "undefined" && (import.meta as unknown as { env?: { VITE_BACKEND_URL?: string; REACT_APP_BACKEND_URL?: string } }).env?.VITE_BACKEND_URL) ||
  (typeof process !== "undefined" && process.env?.REACT_APP_BACKEND_URL) ||
  "";

export const API_BASE: string = `${BACKEND_ROOT.replace(/\/$/, "")}/api/v1`;

/** Websocket URL derived from the backend HTTP root. */
export const wsUrl = (path: string): string => {
  const base = BACKEND_ROOT || `${window.location.protocol}//${window.location.host}`;
  const url = new URL(path.startsWith("/") ? path : `/${path}`, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

const STATUS_MESSAGES: Record<number, string> = {
  400: "Invalid request. Please check your input.",
  401: "Authentication required. Please log in.",
  403: "You don't have permission to perform this action.",
  404: "The requested resource was not found.",
  413: "File too large. Please reduce the file size.",
  422: "Invalid input data. Please check the form fields.",
  429: "Too many requests — please wait a moment and try again.",
  500: "An internal server error occurred. Please try again later.",
  502: "Backend service is temporarily unavailable.",
  503: "Service is temporarily unavailable. Please try again.",
};

/** Fetch wrapper that normalizes errors and retries transient failures. */
export async function apiFetch<T = unknown>(
  endpoint: string,
  options: RequestInit = {},
  retryCount = 0,
): Promise<T> {
  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;

  const defaultHeaders: Record<string, string> = { Accept: "application/json" };
  if (options.body && !(options.body instanceof FormData)) {
    defaultHeaders["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { ...defaultHeaders, ...options.headers },
    });
  } catch (networkErr) {
    const err = networkErr as Error;
    if (retryCount < 1 && err.name !== "AbortError") {
      await sleep(1000);
      return apiFetch<T>(endpoint, options, retryCount + 1);
    }
    throw new Error("Network error — please check your connection and try again.");
  }

  if (response.status === 429 && retryCount < 2) {
    const retryAfter = parseInt(response.headers.get("Retry-After") || "3", 10);
    await sleep(retryAfter * 1000);
    return apiFetch<T>(endpoint, options, retryCount + 1);
  }

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { detail?: string };
    const friendly = STATUS_MESSAGES[response.status];
    const detail = errorBody.detail;
    const msg = friendly && (!detail || detail.length > 200)
      ? friendly
      : detail || friendly || `Request failed: ${response.statusText}`;
    throw new Error(msg);
  }

  const data = (await response.json()) as ApiResponse<unknown> & { datasets?: unknown[]; dataset_id?: string; id?: string };
  if (data && typeof data === "object") {
    if (Array.isArray(data.datasets)) {
      data.datasets = (data.datasets as Array<Record<string, unknown>>).map((d) => ({
        ...d,
        id: (d.id as string) || (d.dataset_id as string),
      }));
    } else if (data.dataset_id && !data.id) {
      data.id = data.dataset_id;
    }
  }
  return data as unknown as T;
}

/** Poll a background task until it resolves. */
export async function pollTask<T = unknown>(
  taskId: string,
  onProgress?: (progress: number, stage?: string) => void,
  intervalMs = 1500,
  maxAttempts = 60,
): Promise<T> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const status = await apiFetch<TaskResult>(`/task/${taskId}`);
    if (onProgress && typeof status.progress === "number") {
      onProgress(status.progress, status.stage);
    }
    const state = String(status.status ?? "").toLowerCase();
    if (state === "success") return status.result as T;
    if (state === "failure") throw new Error(String(status.error || status.result || "Task failed"));
    await sleep(intervalMs);
  }
  throw new Error("Task timed out — please retry.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
