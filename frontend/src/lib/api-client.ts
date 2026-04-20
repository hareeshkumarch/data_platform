/**
 * Unified API Client for Frontend-Backend communication.
 * Handles base URLs, standard headers, and error parsing.
 */

import { ApiResponse, TaskResult } from "./types";

const API_BASE = "/api/v1";

/** Map HTTP status codes to user‑friendly messages (#47) */
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

/**
 * Global fetch wrapper for backend API calls.
 * Includes user-friendly error mapping, 429 backoff, and network retry.
 */
export async function apiFetch<T = any>(
  endpoint: string,
  options: RequestInit = {},
  _retryCount = 0,
): Promise<T> {
  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;

  const defaultHeaders: Record<string, string> = {
    Accept: "application/json",
  };

  if (options.body && !(options.body instanceof FormData)) {
    defaultHeaders["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    });
  } catch (networkErr: any) {
    // Network error — retry once (#66)
    if (_retryCount < 1 && networkErr.name !== "AbortError") {
      await new Promise((r) => setTimeout(r, 1000));
      return apiFetch<T>(endpoint, options, _retryCount + 1);
    }
    throw new Error("Network error — please check your connection and try again.");
  }

  // Rate limit handling (#65)
  if (response.status === 429 && _retryCount < 2) {
    const retryAfter = parseInt(response.headers.get("Retry-After") || "3", 10);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return apiFetch<T>(endpoint, options, _retryCount + 1);
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const friendly = STATUS_MESSAGES[response.status];
    const detail = errorBody.detail;
    // Use friendly message, but append detail if it doesn't look like a raw traceback
    const msg =
      friendly && (!detail || detail.length > 200)
        ? friendly
        : detail || friendly || `API error: ${response.statusText}`;
    throw new Error(msg);
  }

  let data = await response.json();

  // Compatibility mapping: dataset_id -> id
  if (data && typeof data === "object") {
    if (data.datasets && Array.isArray(data.datasets)) {
      data.datasets = data.datasets.map((d: any) => ({ ...d, id: d.id || d.dataset_id }));
    } else if (data.dataset_id && !data.id) {
      data.id = data.dataset_id;
    }
  }

  return data as T;
}

export async function pollTask<T = any>(
  taskId: string,
  onProgress?: (progress: number) => void,
  intervalMs = 2000,
  maxAttempts = 30,
): Promise<T> {
  for (let i = 0; i < maxAttempts; i++) {
    const status: TaskResult = await apiFetch<TaskResult>(`/task/${taskId}`);
    
    // Surface intermediate progress from Celery PROGRESS state (#33)
    if (onProgress) {
      if (status.progress !== undefined) {
        onProgress(status.progress);
      } else if (status.status?.toUpperCase() === "PROGRESS" && status.result?.progress) {
        onProgress(status.result.progress);
      }
    }
    
    const s = status.status.toLowerCase();
    
    if (s === "success") {
      return status.result as T;
    }
    
    if (s === "failure") {
      throw new Error(String(status.error || status.result || "Task failed"));
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Polling timeout");
}
