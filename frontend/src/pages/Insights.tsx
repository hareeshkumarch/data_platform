import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api-client";
import { ApiResponse, Dataset, DatasetColumn, DatasetPreview } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import {
  Sparkles, Database, ShieldCheck, AlertTriangle, Hash, Table2,
} from "lucide-react";

interface Outlier {
  column: string;
  outlier_count: number;
  outlier_pct: number;
}

const Insights = () => {
  const { dataset: selectedDataset, setDataset } = useAppStore((state) => ({
    dataset: state.dataset,
    setDataset: state.setDataset,
  }));

  const { data: datasetsResp } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => apiFetch<ApiResponse<Dataset>>("/datasets"),
  });

  const datasets = datasetsResp?.datasets ?? [];

  useEffect(() => {
    if (datasets.length > 0 && (!selectedDataset || selectedDataset === "Select dataset")) {
      setDataset(datasets[0].id);
    }
  }, [datasets, selectedDataset, setDataset]);

  const activeDatasetId =
    selectedDataset && selectedDataset !== "Select dataset"
      ? selectedDataset
      : datasets[0]?.id;

  const { data: preview, isLoading: loadingPreview } = useQuery({
    queryKey: ["dataset-preview", activeDatasetId],
    queryFn: () => apiFetch<DatasetPreview>(`/datasets/${activeDatasetId}/preview`),
    enabled: !!activeDatasetId,
  });

  const { data: outliersResp } = useQuery({
    queryKey: ["dataset-outliers", activeDatasetId],
    queryFn: () => apiFetch<{ outliers: Outlier[] }>(`/analytics/${activeDatasetId}/outliers`),
    enabled: !!activeDatasetId,
    retry: false,
  });

  const columns = useMemo<DatasetColumn[]>(
    () => (preview?.columns as DatasetColumn[] | undefined) ?? [],
    [preview],
  );

  const outliers = outliersResp?.outliers ?? [];
  const totalRows = preview?.row_count ?? 0;
  const totalCols = preview?.col_count ?? columns.length;
  const totalNulls = columns.reduce((sum, col) => sum + (col.null_count ?? 0), 0);
  const totalCells = totalRows * Math.max(totalCols, 1);
  const completeness = totalCells > 0 ? (1 - totalNulls / totalCells) * 100 : 0;
  const qualityScore = Math.round(
    completeness * 0.4 +
      (columns.filter((c) => (c.null_pct ?? 0) === 0).length / Math.max(totalCols, 1)) * 30 +
      Math.min(30, (totalRows / 100) * 30),
  );

  const topMissing = useMemo(
    () =>
      [...columns]
        .filter((col) => (col.null_count ?? 0) > 0)
        .sort((a, b) => (b.null_pct ?? 0) - (a.null_pct ?? 0))
        .slice(0, 3),
    [columns],
  );

  const topOutliers = useMemo(
    () => outliers.filter((o) => o.outlier_count > 0).slice(0, 3),
    [outliers],
  );

  const columnSummary = useMemo(
    () => columns.slice(0, Math.min(columns.length, 8)),
    [columns],
  );

  const sampleRows = useMemo(() => {
    if (!preview?.rows || !Array.isArray(preview.rows)) return [] as Record<string, unknown>[];
    return (preview.rows as unknown[])
      .filter((row): row is Record<string, unknown> => row !== null && typeof row === "object" && !Array.isArray(row))
      .slice(0, 5);
  }, [preview]);

  const sampleColumns = useMemo(() => {
    if (columnSummary.length > 0) return columnSummary.map((col) => col.name);
    return columns.slice(0, Math.min(columns.length, 6)).map((col) => col.name);
  }, [columnSummary, columns]);

  const issues = useMemo(() => {
    const list: string[] = [];
    topMissing.forEach((col) => {
      const pct = (col.null_pct ?? 0).toFixed(1);
      list.push(`${col.name} has ${pct}% missing values`);
    });
    topOutliers.forEach((entry) => {
      list.push(`${entry.column} flagged ${entry.outlier_count} outliers (${entry.outlier_pct.toFixed(1)}%)`);
    });
    return list.slice(0, 5);
  }, [topMissing, topOutliers]);

  const metrics = useMemo(
    () => [
      {
        icon: Database,
        label: "Total rows",
        value: formatNumber(totalRows),
        hint: totalCols > 0 ? `${totalCols} columns` : "Awaiting schema",
      },
      {
        icon: ShieldCheck,
        label: "Completeness",
        value: `${completeness.toFixed(1)}%`,
        hint: totalNulls === 0 ? "No missing values" : `${formatNumber(totalNulls)} empty cells`,
      },
      {
        icon: Sparkles,
        label: "Quality score",
        value: `${qualityScore}`,
        hint: qualityScore >= 90 ? "Healthy dataset" : "Review quality highlights",
      },
      {
        icon: Hash,
        label: "Distinct columns",
        value: formatNumber(columnSummary.length),
        hint: "Previewing up to eight fields",
      },
    ],
    [totalRows, totalCols, completeness, totalNulls, qualityScore, columnSummary.length],
  );

  const datasetName = useMemo(() => {
    if (preview?.name) return preview.name;
    if (preview?.filename) return preview.filename;
    return datasets.find((d) => d.id === activeDatasetId)?.name ?? "—";
  }, [preview, datasets, activeDatasetId]);

  return (
    <AppShell
      title="Insights"
      subtitle="Explore a concise health check for your active dataset"
      status={loadingPreview ? "processing" : "ready"}
    >
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[12px] uppercase tracking-[0.22em] text-accent font-semibold">Current dataset</p>
            <h1 className="mt-2 text-2xl font-semibold text-foreground tracking-tight">{datasetName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {totalRows > 0
                ? `${formatNumber(totalRows)} rows · ${totalCols} fields analysed`
                : datasets.length > 0
                  ? "Select a dataset to generate insights"
                  : "Upload a dataset to populate these metrics."}
            </p>
          </div>
          <div className="flex flex-col sm:items-end gap-2">
            <Select
              value={activeDatasetId ?? ""}
              onValueChange={(value) => setDataset(value)}
              disabled={datasets.length === 0}
            >
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Select a dataset" />
              </SelectTrigger>
              <SelectContent>
                {datasets.map((dataset) => (
                  <SelectItem key={dataset.id} value={dataset.id}>
                    {(dataset as any).filename || dataset.name || dataset.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[11px] text-muted-foreground">
              Pick a dataset to refresh the insight summary
            </span>
          </div>
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {metrics.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </section>

        <section className="rounded-xl border border-border/60 bg-card p-5 shadow-soft">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-foreground">Quality highlights</h2>
            <span className="text-xs text-muted-foreground">Derived from the latest profile snapshot</span>
          </div>
          {issues.length > 0 ? (
            <ul className="mt-4 space-y-2 text-sm text-foreground">
              {issues.map((issue, index) => (
                <li key={`${issue}-${index}`} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-amber-500" />
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-border/40 bg-surface/50 px-3 py-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-success" />
              No urgent data quality issues were detected.
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border/60 bg-card p-5 shadow-soft">
          <div className="flex items-center gap-2 mb-3">
            <Hash className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-foreground">Column snapshot</h2>
          </div>
          {columnSummary.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Column</th>
                    <th className="py-2 pr-4 font-medium">Type</th>
                    <th className="py-2 pr-4 font-medium text-right">Missing</th>
                    <th className="py-2 pr-4 font-medium text-right">Unique</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {columnSummary.map((column) => (
                    <tr key={column.name}>
                      <td className="py-2 pr-4 text-foreground">{column.name}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{column.inferred_type ?? "—"}</td>
                      <td className="py-2 pr-4 text-right text-muted-foreground font-mono">
                        {(column.null_pct ?? 0).toFixed(1)}%
                      </td>
                      <td className="py-2 pr-0 text-right text-muted-foreground font-mono">
                        {(column.unique_count ?? 0).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Column metadata will appear once profiling completes.</p>
          )}
        </section>

        {sampleRows.length > 0 && sampleColumns.length > 0 && (
          <section className="rounded-xl border border-border/60 bg-card p-5 shadow-soft">
            <div className="flex items-center gap-2 mb-3">
              <Table2 className="h-4 w-4 text-accent" />
              <h2 className="text-sm font-semibold text-foreground">Sample rows</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {sampleColumns.map((column) => (
                      <th key={column} className="py-2 pr-4 font-medium">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {sampleRows.map((row, index) => (
                    <tr key={index}>
                      {sampleColumns.map((column) => (
                        <td key={column} className="py-1.5 pr-4 text-[13px] text-foreground/90" title={String(row[column] ?? "")}>
                          {row[column] != null && row[column] !== ""
                            ? String(row[column])
                            : <span className="text-muted-foreground/50">null</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <footer className="text-xs text-muted-foreground text-center">
          <Sparkles className="h-3 w-3 inline mr-1" />
          Always validate key decisions with the underlying source data.
        </footer>
      </div>
    </AppShell>
  );
};

const formatNumber = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
};

interface MetricProps {
  icon: typeof Sparkles;
  label: string;
  value: string;
  hint: string;
}

const MetricCard = ({ icon: Icon, label, value, hint }: MetricProps) => (
  <div className="rounded-xl border border-border/60 bg-card p-4 shadow-soft">
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-accent" />
      <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
    </div>
    <p className="mt-3 text-2xl font-semibold text-foreground tabular-nums">{value}</p>
    <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
  </div>
);

export default Insights;


