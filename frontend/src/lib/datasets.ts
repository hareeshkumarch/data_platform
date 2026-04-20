/**
 * Dataset registry — dynamically populated from backend datasets.
 *
 * The ChartViewer uses this to build chart specs from real backend data.
 * No more hardcoded mock data — all rows come from /api/v1/datasets/{id}/preview.
 */

import type { ChartSpec, ChartType } from "@/components/charts/DynamicChart";

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

/**
 * Loader that always hits the backend.
 * Returns empty array on failure — no mock fallback.
 */
const backendLoader = (datasetId: string) => async () => {
  try {
    const res = await fetch(`/api/v1/datasets/${datasetId}/preview`);
    if (res.ok) {
      const data = await res.json();
      return data.rows || [];
    }
  } catch (e) {
    console.warn(`Failed to fetch dataset ${datasetId} from backend.`, e);
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
