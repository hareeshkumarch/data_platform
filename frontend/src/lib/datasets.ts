/**
 * Dataset registry — dynamically populated from backend datasets.
 *
 * The ChartViewer uses this to build chart specs from real backend data.
 * No more hardcoded mock data — all rows come from /api/v1/datasets/{id}/preview.
 */

import type { ChartSpec, ChartType } from "@/components/charts/DynamicChart";

import { API_BASE } from "./api-client";

export type ChartKind = ChartType;
export type DataSourceKind = "warehouse" | "rest_api" | "file";

export interface DatasetMeta {
  id: string;
  label: string;
  description: string;
  source: DataSourceKind;
  /** Chart types that make sense for this dataset. */
  supportedCharts: ChartKind[];
  /** Default rendering hints (axis keys, series). */
  spec: Omit<ChartSpec, "chart">;
  /** Fetch the rows for this dataset from the backend. */
  loader?: () => Promise<Record<string, unknown>[]>;
}

/** Loader that fetches rows from the backend preview endpoint. */
const backendLoader = (datasetId: string) => async (): Promise<Record<string, unknown>[]> => {
  try {
    const res = await fetch(`${API_BASE}/datasets/${datasetId}/preview?n=500`);
    if (res.ok) {
      const data = (await res.json()) as { rows?: Record<string, unknown>[] };
      return data.rows ?? [];
    }
  } catch {
    /* surface empty state on failure */
  }
  return [];
};

/**
 * Build a DatasetMeta from a raw backend dataset object.
 * Dynamically infers chart keys from column list.
 */
export function buildDatasetMeta(d: {
  id: string;
  name?: string;
  filename?: string;
  columns?: { name: string }[];
}): DatasetMeta {
  const cols = d.columns?.map((c) => c.name) || [];
  const xKey = cols[0] || "index";
  const seriesKeys = cols.slice(1, 4); // use up to 3 data columns

  return {
    id: d.id,
    label: d.name || d.filename || d.id,
    description: `Dataset: ${d.name || d.filename || d.id}`,
    source: "file",
    supportedCharts: ["line", "area", "bar", "pie", "donut", "scatter", "bubble", "radar", "heatmap", "histogram", "boxplot", "treemap", "funnel", "waterfall", "table"],
    spec: {
      data: [],
      xKey,
      series: seriesKeys.map((k) => ({ key: k, label: k })),
    },
    loader: backendLoader(d.id),
  };
}

/**
 * Mutable registry — populated at runtime from useDatasetStore.
 * ChartViewer calls `getDatasets()` to get the current list.
 */
let _datasets: DatasetMeta[] = [];

export function setDatasets(datasets: DatasetMeta[]) {
  _datasets = datasets;
}

export function getDatasets(): DatasetMeta[] {
  return _datasets;
}

/** Alias kept for backward compatibility with ChartViewer */
export const DATASETS = _datasets;

export const getDataset = (id: string) =>
  _datasets.find((d) => d.id === id) ?? _datasets[0];

export const buildSpec = (
  dataset: DatasetMeta,
  chart: ChartKind,
  rows?: Record<string, unknown>[],
): ChartSpec => ({
  ...dataset.spec,
  chart,
  data: rows ?? dataset.spec.data,
});

export const SOURCE_LABEL: Record<DataSourceKind, string> = {
  warehouse: "Data warehouse",
  rest_api: "REST API",
  file: "File upload",
};
