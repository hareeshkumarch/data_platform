export interface Dataset {
  id: string;
  name?: string;
  filename?: string;
  path?: string;
  size_bytes?: number;
  row_count?: number;
  col_count?: number;
  created_at?: string;
  status?: "ready" | "processing" | "failed";
  dataset_id?: string;
}

export interface DatasetColumn {
  name: string;
  dtype?: string;
  inferred_type?: string;
  null_count?: number;
  null_pct?: number;
  unique_count?: number;
  cardinality?: string;
  sample_values?: unknown[];
  min_val?: unknown;
  max_val?: unknown;
  mean_val?: unknown;
  std_val?: unknown;
}

export interface DatasetPreview {
  id?: string;
  dataset_id?: string;
  name: string;
  columns: DatasetColumn[];
  rows?: Record<string, unknown>[];
  row_count: number;
  col_count: number;
  size_bytes?: number;
}

export interface ApiResponse<T> {
  [key: string]: unknown;
  datasets?: T[];
  message?: string;
  status?: string;
}

export interface TaskResult {
  task_id: string;
  status: "pending" | "started" | "success" | "failure" | "progress" | "SUCCESS" | "FAILURE" | "PROGRESS";
  result?: unknown;
  error?: string;
  progress?: number;
  stage?: string;
}
