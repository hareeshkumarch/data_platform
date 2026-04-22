import { AppShell } from "@/components/layout/AppShell";
import { DynamicChart } from "@/components/charts/DynamicChart";
import { useQueryStore } from "@/store/useQueryStore";
import {
  TrendingUp, Download, Activity, Database, ShieldCheck,
  AlertTriangle, BarChart3, Hash, Type, Layers, Sparkles,
  ArrowUpDown, CheckCircle2, XCircle, Zap, GitBranch,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import React from "react";
import { apiFetch } from "@/lib/api-client";
import { ApiResponse, Dataset, DatasetPreview, DatasetColumn } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const Dashboards = () => {
  const [loading, setLoading] = useState(true);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [mainDataset, setMainDataset] = useState<DatasetPreview | null>(null);
  const [correlations, setCorrelations] = useState<any>(null);
  const [outliers, setOutliers] = useState<any[]>([]);
  const [systemStats, setSystemStats] = useState<{ llm_calls: number; llm_tokens: number; success_rate: number } | null>(null);
  const activeDatasetId = useAppStore((s) => s.dataset);

  const conversations = useQueryStore((s) => s.conversations);
  const activeConvId = useQueryStore((s) => s.activeId);
  const pipelineCharts = useMemo(() => {
    const activeConv = conversations.find((c) => c.id === activeConvId);
    return activeConv?.messages?.flatMap((m: any) => m.charts || []) || [];
  }, [conversations, activeConvId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const resp: ApiResponse<Dataset> = await apiFetch("/datasets");
      setDatasets(Array.isArray(resp.datasets) ? resp.datasets : []);

      try {
        const stats = await apiFetch<{ llm_calls: number; llm_tokens: number; success_rate: number }>("/system/stats");
        setSystemStats(stats);
      } catch { /* non-critical */ }

      const targetId = activeDatasetId && activeDatasetId !== "Select dataset"
        ? activeDatasetId
        : resp.datasets?.[0]?.id;

      if (targetId) {
        const preview: DatasetPreview = await apiFetch(`/datasets/${targetId}/preview`);
        setMainDataset(preview);

        try {
          const corrResp = await apiFetch<any>(`/analytics/${targetId}/correlations`);
          setCorrelations(corrResp);
        } catch { /* no correlations */ }

        try {
          const outResp = await apiFetch<any>(`/analytics/${targetId}/outliers`);
          setOutliers(outResp?.outliers || []);
        } catch { /* no outliers */ }
      }
    } catch {
      toast.error("Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [activeDatasetId]);

  const columns = (mainDataset?.columns as DatasetColumn[] | undefined) ?? [];
  const totalRows = mainDataset?.row_count || 0;
  const totalCols = mainDataset?.col_count || columns.length;
  const numericCols = columns.filter(c => c.inferred_type === "numeric");
  const categoricalCols = columns.filter(c => c.inferred_type === "categorical");
  const datetimeCols = columns.filter(c => c.inferred_type === "datetime");
  const totalNulls = columns.reduce((s, c) => s + (c.null_count ?? 0), 0);
  const totalCells = totalRows * totalCols || 1;
  const completeness = ((1 - totalNulls / totalCells) * 100);
  const qualityScore = Math.round(
    completeness * 0.4 +
    (columns.filter(c => (c.null_pct ?? 0) === 0).length / Math.max(totalCols, 1)) * 30 +
    Math.min(30, (totalRows / 100) * 30)
  );

  const kpis = [
    { label: "Active Datasets", value: datasets.length.toString(), delta: "uploaded", icon: Database, accent: false },
    { label: "Total Rows", value: totalRows.toLocaleString(), delta: `${totalCols} columns`, icon: Hash, accent: false },
    { label: "Quality Score", value: mainDataset ? `${qualityScore}` : "—", delta: `${completeness.toFixed(1)}% complete`, icon: ShieldCheck, accent: qualityScore >= 90 },
    { label: "LLM Calls", value: systemStats ? (Number(systemStats.llm_calls) || 0).toLocaleString() : "—", delta: `${(Number(systemStats?.llm_tokens) || 0).toLocaleString()} tokens`, icon: Zap, accent: false },
    { label: "Outlier Columns", value: outliers.length.toString(), delta: outliers.length === 0 ? "clean" : "columns affected", icon: AlertTriangle, accent: outliers.length === 0 },
    { label: "Missing Values", value: totalNulls === 0 ? "None" : totalNulls.toLocaleString(), delta: totalNulls === 0 ? "perfect" : `${((totalNulls / totalCells) * 100).toFixed(1)}% of cells`, icon: totalNulls === 0 ? CheckCircle2 : XCircle, accent: totalNulls === 0 },
  ];

  const typeGroups = [
    { label: "Numeric", count: numericCols.length, color: "bg-blue-500", text: "text-blue-500" },
    { label: "Categorical", count: categoricalCols.length, color: "bg-violet-500", text: "text-violet-500" },
    { label: "Datetime", count: datetimeCols.length, color: "bg-amber-500", text: "text-amber-500" },
    { label: "Other", count: columns.length - numericCols.length - categoricalCols.length - datetimeCols.length, color: "bg-emerald-500", text: "text-emerald-500" },
  ].filter(g => g.count > 0);

  const targetId = activeDatasetId && activeDatasetId !== "Select dataset" ? activeDatasetId : datasets[0]?.id;

  return (
    <AppShell title="Dashboards" subtitle="Data Intelligence Overview" status={loading ? "processing" : "ready"}>
      <div className="max-w-7xl mx-auto px-6 lg:px-10 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 animate-fade-in">
          <div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">Data Intelligence Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {mainDataset ? `Analyzing: ${(mainDataset as any).filename || mainDataset.name}` : "Live metrics from current environment"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => { if (targetId) window.open(`/api/v1/export/${targetId}/csv`); else toast.error("No dataset selected."); }}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-card border border-accent/20 text-xs font-medium text-foreground hover:border-accent/40 shadow-sm transition-colors"
            >
              <Download className="h-3.5 w-3.5 text-accent" /> Export CSV
            </button>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {kpis.map((k, i) => (
            <div key={k.label} className={cn("card-soft p-4 animate-fade-in-up", k.accent && "border-success/30")} style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-center gap-2 mb-2">
                <k.icon className={cn("h-3.5 w-3.5", k.accent ? "text-success" : "text-accent")} />
                <span className="text-[11px] text-muted-foreground font-medium truncate">{k.label}</span>
              </div>
              <p className={cn("text-xl font-bold tabular-nums tracking-tight", k.accent ? "text-success" : "text-foreground")}>{k.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{k.delta}</p>
            </div>
          ))}
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
          {/* Pipeline Charts */}
          {pipelineCharts.length > 0 ? (
            pipelineCharts.map((chartSpec: any, i: number) => (
              <div key={i} className={cn("card-soft p-4 animate-fade-in-up", i % 3 === 0 ? "lg:col-span-6" : "lg:col-span-3")} style={{ animationDelay: `${240 + i * 50}ms` }}>
                <DynamicChart spec={chartSpec} />
              </div>
            ))
          ) : mainDataset && Array.isArray(mainDataset.rows) && mainDataset.rows.filter(r => r && typeof r === "object").length > 1 ? (
            (() => {
              // Cache derived metadata once so we don't redo the find() per row.
              const safeRows = (mainDataset.rows as Array<Record<string, unknown>>).filter(r => r && typeof r === "object");
              const cols = ((mainDataset as any).columns as Array<{ name: string; inferred_type?: string }> | undefined) ?? [];
              const numericCol = cols.find(c => c?.inferred_type === "numeric")?.name || Object.keys(safeRows[0] || {})[1] || "value";
              const xKey = cols.find(c => c?.inferred_type === "datetime" || c?.inferred_type === "string")?.name || Object.keys(safeRows[0] || {})[0] || "key";
              return (
                <div className="lg:col-span-6 card-soft p-4 animate-fade-in-up" style={{ animationDelay: "240ms" }}>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3 flex items-center gap-2">
                    <BarChart3 className="h-3.5 w-3.5 text-accent" /> Primary Dataset Distribution
                  </h3>
                  <DynamicChart spec={{
                    chart: "line",
                    data: safeRows.map(row => ({
                      ...row,
                      [numericCol]: Number(row[numericCol]) || 0,
                    })),
                    xKey,
                    series: [{ key: numericCol, label: "Value" }],
                    height: 280,
                  }} />
                </div>
              );
            })()
          ) : (
            <div className="lg:col-span-6 card-soft p-4 h-[280px] flex flex-col items-center justify-center border-dashed animate-fade-in-up">
              <Activity className="h-8 w-8 text-muted-foreground/20 mb-2" />
              <p className="text-xs text-muted-foreground">Upload a dataset and run the pipeline to see visualizations here</p>
            </div>
          )}

          {/* Column Type Breakdown */}
          <div className="lg:col-span-3 card-soft p-4 animate-fade-in-up" style={{ animationDelay: "300ms" }}>
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3 flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-accent" /> Column Type Breakdown
            </h3>
            {columns.length > 0 ? (
              <>
                <div className="flex h-2.5 rounded-full overflow-hidden bg-surface mb-3">
                  {typeGroups.map(g => (
                    <div key={g.label} className={cn("transition-all duration-700", g.color)} style={{ width: `${(g.count / totalCols) * 100}%` }} title={`${g.label}: ${g.count}`} />
                  ))}
                </div>
                <div className="space-y-2">
                  {typeGroups.map(g => (
                    <div key={g.label} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full", g.color)} />
                        <span className="text-xs text-muted-foreground">{g.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 bg-surface rounded-full overflow-hidden">
                          <div className={cn("h-full rounded-full", g.color)} style={{ width: `${(g.count / totalCols) * 100}%` }} />
                        </div>
                        <span className={cn("text-xs font-semibold tabular-nums w-5 text-right", g.text)}>{g.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-24 flex items-center justify-center">
                <p className="text-xs text-muted-foreground">No schema loaded</p>
              </div>
            )}
          </div>

          {/* Numeric Column Stats */}
          <div className="lg:col-span-3 card-soft p-4 animate-fade-in-up" style={{ animationDelay: "360ms" }}>
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3 flex items-center gap-2">
              <Hash className="h-3.5 w-3.5 text-accent" /> Numeric Column Ranges
            </h3>
            <div className="space-y-2.5 overflow-y-auto max-h-[200px] pr-1">
              {numericCols.length > 0 ? numericCols.slice(0, 6).map(col => {
                const min = Number(col.min_val ?? 0);
                const max = Number(col.max_val ?? 0);
                const mean = Number(col.mean_val ?? 0);
                const range = max - min || 1;
                const meanPct = Math.max(0, Math.min(100, ((mean - min) / range) * 100));
                const stdVal = Number(col.std_val ?? 0);
                const cv = mean !== 0 ? Math.abs(stdVal / mean) * 100 : 0;
                return (
                  <div key={col.name} className="rounded-lg bg-surface/50 border border-border/40 p-2.5">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-[11px] font-medium text-foreground truncate max-w-[120px]">{col.name}</span>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-mono", cv > 100 ? "bg-destructive/10 text-destructive" : cv > 50 ? "bg-warning/10 text-warning" : "bg-success/10 text-success")}>
                        CV {cv.toFixed(0)}%
                      </span>
                    </div>
                    <div className="relative h-1.5 rounded-full bg-blue-500/15 overflow-visible mb-1">
                      <div className="absolute h-full w-full rounded-full bg-blue-500/30" />
                      <div className="absolute top-1/2 -translate-y-1/2 h-3 w-0.5 bg-blue-600 rounded-full" style={{ left: `${meanPct}%` }} title={`Mean: ${mean.toLocaleString()}`} />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                      <span>{min.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                      <span className="text-blue-500">μ {mean.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                      <span>{max.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                    </div>
                  </div>
                );
              }) : <p className="text-xs text-muted-foreground text-center py-6">No numeric columns</p>}
            </div>
          </div>

          {/* Top Correlations */}
          <div className="lg:col-span-3 card-soft p-4 animate-fade-in-up" style={{ animationDelay: "420ms" }}>
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3 flex items-center gap-2">
              <GitBranch className="h-3.5 w-3.5 text-accent" /> Top Correlations
            </h3>
            {Array.isArray(correlations?.pairs) && correlations.pairs.length > 0 ? (
              <div className="space-y-2">
                {correlations.pairs.slice(0, 5).map((p: any, i: number) => {
                  const r = typeof p?.pearson_r === "number" && Number.isFinite(p.pearson_r) ? p.pearson_r : 0;
                  return (
                    <div key={p?.column ?? i} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[11px] text-foreground font-medium truncate">{p?.column ?? "—"}</span>
                          <span className="text-[11px] font-mono font-semibold" style={{ color: r >= 0 ? "#22c55e" : "#ef4444" }}>
                            {r >= 0 ? "+" : ""}{r.toFixed(2)}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                          <div className={cn("h-full rounded-full", r >= 0 ? "bg-success/60" : "bg-destructive/60")}
                            style={{ width: `${Math.min(100, Math.abs(r) * 100)}%` }} />
                        </div>
                      </div>
                      {p?.significant && <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success shrink-0">sig</span>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-24 flex items-center justify-center">
                <p className="text-xs text-muted-foreground text-center">Run pipeline to compute correlations</p>
              </div>
            )}
          </div>

          {/* Outlier Summary */}
          <div className="lg:col-span-3 card-soft p-4 animate-fade-in-up" style={{ animationDelay: "480ms" }}>
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-accent" /> Outlier Summary
            </h3>
            {outliers.length > 0 ? (
              <div className="space-y-2">
                {outliers.slice(0, 5).map((o: any) => (
                  <div key={o.column} className="flex items-center justify-between p-2 rounded-lg bg-surface/50 border border-border/40">
                    <span className="text-[11px] font-medium text-foreground truncate max-w-[120px]">{o.column}</span>
                    <div className="flex items-center gap-2">
                      <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded", o.outlier_pct > 5 ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}>
                        {o.outlier_count} rows
                      </span>
                      <span className="text-[10px] text-muted-foreground">{o.outlier_pct.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-24 flex flex-col items-center justify-center gap-1">
                <CheckCircle2 className="h-6 w-6 text-success/50" />
                <p className="text-xs text-muted-foreground">{mainDataset ? "No outliers detected" : "Load a dataset to check"}</p>
              </div>
            )}
          </div>

          {/* Categorical Cardinality */}
          {categoricalCols.length > 0 && (
            <div className="lg:col-span-3 card-soft p-4 animate-fade-in-up" style={{ animationDelay: "540ms" }}>
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3 flex items-center gap-2">
                <Type className="h-3.5 w-3.5 text-accent" /> Categorical Cardinality
              </h3>
              <div className="space-y-2">
                {categoricalCols.slice(0, 5).map(col => {
                  const ratio = totalRows > 0 ? ((col.unique_count ?? 0) / totalRows) * 100 : 0;
                  const isId = ratio > 95;
                  return (
                    <div key={col.name} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-[11px] font-medium text-foreground truncate max-w-[110px]">{col.name}</span>
                          <div className="flex items-center gap-1.5">
                            {isId && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-600">ID?</span>}
                            <span className="text-[10px] text-muted-foreground font-mono">{col.unique_count ?? 0}</span>
                          </div>
                        </div>
                        <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                          <div className="h-full rounded-full bg-violet-500/60" style={{ width: `${Math.min(ratio, 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Dataset Health */}
          <div className={cn("card-soft p-4 animate-fade-in-up", categoricalCols.length > 0 ? "lg:col-span-3" : "lg:col-span-6")} style={{ animationDelay: "600ms" }}>
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3 flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-accent" /> Dataset Registry
            </h3>
            <div className="space-y-2">
              {datasets.slice(0, 5).map(d => (
                <div key={d.id} className="flex items-center justify-between p-2.5 rounded-lg bg-surface/50 border border-border/40">
                  <div className="flex items-center gap-2 min-w-0">
                    <Database className="h-3.5 w-3.5 text-accent shrink-0" />
                    <span className="text-[11px] font-medium truncate">{(d as any).filename || d.name || d.id}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-muted-foreground font-mono">{(d as any).row_count?.toLocaleString() || "—"} rows</span>
                    <span className="text-[10px] bg-success/10 text-success px-2 py-0.5 rounded">READY</span>
                  </div>
                </div>
              ))}
              {datasets.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No datasets uploaded yet</p>}
            </div>
          </div>

          {/* Missing Values per column */}
          {columns.filter(c => (c.null_count ?? 0) > 0).length > 0 && (
            <div className="lg:col-span-6 card-soft p-4 animate-fade-in-up" style={{ animationDelay: "660ms" }}>
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3 flex items-center gap-2">
                <ArrowUpDown className="h-3.5 w-3.5 text-accent" /> Missing Value Heatmap
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {columns.filter(c => (c.null_count ?? 0) > 0).map(col => {
                  const pct = col.null_pct ?? 0;
                  return (
                    <div key={col.name} className="rounded-lg border border-border/40 p-2.5 bg-surface/30">
                      <p className="text-[11px] font-medium text-foreground truncate mb-1">{col.name}</p>
                      <div className="h-1.5 rounded-full bg-surface overflow-hidden mb-1">
                        <div className={cn("h-full rounded-full", pct > 20 ? "bg-destructive/70" : pct > 5 ? "bg-warning/70" : "bg-amber-400/60")}
                          style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <p className={cn("text-[10px] font-mono font-semibold", pct > 20 ? "text-destructive" : pct > 5 ? "text-warning" : "text-amber-500")}>{pct.toFixed(1)}% missing</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
};

export default Dashboards;
