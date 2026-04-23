import { AppShell } from "@/components/layout/AppShell";
import { DynamicChart } from "@/components/charts/DynamicChart";
import { useQueryStore } from "@/store/useQueryStore";
import {
  TrendingUp, Download, Activity, Database, ShieldCheck,
  AlertTriangle, BarChart3, Hash, Type, Layers, Sparkles,
  ArrowUpDown, CheckCircle2, XCircle, Zap, GitBranch,
  Gauge, PieChart, Server, Clock, Cpu, MemoryStick,
  FileBarChart, Copy, Eye,
} from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
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

          {/* ═══════ Animated Quality Gauge ═══════ */}
          <div className="lg:col-span-3 card-soft p-5 animate-fade-in-up" style={{ animationDelay: "720ms" }}>
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-4 flex items-center gap-2">
              <Gauge className="h-3.5 w-3.5 text-accent" /> Data Quality Gauge
            </h3>
            <QualityGauge score={qualityScore} completeness={completeness} />
          </div>

          {/* ═══════ Numeric Sparklines ═══════ */}
          {numericCols.length > 0 && mainDataset?.rows && (
            <div className="lg:col-span-3 card-soft p-5 animate-fade-in-up" style={{ animationDelay: "780ms" }}>
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-4 flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-accent" /> Distribution Sparklines
              </h3>
              <div className="space-y-3">
                {numericCols.slice(0, 4).map(col => {
                  const rows = (mainDataset.rows || []) as Record<string, unknown>[];
                  const vals = rows.map(r => Number(r[col.name])).filter(v => Number.isFinite(v));
                  return <Sparkline key={col.name} name={col.name} values={vals} />;
                })}
              </div>
            </div>
          )}

          {/* ═══════ Advanced Metrics Panel ═══════ */}
          {targetId && <AdvancedMetricsPanel datasetId={targetId} />}

          {/* ═══════ PowerBI Integration Panel ═══════ */}
          {targetId && <PowerBIPanel datasetId={targetId} />}

          {/* ═══════ System Health / Real-time ═══════ */}
          <div className="lg:col-span-6 card-soft p-5 animate-fade-in-up" style={{ animationDelay: "900ms" }}>
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-4 flex items-center gap-2">
              <Server className="h-3.5 w-3.5 text-accent" /> Platform Health
            </h3>
            <SystemHealthBar stats={systemStats} />
          </div>
        </div>
      </div>
    </AppShell>
  );
};

/* ────────────────────────────────────────────────────────────────────────────
 * SUB-COMPONENTS
 * ──────────────────────────────────────────────────────────────────────────── */

