export interface Dataset {
  id: string;
  name?: string;
  filename?: string;
  path: string;
  size_bytes: number;
  row_count?: number;
  col_count?: number;
  created_at: string;
  status?: "ready" | "processing" | "failed";
}

export interface DatasetPreview {
  id: string;
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  col_count: number;
  size_bytes: number;
}

export interface ApiResponse<T> {
  [key: string]: unknown;
  datasets?: T[];
  message?: string;
  status?: string;
}

export interface TaskResult {
  task_id: string;
  status: "pending" | "started" | "success" | "failure" | "SUCCESS" | "FAILURE";
  result?: any;
  error?: string;
  progress?: number;
}
