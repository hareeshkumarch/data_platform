import { AppShell } from "@/components/layout/AppShell";
import {
  Download, Database, ShieldCheck, Hash, Sparkles,
  GitBranch, Zap, Clock, Activity, AlertTriangle,
} from "lucide-react";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import { ApiResponse, Dataset, DatasetPreview, DatasetColumn } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import { toast } from "sonner";

const Dashboards = () => {
  const [loading, setLoading] = useState(true);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [mainDataset, setMainDataset] = useState<DatasetPreview | null>(null);
  const [systemStats, setSystemStats] = useState<{ llm_calls: number; llm_tokens: number; success_rate: number; uptime_seconds?: number } | null>(null);
  const [outliers, setOutliers] = useState<any[]>([]);
  const activeDatasetId = useAppStore((s) => s.dataset);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const resp: ApiResponse<Dataset> = await apiFetch("/datasets");
        const nextDatasets = Array.isArray(resp.datasets) ? resp.datasets : [];
        setDatasets(nextDatasets);

        const targetId = activeDatasetId && activeDatasetId !== "Select dataset"
          ? activeDatasetId
          : nextDatasets[0]?.id;

        if (targetId) {
          const preview: DatasetPreview = await apiFetch(`/datasets/${targetId}/preview`);
          setMainDataset(preview);

          try {
            const outResp = await apiFetch<any>(`/analytics/${targetId}/outliers`);
            setOutliers(outResp?.outliers || []);
          } catch { /* ignore */ }
        } else {
          setMainDataset(null);
          setOutliers([]);
        }

        try {
          const stats = await apiFetch<{ llm_calls: number; llm_tokens: number; success_rate: number }>("/system/stats");
          setSystemStats(stats);
        } catch { /* optional telemetry */ }
      } catch {
        toast.error("Failed to load dashboard data.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [activeDatasetId]);

  const columns = (mainDataset?.columns as DatasetColumn[] | undefined) ?? [];
  const totalRows = mainDataset?.row_count ?? 0;
  const totalCols = mainDataset?.col_count ?? columns.length;
  const totalNulls = columns.reduce((sum, col) => sum + (col.null_count ?? 0), 0);
  const totalCells = totalRows * Math.max(totalCols, 1);
  const completeness = totalCells > 0 ? (1 - totalNulls / totalCells) * 100 : 0;
  const missingColumns = columns
    .filter((col) => (col.null_count ?? 0) > 0)
    .sort((a, b) => (b.null_pct ?? 0) - (a.null_pct ?? 0))
    .slice(0, 3);
  const headlineOutliers = outliers.slice(0, 3);

  const stats = [
    {
      label: "Rows",
      value: totalRows > 0 ? totalRows.toLocaleString() : "—",
      helper: totalCols > 0 ? `${totalCols} columns` : "Awaiting schema",
      icon: Database,
    },
    {
      label: "Completeness",
      value: `${completeness.toFixed(1)}%`,
      helper: totalNulls === 0 ? "No missing values" : `${totalNulls.toLocaleString()} empty cells`,
      icon: ShieldCheck,
    },
    {
      label: "Outlier Columns",
      value: headlineOutliers.length > 0 ? headlineOutliers.length : "None",
      helper: headlineOutliers.length > 0 ? `${headlineOutliers[0].column} tops the list` : "Clean distribution",
      icon: AlertTriangle,
    },
    {
      label: "Datasets",
      value: datasets.length,
      helper: "Uploaded to the workspace",
      icon: Hash,
    },
  ];

  const qualityHighlights = [
    ...missingColumns.map((col) => ({
      message: `${col.name} has ${(col.null_pct ?? 0).toFixed(1)}% missing values`,
    })),
    ...headlineOutliers.map((entry) => ({
      message: `${entry.column} flagged ${entry.outlier_count} outliers (${entry.outlier_pct?.toFixed(1)}%)`,
    })),
  ];

  const currentDatasetName = (mainDataset as any)?.filename || mainDataset?.name || activeDatasetId || datasets[0]?.name || "—";

  return (
    <AppShell
      title="Dashboards"
      subtitle="Quick view of dataset health and next steps"
      status={loading ? "processing" : "ready"}
    >
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[12px] uppercase tracking-[0.22em] text-accent font-semibold">Current dataset</p>
            <h1 className="mt-2 text-2xl font-semibold text-foreground tracking-tight">{currentDatasetName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {totalRows > 0
                ? `${totalRows.toLocaleString()} rows · ${totalCols} fields analysed`
                : "Upload a dataset to populate these metrics."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (!mainDataset) {
                  toast.error("No dataset selected");
                  return;
                }
                window.location.href = "/insights";
              }}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:border-accent/40"
            >
              <Sparkles className="h-4 w-4 text-accent" /> Open insights
            </button>
            <button
              type="button"
              onClick={() => { window.location.href = "/powerbi"; }}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:border-accent/40"
            >
              <GitBranch className="h-4 w-4 text-accent" /> Power BI workspace
            </button>
            <button
              type="button"
              onClick={() => {
                if (!mainDataset) {
                  toast.error("No dataset selected");
                  return;
                }
                window.open(`/api/v1/export/${mainDataset.id}/csv`, "_blank");
              }}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:border-accent/40"
            >
              <Download className="h-4 w-4 text-accent" /> Export CSV
            </button>
          </div>
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {stats.map(({ label, value, helper, icon: Icon }) => (
            <div key={label} className="rounded-xl border border-border/60 bg-card p-4 shadow-soft">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Icon className="h-4 w-4 text-accent" />
                {label}
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground tabular-nums">{value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-border/60 bg-card p-5 shadow-soft">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-foreground">Quality highlights</h2>
            <span className="text-xs text-muted-foreground">
              Derived from the latest dataset profile
            </span>
          </div>
          {qualityHighlights.length > 0 ? (
            <ul className="mt-4 space-y-2 text-sm text-foreground">
              {qualityHighlights.map(({ message }, idx) => (
                <li key={`${message}-${idx}`} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-amber-500" />
                  <span>{message}</span>
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
          <h2 className="text-sm font-semibold text-foreground">Dataset catalog</h2>
          <p className="text-xs text-muted-foreground mt-1">Recently ingested datasets</p>
          <div className="mt-4 space-y-2">
            {datasets.slice(0, 6).map((dataset) => (
              <div key={dataset.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-surface/40 px-3 py-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Database className="h-4 w-4 text-accent" />
                  <span className="truncate text-foreground">{(dataset as any).filename || dataset.name || dataset.id}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {(dataset as any).row_count?.toLocaleString() ?? "—"} rows
                </span>
              </div>
            ))}
            {datasets.length === 0 && (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-10 text-center text-sm text-muted-foreground">
                No datasets uploaded yet.
              </div>
            )}
          </div>
        </section>

        {systemStats && (
          <section className="rounded-xl border border-border/60 bg-card p-5 shadow-soft">
            <h2 className="text-sm font-semibold text-foreground">Platform health</h2>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <HealthStat icon={Zap} label="LLM calls" value={systemStats.llm_calls?.toLocaleString() ?? "—"} />
              <HealthStat icon={Hash} label="Tokens" value={systemStats.llm_tokens?.toLocaleString() ?? "—"} />
              <HealthStat icon={ShieldCheck} label="Success" value={`${systemStats.success_rate ?? 0}%`} />
              <HealthStat icon={Clock} label="Uptime" value={formatUptime(systemStats.uptime_seconds)} />
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
};

const formatUptime = (seconds?: number) => {
  if (!seconds || seconds <= 0) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
};

const HealthStat = ({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) => (
  <div className="rounded-lg border border-border/40 bg-surface/40 px-3 py-3 text-center">
    <Icon className="mx-auto mb-1 h-4 w-4 text-accent" />
    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
    <p className="mt-1 text-sm font-semibold text-foreground tabular-nums">{value}</p>
  </div>
);

export default Dashboards;