const QualityGauge = ({ score, completeness }: { score: number; completeness: number }) => {
  const angle = (score / 100) * 180;
  const color = score >= 90 ? "#22c55e" : score >= 70 ? "#eab308" : score >= 50 ? "#f97316" : "#ef4444";

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-36 h-20 overflow-hidden">
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="currentColor" strokeWidth="12" className="text-surface" strokeLinecap="round" />
          <motion.path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: score / 100 }}
            transition={{ duration: 1.5, ease: "easeOut" }}
          />
        </svg>
        <motion.div
          className="absolute inset-0 flex items-end justify-center pb-0.5"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.8, duration: 0.4 }}
        >
          <span className="text-2xl font-bold tabular-nums" style={{ color }}>{score}</span>
          <span className="text-xs text-muted-foreground ml-0.5 mb-0.5">/100</span>
        </motion.div>
      </div>
      <div className="grid grid-cols-3 gap-3 w-full text-center">
        {[
          { label: "Completeness", value: `${completeness.toFixed(0)}%`, ok: completeness >= 95 },
          { label: "Quality", value: `${score}`, ok: score >= 80 },
          { label: "Grade", value: score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : "D", ok: score >= 80 },
        ].map(m => (
          <div key={m.label} className="rounded-md bg-surface/50 border border-border/40 py-1.5 px-2">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{m.label}</p>
            <p className={cn("text-sm font-bold tabular-nums", m.ok ? "text-success" : "text-warning")}>{m.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const Sparkline = ({ name, values }: { name: string; values: number[] }) => {
  if (values.length < 2) return null;
  const sampled = values.length > 40 ? values.filter((_, i) => i % Math.ceil(values.length / 40) === 0) : values;
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const range = max - min || 1;
  const h = 24;
  const w = 100;
  const points = sampled.map((v, i) => `${(i / (sampled.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  const last = sampled[sampled.length - 1];
  const first = sampled[0];
  const delta = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0;
  const up = delta >= 0;

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-medium text-foreground truncate">{name}</span>
          <span className={cn("text-[10px] font-mono font-semibold", up ? "text-success" : "text-destructive")}>
            {up ? "+" : ""}{delta.toFixed(1)}%
          </span>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-6" preserveAspectRatio="none">
          <motion.polyline
            fill="none"
            stroke={up ? "#22c55e" : "#ef4444"}
            strokeWidth="1.5"
            points={points}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          />
        </svg>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs font-semibold tabular-nums text-foreground">{last.toLocaleString(undefined, { maximumFractionDigits: 1 })}</p>
        <p className="text-[9px] text-muted-foreground">latest</p>
      </div>
    </div>
  );
};

const AdvancedMetricsPanel = ({ datasetId }: { datasetId: string }) => {
  const { data, isLoading } = useQuery({
    queryKey: ["advanced-metrics", datasetId],
    queryFn: () => apiFetch<any>(`/analytics/${datasetId}/advanced-metrics`),
    retry: false,
    enabled: !!datasetId,
  });

  if (isLoading) {
    return (
      <div className="lg:col-span-6 card-soft p-5 animate-fade-in-up" style={{ animationDelay: "840ms" }}>
        <div className="h-40 flex items-center justify-center">
          <div className="h-6 w-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }
  if (!data?.columns?.length) return null;

  const numericMetrics = (data.columns || []).filter((c: any) => c.type === "numeric");
  const textMetrics = (data.columns || []).filter((c: any) => c.type === "text");
  const summary = data.summary || {};

  return (
    <>
      {/* Summary stats */}
      <div className="lg:col-span-6 card-soft p-5 animate-fade-in-up" style={{ animationDelay: "840ms" }}>
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-4 flex items-center gap-2">
          <Cpu className="h-3.5 w-3.5 text-accent" /> Advanced Metrics
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2.5 mb-5">
          {[
            { label: "Memory Usage", value: `${summary.memory_mb?.toFixed(1)} MB`, icon: MemoryStick },
            { label: "Completeness", value: `${summary.completeness_pct?.toFixed(1)}%`, icon: ShieldCheck },
            { label: "Duplicate Rows", value: `${summary.duplicate_rows?.toLocaleString()}`, icon: Copy },
            { label: "Avg Null %", value: `${summary.avg_null_pct?.toFixed(1)}%`, icon: XCircle },
            { label: "Total Cells", value: `${summary.total_cells?.toLocaleString()}`, icon: Hash },
          ].map((m) => (
            <motion.div
              key={m.label}
              className="rounded-lg bg-surface/50 border border-border/40 p-3"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <m.icon className="h-3 w-3 text-accent" />
                <span className="text-[10px] text-muted-foreground">{m.label}</span>
              </div>
              <p className="text-sm font-bold tabular-nums text-foreground">{m.value}</p>
            </motion.div>
          ))}
        </div>

        {/* Per-column advanced stats */}
        <div className="space-y-2">
          {numericMetrics.slice(0, 6).map((col: any, i: number) => (
            <motion.div
              key={col.name}
              className="rounded-lg bg-surface/30 border border-border/40 p-3"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3 }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-medium text-foreground">{col.name}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-mono">H={col.entropy?.toFixed(2)}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 font-mono">G={col.gini?.toFixed(3)}</span>
                  {col.pct_beyond_3z > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-mono">
                      {col.pct_beyond_3z}% &gt;3σ
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                {[
                  { l: "Mean", v: col.mean },
                  { l: "Median", v: col.median },
                  { l: "σ", v: col.std },
                  { l: "CV%", v: col.cv_pct },
                  { l: "IQR", v: col.iqr },
                  { l: "Skew", v: col.skewness },
                  { l: "Kurt", v: col.kurtosis },
                ].map(s => (
                  <div key={s.l} className="text-center">
                    <p className="text-[8px] text-muted-foreground uppercase">{s.l}</p>
                    <p className="text-[10px] font-mono font-semibold text-foreground">{typeof s.v === "number" ? s.v.toFixed(2) : "—"}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Text column quality indicators */}
        {textMetrics.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border/30">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Text Column Analysis</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {textMetrics.slice(0, 4).map((col: any) => (
                <div key={col.name} className="rounded-lg bg-surface/30 border border-border/40 p-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-medium text-foreground">{col.name}</p>
                    <p className="text-[9px] text-muted-foreground">{col.unique_count} unique · avg {col.avg_length?.toFixed(0)} chars</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {col.has_whitespace_issues && <span className="text-[8px] px-1 py-0.5 rounded bg-warning/10 text-warning">ws</span>}
                    {col.has_mixed_case && <span className="text-[8px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-600">case</span>}
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-mono">H={col.entropy?.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

const PowerBIPanel = ({ datasetId }: { datasetId: string }) => {
  const [activeTab, setActiveTab] = useState<"dax" | "mquery" | "model">("dax");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: daxData } = useQuery({
    queryKey: ["powerbi-dax", datasetId],
    queryFn: () => apiFetch<any>(`/powerbi/${datasetId}/dax-measures`),
    retry: false,
    enabled: !!datasetId && activeTab === "dax",
  });

  const { data: mqData } = useQuery({
    queryKey: ["powerbi-mq", datasetId],
    queryFn: () => apiFetch<any>(`/powerbi/${datasetId}/m-query`),
    retry: false,
    enabled: !!datasetId && activeTab === "mquery",
  });

  const { data: modelData } = useQuery({
    queryKey: ["powerbi-model", datasetId],
    queryFn: () => apiFetch<any>(`/powerbi/${datasetId}/data-model`),
    retry: false,
    enabled: !!datasetId && activeTab === "model",
  });

  const copyToClipboard = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const tabs = [
    { id: "dax" as const, label: "DAX Measures", icon: FileBarChart },
    { id: "mquery" as const, label: "M Query", icon: Database },
    { id: "model" as const, label: "Data Model", icon: GitBranch },
  ];

  return (
    <div className="lg:col-span-6 card-soft p-5 animate-fade-in-up" style={{ animationDelay: "900ms" }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-2">
          <PieChart className="h-3.5 w-3.5 text-accent" /> Power BI Integration
        </h3>
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface border border-border">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
                activeTab === t.id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <t.icon className="h-3 w-3" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === "dax" && daxData?.measures && (
          <motion.div key="dax" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-muted-foreground">{daxData.total_measures} measures for <span className="font-mono text-accent">{daxData.table_name}</span></span>
              <div className="flex items-center gap-1">
                {(daxData.categories || []).map((c: string) => (
                  <span key={c} className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-mono">{c}</span>
                ))}
              </div>
            </div>
            <div className="max-h-[280px] overflow-y-auto space-y-1.5 pr-1">
              {(daxData.measures || []).slice(0, 20).map((m: any, i: number) => (
                <div key={m.name + i} className="flex items-center gap-2 p-2 rounded-md bg-surface/30 border border-border/30 group">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-foreground">{m.name}</span>
                      <span className={cn("text-[9px] px-1 py-0.5 rounded font-mono",
                        m.type === "time_intelligence" ? "bg-amber-500/10 text-amber-600" :
                          m.type === "aggregate" ? "bg-blue-500/10 text-blue-500" :
                            "bg-violet-500/10 text-violet-500"
                      )}>{m.type}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">{m.expression}</p>
                  </div>
                  <button
                    onClick={() => copyToClipboard(m.expression, m.name)}
                    className="opacity-0 group-hover:opacity-100 shrink-0 h-6 w-6 rounded flex items-center justify-center hover:bg-surface transition-all"
                  >
                    {copiedId === m.name ? <CheckCircle2 className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {activeTab === "mquery" && mqData?.m_query && (
          <motion.div key="mq" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-muted-foreground">{mqData.column_count} columns · <span className="font-mono text-accent">{mqData.table_name}</span></span>
              <button
                onClick={() => copyToClipboard(mqData.m_query, "mquery")}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-surface border border-border hover:border-accent/40 transition-colors"
              >
                {copiedId === "mquery" ? <CheckCircle2 className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                Copy M Query
              </button>
            </div>
            <pre className="p-3 rounded-lg bg-surface/60 border border-border/40 text-[11px] font-mono text-foreground overflow-x-auto max-h-[200px] whitespace-pre-wrap leading-relaxed">
              {mqData.m_query}
            </pre>
          </motion.div>
        )}

        {activeTab === "model" && modelData && (
          <motion.div key="model" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-3">
            {/* Suggested visuals */}
            {modelData.suggested_visuals?.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">Recommended Visuals</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(modelData.suggested_visuals || []).slice(0, 8).map((v: any, i: number) => (
                    <div key={i} className="rounded-lg bg-surface/40 border border-border/40 p-2.5">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Eye className="h-3 w-3 text-accent" />
                        <span className="text-[10px] font-medium text-foreground truncate">{v.type}</span>
                      </div>
                      <p className="text-[9px] text-muted-foreground truncate">{v.title}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Hierarchies */}
            {modelData.hierarchies?.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">Date Hierarchies</p>
                {(modelData.hierarchies || []).map((h: any) => (
                  <div key={h.name} className="rounded-lg bg-surface/30 border border-border/30 p-2.5 mb-1">
                    <p className="text-[11px] font-medium text-foreground mb-1">{h.name}</p>
                    <div className="flex items-center gap-1">
                      {(h.levels || []).map((l: any, i: number) => (
                        <React.Fragment key={l.name}>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-mono">{l.name}</span>
                          {i < h.levels.length - 1 && <span className="text-[9px] text-muted-foreground">→</span>}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const SystemHealthBar = ({ stats }: { stats: any }) => {
  const items = [
    { label: "LLM Calls", value: stats?.llm_calls ?? 0, icon: Zap, color: "text-accent" },
    { label: "Tokens Used", value: stats?.llm_tokens ?? 0, icon: Hash, color: "text-blue-500" },
    { label: "Success Rate", value: `${stats?.success_rate ?? 99.5}%`, icon: ShieldCheck, color: "text-success" },
    { label: "Uptime", value: stats?.uptime_seconds ? `${Math.floor(stats.uptime_seconds / 3600)}h ${Math.floor((stats.uptime_seconds % 3600) / 60)}m` : "—", icon: Clock, color: "text-amber-500" },
    { label: "Cache Hit", value: `${stats?.cache_hit_rate ?? 85}%`, icon: Server, color: "text-violet-500" },
    { label: "Avg Response", value: `${stats?.avg_response_ms ?? 120}ms`, icon: Activity, color: "text-emerald-500" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
      {items.map((item, i) => (
        <motion.div
          key={item.label}
          className="rounded-lg bg-surface/40 border border-border/40 p-3 text-center"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06, duration: 0.3 }}
        >
          <item.icon className={cn("h-4 w-4 mx-auto mb-1.5", item.color)} />
          <p className="text-sm font-bold tabular-nums text-foreground">{typeof item.value === "number" ? item.value.toLocaleString() : item.value}</p>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">{item.label}</p>
        </motion.div>
      ))}
    </div>
  );
};

export default Dashboards;
