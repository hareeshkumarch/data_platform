import { useEffect, useMemo, useState } from "react";
import { Database, Globe, FileText, BarChart3, LineChart, AreaChart, PieChart as PieChartIcon, Sparkles as ScatterIcon, Hexagon as RadarIcon } from "lucide-react";
import { DynamicChart } from "./DynamicChart";
import type { ChartType } from "./DynamicChart";
import {
  getDatasets,
  setDatasets,
  buildDatasetMeta,
  SOURCE_LABEL,
  buildSpec,
  type ChartKind,
  type DataSourceKind,
  type DatasetMeta,
} from "@/lib/datasets";
import { cn } from "@/lib/utils";
import { useDatasetStore } from "@/store/useDatasetStore";

const SOURCE_ICON: Record<DataSourceKind, typeof Database> = {
  warehouse: Database,
  rest_api: Globe,
  file: FileText,
};

const CHART_ICONS: Record<string, typeof BarChart3> = {
  area: AreaChart,
  line: LineChart,
  bar: BarChart3,
  pie: PieChartIcon,
  donut: PieChartIcon,
  scatter: ScatterIcon,
  bubble: ScatterIcon,
  radar: RadarIcon,
  histogram: BarChart3,
  heatmap: BarChart3,
  boxplot: BarChart3,
  treemap: BarChart3,
  funnel: BarChart3,
  candlestick: LineChart,
  gauge: RadarIcon,
  sankey: BarChart3,
  waterfall: BarChart3,
  violin: AreaChart,
  table: BarChart3,
};

interface ChartViewerProps {
  /** Initial dataset id; defaults to first registered dataset. */
  defaultDatasetId?: string;
  /** Hide dataset selector (e.g. when caller has already chosen one). */
  lockDataset?: boolean;
  className?: string;
}

/**
 * Self-contained chart card with dataset + chart-type selectors.
 * Dynamically loads datasets from the shared store.
 */
export const ChartViewer = ({
  defaultDatasetId,
  lockDataset,
  className,
}: ChartViewerProps) => {
  const storeDatasets = useDatasetStore((s) => s.datasets);

  // Sync store datasets into the datasets registry
  useEffect(() => {
    if (storeDatasets.length > 0) {
      const metas = storeDatasets.map((d) => buildDatasetMeta(d as any));
      setDatasets(metas);
    }
  }, [storeDatasets]);

  const allDatasets = useMemo(() => {
    if (storeDatasets.length > 0) {
      return storeDatasets.map((d) => buildDatasetMeta(d as any));
    }
    return getDatasets();
  }, [storeDatasets]);

  const [datasetId, setDatasetId] = useState(
    defaultDatasetId ?? allDatasets[0]?.id ?? "",
  );
  const dataset = useMemo(
    () => allDatasets.find((d) => d.id === datasetId) ?? allDatasets[0],
    [datasetId, allDatasets],
  );
  const [chart, setChart] = useState<ChartKind>(dataset?.supportedCharts[0] || "line");
  const [rows, setRows] = useState<Record<string, unknown>[]>(dataset?.spec.data || []);
  const [loading, setLoading] = useState(false);

  // Reset chart type if not supported by the new dataset
  useEffect(() => {
    if (dataset && !dataset.supportedCharts.includes(chart)) {
      setChart(dataset.supportedCharts[0]);
    }
  }, [dataset, chart]);

  // Load rows whenever dataset changes
  useEffect(() => {
    if (!dataset) return;
    let active = true;
    setLoading(true);
    Promise.resolve(dataset.loader?.() ?? dataset.spec.data).then((data) => {
      if (!active) return;
      setRows(data as Record<string, unknown>[]);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [dataset]);

  if (!dataset) {
    return (
      <div className={cn("card-soft p-6 text-center text-sm text-muted-foreground", className)}>
        No datasets available. Upload data to see charts.
      </div>
    );
  }

  const SourceIcon = SOURCE_ICON[dataset.source] || FileText;
  const spec = buildSpec(dataset, chart, rows);

  return (
    <div className={cn("card-soft p-3 sm:p-4 animate-fade-in", className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-accent shrink-0">
            <SourceIcon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">
              {dataset.label}
            </p>
            <p className="text-[10px] text-muted-foreground truncate">
              {SOURCE_LABEL[dataset.source]}
              {loading && " · loading…"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {!lockDataset && allDatasets.length > 1 && (
            <select
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              className="h-7 max-w-[140px] rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
              aria-label="Select dataset"
            >
              {allDatasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
          <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md bg-surface border border-border flex-wrap">
            {dataset.supportedCharts.map((c) => {
              const Icon = CHART_ICONS[c] || BarChart3;
              const active = c === chart;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChart(c)}
                  className={cn(
                    "h-9 w-9 rounded flex items-center justify-center transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-label={`${c} chart`}
                  aria-pressed={active}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <DynamicChart spec={spec} />
    </div>
  );
};
