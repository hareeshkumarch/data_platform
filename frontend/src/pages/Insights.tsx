import { AppShell } from "@/components/layout/AppShell";
import { InsightCard } from "@/components/cards/InsightCard";
import { DynamicChart } from "@/components/charts/DynamicChart";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { ApiResponse, Dataset, DatasetColumn, DatasetPreview } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import {
  Sparkles, Activity, AlertTriangle, TrendingUp, Grid3x3, LineChart, Radar,
  Database, Columns3, Hash, Type, Calendar, CheckCircle2, XCircle, BarChart3,
  Layers, ShieldCheck, FileSearch, ArrowUpDown, Gauge, GitBranch, Signal,
  Target, BarChart2, Network,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Finding {
  tag: string;
  title: string;
  explanation: string;
  confidence: number;
  metrics: { label: string; value: string }[];
}

interface Correlations {
  columns: string[];
  matrix: number[][];
  pairs?: Array<{ column: string; pearson_r: number; significant: boolean; strength: string }>;
}

interface Trend {
  direction: string;
  strength: string;
  pct_change_total: number;
  r_squared: number;
  significant: boolean;
  value_column: string;
  data_points: number;
}

interface Outlier {
  column: string;
  outlier_count: number;
  outlier_pct: number;
  upper_fence: number;
  lower_fence: number;
}

type Tab = "overview" | "correlations" | "trends" | "outliers" | "forecast" | "anomalies" | "distributions" | "quality" | "relationships" | "drift" | "importance";

interface ForecastResponse {
  column: string;
  history: Array<{ date: string; value: number }>;
  smoothed: Array<{ date: string; value: number }>;
  forecast: Array<{ date: string; value: number }>;
  slope: number;
  intercept: number;
}

interface AnomalyResponse {
  column: string;
  count: number;
  rate_pct: number;
  threshold: number;
  anomalies: Array<{ index: number; value: number; z_score: number }>;
}

import { useQuery } from "@tanstack/react-query";

const Insights = () => {
  const [tab, setTab] = useState<Tab>("overview");
  const [forecastCol, setForecastCol] = useState<string>("");
  const [anomalyCol, setAnomalyCol] = useState<string>("");
  const [zThreshold, setZThreshold] = useState<number>(3.0);
  const activeDatasetId = useAppStore((s) => s.dataset);

  const { data: dbResp } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => apiFetch<ApiResponse<Dataset>>("/datasets"),
  });
  const datasets = dbResp?.datasets || [];
  const activeTargetId = activeDatasetId && activeDatasetId !== "Select dataset" ? activeDatasetId : datasets[0]?.id;

  const { data: mainDataset, isLoading: loadingPreview } = useQuery({
    queryKey: ["preview", activeTargetId],
    queryFn: () => apiFetch<DatasetPreview>(`/datasets/${activeTargetId}/preview`),
    enabled: !!activeTargetId,
  });

  const { data: analyticsRec, isLoading: loadingProfile } = useQuery({
    queryKey: ["analytics-profile", activeTargetId],
    queryFn: () => apiFetch<{ profile?: Record<string, unknown>[]; columns?: Record<string, unknown>[]; row_count?: number }>(`/analytics/${activeTargetId}`, {
      method: "POST",
      body: JSON.stringify({ analysis_type: "profile", config: {} }),
    }),
    enabled: !!activeTargetId,
  });

  const cols = analyticsRec?.columns ?? analyticsRec?.profile ?? [];
  const rowCount = analyticsRec?.row_count ?? mainDataset?.row_count ?? 1;
  const findings: Finding[] = cols.slice(0, 4).map((col: any) => ({
    tag: (col.inferred_type as string) ?? "Column",
    title: `Analysis of ${col.name as string}`,
    explanation: `Inferred as ${col.inferred_type}. Found ${(col.unique_count as number) ?? 0} unique values.`,
    confidence: 0.92,
    metrics: [
      { label: "Missing rows", value: `${(col.null_count as number) ?? 0}` },
      { label: "Unique ratio", value: rowCount > 0 ? `${((((col.unique_count as number) ?? 0) / rowCount) * 100).toFixed(1)}%` : "N/A" },
    ],
  }));

  const { data: correlations, isLoading: loadingCorr } = useQuery({
    queryKey: ["correlations", activeTargetId],
    queryFn: () => apiFetch<Correlations>(`/analytics/${activeTargetId}/correlations`),
    enabled: !!activeTargetId,
  });

  const { data: trendsResp, isLoading: loadingTrends } = useQuery({
    queryKey: ["trends", activeTargetId],
    queryFn: () => apiFetch<{ trends: Trend[] }>(`/analytics/${activeTargetId}/trends`),
    enabled: !!activeTargetId,
  });
  const trends = trendsResp?.trends || [];

  const { data: outliersResp, isLoading: loadingOutliers } = useQuery({
    queryKey: ["outliers", activeTargetId],
    queryFn: () => apiFetch<{ outliers: Outlier[] }>(`/analytics/${activeTargetId}/outliers`),
    enabled: !!activeTargetId,
  });
  const outliers = outliersResp?.outliers || [];

  const numericColumns = useMemo<string[]>(() => {
    const c = (mainDataset?.columns as DatasetColumn[] | undefined) ?? [];
    return c.filter((c) => c?.inferred_type === "numeric").map((c) => c.name);
  }, [mainDataset]);

  useEffect(() => {
    if (numericColumns.length === 0) return;
    if (!forecastCol || !numericColumns.includes(forecastCol)) setForecastCol(numericColumns[0]);
    if (!anomalyCol || !numericColumns.includes(anomalyCol)) setAnomalyCol(numericColumns[0]);
  }, [numericColumns, forecastCol, anomalyCol]);

  const { data: forecast, isLoading: loadingForecast } = useQuery({
    queryKey: ["forecast", activeTargetId, forecastCol],
    queryFn: () => apiFetch<ForecastResponse>(
      `/analytics/${activeTargetId}/forecast?column=${encodeURIComponent(forecastCol)}&periods=12`,
    ),
    enabled: !!activeTargetId && !!forecastCol && tab === "forecast",
  });

  const { data: anomalies, isLoading: loadingAnomalies } = useQuery({
    queryKey: ["anomalies", activeTargetId, anomalyCol, zThreshold],
    queryFn: () => apiFetch<AnomalyResponse>(
      `/analytics/${activeTargetId}/anomalies?column=${encodeURIComponent(anomalyCol)}&threshold=${zThreshold}`,
    ),
    enabled: !!activeTargetId && !!anomalyCol && tab === "anomalies",
  });

  const loading = !dbResp || (!!activeTargetId && (loadingPreview || loadingProfile));
  const advancedLoading = loadingForecast || loadingAnomalies || loadingCorr || loadingTrends || loadingOutliers;

  const { data: distResp, isLoading: loadingDist, isError: errorDist } = useQuery({
    queryKey: ["distributions", activeTargetId],
    queryFn: () => apiFetch<any>(`/analytics/${activeTargetId}/distributions`),
    enabled: !!activeTargetId && tab === "distributions",
    retry: false,
  });
  const { data: qualityResp, isLoading: loadingQuality, isError: errorQuality } = useQuery({
    queryKey: ["quality", activeTargetId],
    queryFn: () => apiFetch<any>(`/analytics/${activeTargetId}/quality`),
    enabled: !!activeTargetId && tab === "quality",
    retry: false,
  });
  const { data: relResp, isLoading: loadingRel, isError: errorRel } = useQuery({
    queryKey: ["relationships", activeTargetId],
    queryFn: () => apiFetch<any>(`/analytics/${activeTargetId}/relationships`),
    enabled: !!activeTargetId && tab === "relationships",
    retry: false,
  });
  const { data: driftResp, isLoading: loadingDrift, isError: errorDrift } = useQuery({
    queryKey: ["drift", activeTargetId],
    queryFn: () => apiFetch<any>(`/analytics/${activeTargetId}/drift`),
    enabled: !!activeTargetId && tab === "drift",
    retry: false,
  });

  const tabs: { id: Tab; label: string; icon: typeof Activity }[] = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "quality", label: "Quality", icon: Gauge },
    { id: "distributions", label: "Distributions", icon: BarChart2 },
    { id: "correlations", label: "Correlations", icon: Grid3x3 },
    { id: "relationships", label: "Relationships", icon: Network },
    { id: "trends", label: "Trends", icon: TrendingUp },
    { id: "outliers", label: "Outliers", icon: AlertTriangle },
    { id: "drift", label: "Drift", icon: Signal },
    { id: "importance", label: "Importance", icon: Target },
    { id: "forecast", label: "Forecast", icon: LineChart },
    { id: "anomalies", label: "Anomalies", icon: Radar },
  ];

  const datasetMeta = datasets.find((d: any) => (d.id || d.dataset_id) === activeTargetId);
  const activeDatasetName = datasetMeta?.filename || datasetMeta?.name || mainDataset?.name || activeTargetId;

  return (
    <AppShell title="Insights" subtitle="Auto-generated findings from your latest dataset" status={loading ? "processing" : "ready"}>
      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-8" data-testid="insights-root">
        <div className="mb-8 animate-fade-in-up bg-card border border-border p-6 sm:p-8 rounded-2xl shadow-soft">
          <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-accent font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            Active Agent Analysis
          </span>
          <h1 className="mt-4 text-2xl sm:text-3xl font-bold text-foreground tracking-tight leading-tight max-w-4xl">
            {mainDataset ? `Synthesizing patterns across ${activeDatasetName}.` : "Upload a dataset to generate insights."}
          </h1>
          <p className="mt-3 text-[15px] sm:text-base text-muted-foreground leading-relaxed max-w-3xl">
            The agent pipeline is continuously scanning for anomalies, correlation shifts and trend resets.
            Flip between tabs to drill deeper without leaving the page.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-surface border border-border mb-6 overflow-x-auto scrollbar-none" role="tablist">
          {tabs.map((t) => (
            <button key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              data-testid={`tab-${t.id}`}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap shrink-0",
                tab === t.id ? "bg-accent text-accent-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && <Overview findings={findings} mainDataset={mainDataset ?? null} loading={loading} />}
        {tab === "quality" && <QualityPanel data={qualityResp ?? null} loading={loadingQuality} error={errorQuality} />}
        {tab === "distributions" && <DistributionsPanel data={distResp ?? null} loading={loadingDist} error={errorDist} />}
        {tab === "correlations" && <CorrelationsPanel data={correlations ?? null} />}
        {tab === "relationships" && <RelationshipsPanel data={relResp ?? null} loading={loadingRel} error={errorRel} />}
        {tab === "trends" && <TrendsPanel trends={trends} dataset={mainDataset ?? null} />}
        {tab === "outliers" && <OutliersPanel outliers={outliers} />}
        {tab === "drift" && <DriftPanel data={driftResp ?? null} loading={loadingDrift} error={errorDrift} />}
        {tab === "importance" && <ImportancePanel columns={numericColumns} datasetId={activeTargetId ?? ""} />}
        {tab === "forecast" && (
          <ForecastPanel
            columns={numericColumns}
            column={forecastCol}
            setColumn={setForecastCol}
            data={forecast ?? null}
            loading={advancedLoading}
          />
        )}
        {tab === "anomalies" && (
          <AnomalyPanel
            columns={numericColumns}
            column={anomalyCol}
            setColumn={setAnomalyCol}
            threshold={zThreshold}
            setThreshold={setZThreshold}
            data={anomalies ?? null}
            loading={advancedLoading}
          />
        )}

        <p className="mt-10 text-xs text-muted-foreground text-center">
          <Sparkles className="h-3 w-3 inline mr-1" />
          Always verify critical decisions with source data
        </p>
      </div>
    </AppShell>
  );
};

/* ---------- tabs ---------- */

const Overview = ({ findings, mainDataset, loading }: { findings: Finding[]; mainDataset: DatasetPreview | null; loading: boolean }) => {
  const columns = (mainDataset?.columns ?? []) as DatasetColumn[];
  const rowCount = mainDataset?.row_count ?? 0;
  const colCount = mainDataset?.col_count ?? columns.length;
  const sizeBytes = mainDataset?.size_bytes ?? 0;

  const numericCols = columns.filter(c => c.inferred_type === "numeric");
  const categoricalCols = columns.filter(c => c.inferred_type === "categorical");
  const datetimeCols = columns.filter(c => c.inferred_type === "datetime");
  const textCols = columns.filter(c => c.inferred_type === "text");
  const boolCols = columns.filter(c => c.inferred_type === "boolean");

  const totalNulls = columns.reduce((s, c) => s + (c.null_count ?? 0), 0);
  const totalCells = rowCount * colCount;
  const completeness = totalCells > 0 ? ((1 - totalNulls / totalCells) * 100) : 100;
  const totalUnique = columns.reduce((s, c) => s + (c.unique_count ?? 0), 0);

  const typeGroups = [
    { label: "Numeric", count: numericCols.length, color: "bg-blue-500", icon: Hash },
    { label: "Categorical", count: categoricalCols.length, color: "bg-violet-500", icon: Type },
    { label: "Datetime", count: datetimeCols.length, color: "bg-amber-500", icon: Calendar },
    { label: "Text", count: textCols.length, color: "bg-emerald-500", icon: FileSearch },
    { label: "Boolean", count: boolCols.length, color: "bg-rose-400", icon: CheckCircle2 },
  ].filter(g => g.count > 0);

  if (!mainDataset && !loading) {
    return (
      <div className="p-12 text-center border border-dashed border-border rounded-xl bg-surface/30">
        <Activity className="h-10 w-10 text-muted-foreground/20 mx-auto mb-4" />
        <p className="text-sm text-muted-foreground uppercase tracking-wider font-semibold">No insights yet</p>
        <p className="text-xs text-muted-foreground mt-1">Upload a dataset to trigger analysis</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[1,2,3].map(i => <div key={i} className="h-28 rounded-xl bg-surface animate-pulse" />)}
      </div>
    );
  }

  const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : n.toString();
  const fmtBytes = (b: number) => b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`;

  const qualityScore = Math.round(completeness * 0.4 + (columns.filter(c => (c.null_pct ?? 0) === 0).length / Math.max(colCount, 1)) * 30 + Math.min(30, (rowCount / 100) * 30));
  const sampleRows = (mainDataset?.rows ?? []).slice(0, 5);
  const colNames = columns.map(c => c.name);

  return (
    <section className="space-y-5">
      {/* ── Dataset Summary KPIs ─────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { icon: Database, label: "Rows", value: fmt(rowCount), accent: false },
          { icon: Columns3, label: "Columns", value: colCount.toString(), accent: false },
          { icon: ShieldCheck, label: "Completeness", value: `${completeness.toFixed(1)}%`, accent: completeness === 100 },
          { icon: Sparkles, label: "Quality Score", value: `${qualityScore}`, accent: qualityScore >= 90 },
          { icon: XCircle, label: "Missing", value: totalNulls === 0 ? "None" : fmt(totalNulls), accent: totalNulls === 0 },
          { icon: ArrowUpDown, label: "Size", value: sizeBytes > 0 ? fmtBytes(sizeBytes) : "—", accent: false },
        ].map((kpi, i) => (
          <div key={kpi.label} className="card-soft p-3.5 animate-fade-in-up" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center gap-2 mb-1.5">
              <kpi.icon className={cn("h-3.5 w-3.5", kpi.accent ? "text-success" : "text-accent")} />
              <span className="text-[11px] text-muted-foreground font-medium">{kpi.label}</span>
            </div>
            <p className={cn("text-lg font-semibold tabular-nums", kpi.accent ? "text-success" : "text-foreground")}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* ── Column Type Distribution ─────────────────────────── */}
      <div className="card-soft p-5 animate-fade-in-up" style={{ animationDelay: "180ms" }}>
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-accent" /> Column Type Distribution
        </h3>
        <div className="flex h-3 rounded-full overflow-hidden bg-surface mb-4">
          {typeGroups.map(g => (
            <div key={g.label} className={cn("transition-all duration-500", g.color)}
              style={{ width: `${(g.count / colCount) * 100}%` }}
              title={`${g.label}: ${g.count}`}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {typeGroups.map(g => (
            <div key={g.label} className="flex items-center gap-2">
              <span className={cn("h-2.5 w-2.5 rounded-full", g.color)} />
              <g.icon className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{g.label}</span>
              <span className="text-xs font-semibold tabular-nums text-foreground">{g.count}</span>
              <span className="text-[10px] text-muted-foreground">({((g.count / colCount) * 100).toFixed(0)}%)</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Per-Column Deep Profiles ─────────────────────────── */}
      <div className="card-soft p-5 animate-fade-in-up" style={{ animationDelay: "260ms" }}>
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <FileSearch className="h-4 w-4 text-accent" /> Column Profiles
          <span className="ml-auto text-[11px] text-muted-foreground font-normal">{columns.length} columns · click to expand</span>
        </h3>
        <div className="space-y-2">
          {columns.map((col, i) => (
            <ColumnProfile key={col.name} col={col} rowCount={rowCount} index={i} />
          ))}
        </div>
      </div>

      {/* ── Statistical Highlights ──────────────────────────────── */}
      {numericCols.length > 0 && (
        <div className="card-soft p-5 animate-fade-in-up" style={{ animationDelay: "340ms" }}>
          <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-accent" /> Numeric Range Distribution
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">Range bar with mean (μ) marker · CV = coefficient of variation</p>
          <div className="space-y-3">
            {numericCols.map(col => {
              const min = Number(col.min_val ?? 0);
              const max = Number(col.max_val ?? 0);
              const mean = Number(col.mean_val ?? 0);
              const range = max - min || 1;
              const meanPct = Math.max(0, Math.min(100, ((mean - min) / range) * 100));
              const stdVal = Number(col.std_val ?? 0);
              const cv = mean !== 0 ? Math.abs(stdVal / mean) * 100 : 0;

              return (
                <div key={col.name} className="rounded-lg bg-surface/50 border border-border/60 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-foreground">{col.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground font-mono">σ {stdVal.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-mono font-medium",
                        cv > 100 ? "bg-destructive/10 text-destructive" : cv > 50 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
                      )}>CV {cv.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="relative h-2 rounded-full bg-blue-500/15 overflow-visible">
                    <div className="absolute h-full rounded-full bg-blue-500/40" style={{ left: "0%", width: "100%" }} />
                    <div className="absolute top-1/2 -translate-y-1/2 h-3.5 w-0.5 bg-blue-600 rounded-full" style={{ left: `${meanPct}%` }} title={`Mean: ${mean.toLocaleString()}`} />
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[10px] text-muted-foreground font-mono">{min.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                    <span className="text-[10px] text-blue-500 font-mono font-medium">μ {mean.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{max.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Categorical Concentration ──────────────────────────── */}
      {categoricalCols.length > 0 && (
        <div className="card-soft p-5 animate-fade-in-up" style={{ animationDelay: "420ms" }}>
          <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Layers className="h-4 w-4 text-accent" /> Categorical Concentration
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">Cardinality analysis for categorical fields</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {categoricalCols.map(col => {
              const uniqueCount = col.unique_count ?? 0;
              const uniqueRatio = rowCount > 0 ? (uniqueCount / rowCount) * 100 : 0;
              const isId = uniqueRatio > 95;

              return (
                <div key={col.name} className="rounded-lg bg-surface/50 border border-border/60 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-foreground truncate">{col.name}</span>
                    <div className="flex items-center gap-1.5">
                      {isId && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 font-mono">likely ID</span>}
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-mono",
                        col.cardinality === "low" ? "bg-success/10 text-success" : col.cardinality === "high" ? "bg-warning/10 text-warning" : "bg-surface text-muted-foreground"
                      )}>{col.cardinality}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-lg font-semibold tabular-nums text-foreground">{uniqueCount.toLocaleString()}</span>
                    <span className="text-[10px] text-muted-foreground">distinct values across {rowCount.toLocaleString()} rows</span>
                  </div>
                  {/* Mini uniqueness bar */}
                  <div className="h-1 rounded-full bg-border/40 mt-2 overflow-hidden">
                    <div className="h-full rounded-full bg-violet-500/60" style={{ width: `${Math.min(uniqueRatio, 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Data Sample ──────────────────────────────── */}
      {sampleRows.length > 0 && colNames.length > 0 && (
        <div className="card-soft p-5 animate-fade-in-up" style={{ animationDelay: "500ms" }}>
          <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Database className="h-4 w-4 text-accent" /> Data Sample
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">First {sampleRows.length} rows from the dataset</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">#</th>
                  {colNames.map(n => (
                    <th key={n} className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border whitespace-nowrap">{n}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sampleRows.map((row, ri) => (
                  <tr key={ri} className="border-b border-border/40 hover:bg-surface/40 transition-colors">
                    <td className="px-3 py-1.5 text-[11px] text-muted-foreground font-mono">{ri + 1}</td>
                    {colNames.map(n => (
                      <td key={n} className="px-3 py-1.5 text-[11px] font-mono text-foreground truncate max-w-[180px]" title={String(row[n] ?? "")}>
                        {row[n] != null ? String(row[n]) : <span className="text-muted-foreground/40">null</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};

/* ── Column Profile Sub-component ──────────────────────────── */
const ColumnProfile = ({ col, rowCount, index }: { col: DatasetColumn; rowCount: number; index: number }) => {
  const [expanded, setExpanded] = useState(false);
  const nullPct = col.null_pct ?? 0;
  const uniqueCount = col.unique_count ?? 0;
  const uniqueRatio = rowCount > 0 ? (uniqueCount / rowCount) * 100 : 0;
  const typeIcon = {
    numeric: Hash, categorical: Type, datetime: Calendar, text: FileSearch, boolean: CheckCircle2,
  }[col.inferred_type ?? "categorical"] ?? Type;
  const TypeIcon = typeIcon;
  const typeColor = {
    numeric: "text-blue-500 bg-blue-500/10", categorical: "text-violet-500 bg-violet-500/10",
    datetime: "text-amber-500 bg-amber-500/10", text: "text-emerald-500 bg-emerald-500/10",
    boolean: "text-rose-400 bg-rose-400/10",
  }[col.inferred_type ?? "categorical"] ?? "text-muted-foreground bg-surface";

  return (
    <div className="rounded-lg border border-border/60 bg-surface/30 transition-all hover:border-accent/20">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 p-3 text-left">
        <div className={cn("h-7 w-7 rounded-md flex items-center justify-center shrink-0", typeColor)}>
          <TypeIcon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">{col.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-muted-foreground font-mono">
              {col.inferred_type}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[10px] text-muted-foreground font-mono">{col.dtype}</span>
            <span className="text-[10px] text-muted-foreground">·</span>
            <span className="text-[10px] text-muted-foreground">{uniqueCount.toLocaleString()} unique</span>
            {nullPct > 0 && (
              <>
                <span className="text-[10px] text-muted-foreground">·</span>
                <span className={cn("text-[10px] font-medium", nullPct > 20 ? "text-destructive" : nullPct > 5 ? "text-warning" : "text-muted-foreground")}>
                  {nullPct.toFixed(1)}% missing
                </span>
              </>
            )}
            {nullPct === 0 && (
              <>
                <span className="text-[10px] text-muted-foreground">·</span>
                <span className="text-[10px] text-success font-medium">✓ complete</span>
              </>
            )}
          </div>
        </div>
        <svg className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200", expanded && "rotate-180")} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-border/40">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {col.inferred_type === "numeric" && (
              <>
                <MiniStat label="Min" value={col.min_val != null ? Number(col.min_val).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"} />
                <MiniStat label="Max" value={col.max_val != null ? Number(col.max_val).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"} />
                <MiniStat label="Mean" value={col.mean_val != null ? Number(col.mean_val).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"} />
                <MiniStat label="Std Dev" value={col.std_val != null ? Number(col.std_val).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"} />
              </>
            )}
            {col.inferred_type === "datetime" && (
              <>
                <MiniStat label="Earliest" value={col.min_val != null ? String(col.min_val).split("T")[0] : "—"} />
                <MiniStat label="Latest" value={col.max_val != null ? String(col.max_val).split("T")[0] : "—"} />
                <MiniStat label="Unique Dates" value={uniqueCount.toLocaleString()} />
                <MiniStat label="Coverage" value={`${(100 - nullPct).toFixed(1)}%`} />
              </>
            )}
            {(col.inferred_type === "categorical" || col.inferred_type === "text" || col.inferred_type === "boolean") && (
              <>
                <MiniStat label="Unique Values" value={uniqueCount.toLocaleString()} />
                <MiniStat label="Cardinality" value={col.cardinality ?? "—"} />
                <MiniStat label="Unique Ratio" value={`${uniqueRatio.toFixed(1)}%`} />
                <MiniStat label="Null Count" value={(col.null_count ?? 0).toLocaleString()} />
              </>
            )}
          </div>
          {/* Sample values */}
          {col.sample_values && col.sample_values.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">Sample Values</p>
              <div className="flex flex-wrap gap-1.5">
                {col.sample_values.slice(0, 8).map((v, j) => (
                  <span key={j} className="text-[11px] px-2 py-0.5 rounded-md bg-surface border border-border font-mono text-foreground truncate max-w-[200px]">
                    {String(v)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const MiniStat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md bg-card border border-border/50 px-2.5 py-2">
    <p className="text-[10px] text-muted-foreground">{label}</p>
    <p className="text-xs font-semibold tabular-nums text-foreground mt-0.5 truncate">{value}</p>
  </div>
);

const CorrelationsPanel = ({ data }: { data: Correlations | null }) => {
  const heatmap = useMemo(() => {
    if (!data || !data.matrix.length) return null;
    return data.columns.map((col, i) => ({
      col,
      cells: data.columns.map((c2, j) => ({ col: c2, value: data.matrix[i][j] ?? 0 })),
    }));
  }, [data]);

  if (!heatmap) {
    return <EmptyState icon={Grid3x3} title="No numeric columns to correlate" subtitle="Upload a dataset with numeric fields to surface correlations." />;
  }

  return (
    <div className="space-y-4">
      <div className="card-soft p-5 overflow-auto">
        <h3 className="text-sm font-semibold mb-3">Pearson correlation heatmap</h3>
        <table className="text-[11px] font-mono">
          <thead>
            <tr>
              <th className="sticky left-0 bg-card px-2 py-1 text-left text-muted-foreground">·</th>
              {data!.columns.map((c) => (
                <th key={c} className="px-2 py-1 text-left text-muted-foreground whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatmap.map((row) => (
              <tr key={row.col}>
                <th className="sticky left-0 bg-card px-2 py-1 text-left text-foreground font-medium whitespace-nowrap">{row.col}</th>
                {row.cells.map((cell) => (
                  <td key={cell.col} className="px-0.5 py-0.5">
                    <div
                      title={`${row.col} ↔ ${cell.col}: ${cell.value.toFixed(3)}`}
                      className="h-8 w-12 rounded-sm flex items-center justify-center text-[10px] font-semibold tabular-nums"
                      style={{
                        background: correlationColor(cell.value),
                        color: Math.abs(cell.value) > 0.5 ? "white" : "inherit",
                      }}
                    >
                      {cell.value.toFixed(2)}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data?.pairs && data.pairs.length > 0 && (
        <div className="card-soft p-5">
          <h3 className="text-sm font-semibold mb-3">Top correlated pairs vs. <span className="font-mono text-accent">{data.columns[0]}</span></h3>
          <ul className="divide-y divide-border">
            {data.pairs.slice(0, 6).map((p) => (
              <li key={p.column} className="py-2 flex items-center justify-between gap-3">
                <span className="text-sm">{p.column}</span>
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "text-[11px] px-2 py-0.5 rounded-full font-mono",
                    p.significant ? "bg-success/10 text-success" : "bg-surface text-muted-foreground"
                  )}>
                    {p.strength}
                  </span>
                  <span className="text-sm font-semibold tabular-nums" style={{ color: correlationTextColor(p.pearson_r) }}>
                    {p.pearson_r >= 0 ? "+" : ""}{p.pearson_r.toFixed(3)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const TrendsPanel = ({ trends, dataset }: { trends: Trend[]; dataset: DatasetPreview | null }) => {
  if (!trends.length) {
    return <EmptyState icon={TrendingUp} title="No time-series trends available" subtitle="Trends require a date/time column and at least one numeric column." />;
  }
  return (
    <div className="space-y-3">
      {trends.map((t) => (
        <div key={t.value_column} className="card-soft p-5">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{t.value_column}</h3>
              <p className="text-[11px] text-muted-foreground">{t.data_points} points · {dataset?.name ?? ""}</p>
            </div>
            <div className="text-right">
              <span className={cn(
                "text-xs px-2 py-0.5 rounded-full font-semibold",
                t.direction === "upward" ? "bg-success/10 text-success" : t.direction === "downward" ? "bg-destructive/10 text-destructive" : "bg-surface text-muted-foreground",
              )}>{t.direction} · {t.strength}</span>
              <p className="text-lg font-semibold tabular-nums mt-1">{t.pct_change_total >= 0 ? "+" : ""}{t.pct_change_total.toFixed(1)}%</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
            <span>R² {t.r_squared.toFixed(3)}</span>
            <span>·</span>
            <span>{t.significant ? "statistically significant" : "not significant"}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

const OutliersPanel = ({ outliers }: { outliers: Outlier[] }) => {
  if (!outliers.length) {
    return <EmptyState icon={AlertTriangle} title="No outliers detected" subtitle="Numeric columns look within expected bounds." />;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {outliers.map((o) => (
        <div key={o.column} className="card-soft p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{o.column}</h3>
            <span className={cn(
              "text-[11px] px-2 py-0.5 rounded-full font-mono",
              o.outlier_pct > 5 ? "bg-destructive/10 text-destructive" : "bg-surface text-muted-foreground",
            )}>{o.outlier_pct.toFixed(1)}%</span>
          </div>
          <p className="text-2xl font-semibold tabular-nums mt-1">{o.outlier_count}</p>
          <p className="text-[11px] text-muted-foreground mt-1 font-mono">
            IQR fences: {o.lower_fence?.toFixed(2)} → {o.upper_fence?.toFixed(2)}
          </p>
        </div>
      ))}
    </div>
  );
};

const EmptyState = ({ icon: Icon, title, subtitle }: { icon: typeof Activity; title: string; subtitle: string }) => (
  <div className="p-12 text-center border border-dashed border-border rounded-xl bg-surface/30">
    <Icon className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
    <p className="text-sm text-muted-foreground uppercase tracking-wider font-semibold">{title}</p>
    <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
  </div>
);

const ForecastPanel = ({
  columns, column, setColumn, data, loading,
}: {
  columns: string[];
  column: string;
  setColumn: (c: string) => void;
  data: ForecastResponse | null;
  loading: boolean;
}) => {
  const chartData = useMemo(() => {
    if (!data) return [];
    const history = data.history.map((p) => ({ date: p.date, history: p.value }));
    const smoothed = data.smoothed.map((p) => ({ date: p.date, smoothed: p.value }));
    const forecast = data.forecast.map((p) => ({ date: p.date, forecast: p.value }));
    const merged = new Map<string, Record<string, unknown>>();
    for (const rows of [history, smoothed, forecast]) {
      for (const row of rows) {
        const existing = (merged.get(row.date) ?? { date: row.date }) as Record<string, unknown>;
        merged.set(row.date, { ...existing, ...row });
      }
    }
    return Array.from(merged.values());
  }, [data]);

  if (columns.length === 0) {
    return <EmptyState icon={LineChart} title="No numeric columns" subtitle="Forecasting needs at least one numeric + one date column." />;
  }

  const slopeLabel = data
    ? `${data.slope > 0 ? "+" : ""}${data.slope.toFixed(3)} per period`
    : "";

  return (
    <div className="space-y-4">
      <div className="card-soft p-5 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">Linear forecast</h3>
            <p className="text-[11px] text-muted-foreground">Monthly resample + 12-period linear projection.</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="forecast-column" className="text-[11px] text-muted-foreground">Column</label>
            <select
              id="forecast-column"
              value={column}
              onChange={(e) => setColumn(e.target.value)}
              data-testid="forecast-column-select"
              className="h-8 rounded-md border border-border bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {loading && !data && <SkeletonChart />}

        {data && chartData.length > 0 && (
          <div className="space-y-3">
            <DynamicChart spec={{
              chart: "line",
              data: chartData,
              xKey: "date",
              series: [
                { key: "history", label: "History" },
                { key: "smoothed", label: "Rolling mean" },
                { key: "forecast", label: "Forecast" },
              ],
            }} />
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
              <span>slope {slopeLabel}</span>
              <span>·</span>
              <span>intercept {data.intercept.toFixed(2)}</span>
              <span>·</span>
              <span>{data.history.length} history points · {data.forecast.length} future</span>
            </div>
          </div>
        )}

        {!loading && !data && (
          <p className="text-xs text-muted-foreground">Select a column to compute a forecast.</p>
        )}
      </div>
    </div>
  );
};

const AnomalyPanel = ({
  columns, column, setColumn, threshold, setThreshold, data, loading,
}: {
  columns: string[];
  column: string;
  setColumn: (c: string) => void;
  threshold: number;
  setThreshold: (t: number) => void;
  data: AnomalyResponse | null;
  loading: boolean;
}) => {
  if (columns.length === 0) {
    return <EmptyState icon={Radar} title="No numeric columns" subtitle="Pick a dataset with numeric fields to scan for anomalies." />;
  }

  return (
    <div className="space-y-4">
      <div className="card-soft p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h3 className="text-sm font-semibold">Z-score anomaly scan</h3>
            <p className="text-[11px] text-muted-foreground">Flags rows where the standardized value exceeds the threshold.</p>
          </div>
          <div className="ml-auto flex items-center gap-3 flex-wrap">
            <label htmlFor="anomaly-column" className="text-[11px] text-muted-foreground">Column</label>
            <select
              id="anomaly-column"
              value={column}
              onChange={(e) => setColumn(e.target.value)}
              data-testid="anomaly-column-select"
              className="h-8 rounded-md border border-border bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label htmlFor="anomaly-threshold" className="text-[11px] text-muted-foreground">|z|</label>
            <input
              id="anomaly-threshold"
              type="number"
              min={1}
              max={6}
              step={0.25}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              data-testid="anomaly-threshold-input"
              className="h-8 w-20 rounded-md border border-border bg-card px-2 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>
        </div>

        {loading && !data && <SkeletonChart />}

        {data && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <StatBlock label="Count" value={data.count.toString()} />
              <StatBlock label="Rate" value={`${data.rate_pct.toFixed(2)}%`} />
              <StatBlock label="Threshold" value={`|z| > ${data.threshold.toFixed(1)}`} />
            </div>

            {data.anomalies.length > 0 ? (
              <div className="overflow-x-auto max-h-[320px] rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Row</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Value</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Z-score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.anomalies.slice(0, 40).map((p) => (
                      <tr key={p.index} className="border-t border-border/60">
                        <td className="px-4 py-2 text-xs font-mono text-muted-foreground">#{p.index}</td>
                        <td className="px-4 py-2 text-right text-sm tabular-nums">{p.value.toLocaleString()}</td>
                        <td className={cn(
                          "px-4 py-2 text-right text-sm tabular-nums font-semibold",
                          Math.abs(p.z_score) > data.threshold * 1.3 ? "text-destructive" : "text-warning",
                        )}>
                          {p.z_score >= 0 ? "+" : ""}{p.z_score.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No anomalies at this threshold — try lowering it.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const SkeletonChart = () => (
  <div className="space-y-3">
    <div className="h-64 rounded-lg bg-surface animate-pulse" />
    <div className="h-3 w-2/3 rounded-full bg-surface animate-pulse" />
  </div>
);

const StatBlock = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg bg-surface border border-border p-3">
    <p className="text-[11px] text-muted-foreground">{label}</p>
    <p className="text-lg font-semibold tabular-nums mt-0.5">{value}</p>
  </div>
);

/* ---------- NEW: Quality Panel ---------- */

const QualityPanel = ({ data, loading, error }: { data: any | null; loading: boolean; error: boolean }) => {
  if (error) return <EmptyState icon={Gauge} title="Unable to load quality analysis" subtitle="The backend server may need to be restarted with the latest code. Rebuild & restart Docker containers." />;
  if (loading || !data) return <div className="space-y-3"><SkeletonChart /><div className="grid grid-cols-4 gap-3">{[1,2,3,4].map(i => <div key={i} className="h-20 rounded-lg bg-surface animate-pulse" />)}</div></div>;

  const factors = [
    { label: "Completeness", value: data.completeness, color: "bg-blue-500" },
    { label: "Uniqueness", value: data.uniqueness, color: "bg-violet-500" },
    { label: "Consistency", value: data.consistency, color: "bg-emerald-500" },
    { label: "Validity", value: data.validity, color: "bg-amber-500" },
  ];
  const gradeColor: Record<string, string> = { A: "text-success", B: "text-blue-500", C: "text-warning", D: "text-orange-500", F: "text-destructive" };

  return (
    <div className="space-y-4">
      {/* Score Header */}
      <div className="card-soft p-6 text-center animate-fade-in-up">
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground font-semibold mb-2">Overall Data Quality</p>
        <div className="flex items-center justify-center gap-4">
          <span className={cn("text-6xl font-bold tabular-nums", gradeColor[data.grade] || "text-foreground")}>{data.grade}</span>
          <div className="text-left">
            <p className="text-3xl font-semibold tabular-nums text-foreground">{data.overall_score}<span className="text-base text-muted-foreground">/100</span></p>
            <p className="text-xs text-muted-foreground mt-0.5">{data.missing_cells.toLocaleString()} missing · {data.duplicate_rows} duplicates</p>
          </div>
        </div>
      </div>

      {/* Factor Bars */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {factors.map((f, i) => (
          <div key={f.label} className="card-soft p-4 animate-fade-in-up" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">{f.label}</span>
              <span className="text-sm font-semibold tabular-nums">{f.value.toFixed(1)}%</span>
            </div>
            <div className="h-2 rounded-full bg-border overflow-hidden">
              <div className={cn("h-full rounded-full transition-all duration-700", f.color)} style={{ width: `${f.value}%` }} />
            </div>
          </div>
        ))}
      </div>

      {/* Suggestions */}
      {data.suggestions?.length > 0 && (
        <div className="card-soft p-5 animate-fade-in-up" style={{ animationDelay: "300ms" }}>
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" /> Auto-Fix Suggestions
          </h3>
          <div className="space-y-2">
            {data.suggestions.map((s: any, i: number) => (
              <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-surface/50 border border-border/60">
                <span className={cn("text-[10px] px-2 py-0.5 rounded font-mono uppercase",
                  s.action.includes("drop") ? "bg-destructive/10 text-destructive" : "bg-accent/10 text-accent"
                )}>{s.action}</span>
                <span className="text-xs text-foreground flex-1">{s.reason}</span>
                {s.column !== "_rows_" && <span className="text-[10px] text-muted-foreground font-mono">{s.column}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ---------- NEW: Distributions Panel ---------- */

const DistributionsPanel = ({ data, loading, error }: { data: any | null; loading: boolean; error: boolean }) => {
  if (error) return <EmptyState icon={BarChart2} title="Unable to load distributions" subtitle="The backend server may need to be restarted with the latest code. Rebuild & restart Docker containers." />;
  if (loading) return <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="card-soft p-5"><div className="h-6 w-40 bg-surface animate-pulse rounded mb-3" /><div className="h-20 bg-surface animate-pulse rounded" /></div>)}</div>;
  if (!data?.distributions?.length) return <EmptyState icon={BarChart2} title="No distributions available" subtitle="Upload a dataset with numeric columns to see statistical distributions." />;

  return (
    <div className="space-y-4">
      {data.distributions.map((dist: any, idx: number) => {
        const maxCount = Math.max(...dist.bins.map((b: any) => b.count));
        return (
          <div key={dist.column} className="card-soft p-5 animate-fade-in-up" style={{ animationDelay: `${idx * 80}ms` }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{dist.column}</h3>
                <p className="text-[11px] text-muted-foreground">{dist.n.toLocaleString()} values · μ={dist.mean.toLocaleString()} · σ={dist.std.toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn("text-[10px] px-2 py-0.5 rounded font-mono",
                  dist.is_normal ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                )}>{dist.is_normal ? "Normal ✓" : "Non-normal"}</span>
                <span className={cn("text-[10px] px-2 py-0.5 rounded font-mono bg-surface text-muted-foreground")}>{dist.skew_label}</span>
                <span className={cn("text-[10px] px-2 py-0.5 rounded font-mono bg-surface text-muted-foreground")}>{dist.kurt_label}</span>
              </div>
            </div>
            {/* Mini Histogram */}
            <div className="flex items-end gap-px h-20 mb-2">
              {dist.bins.map((bin: any, i: number) => (
                <div key={i} className="flex-1 flex flex-col items-center justify-end" title={`${bin.lo.toFixed(1)} – ${bin.hi.toFixed(1)}: ${bin.count}`}>
                  <div className="w-full bg-blue-500/60 hover:bg-blue-500 rounded-t-sm transition-colors"
                    style={{ height: `${(bin.count / (maxCount || 1)) * 100}%`, minHeight: bin.count > 0 ? "2px" : "0px" }} />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
              <span>{dist.p5.toLocaleString()} (P5)</span>
              <span className="text-blue-500 font-medium">μ {dist.mean.toLocaleString()}</span>
              <span>{dist.p95.toLocaleString()} (P95)</span>
            </div>
            <div className="grid grid-cols-4 gap-2 mt-3">
              <MiniStat label="Skewness" value={dist.skewness.toFixed(3)} />
              <MiniStat label="Kurtosis" value={dist.kurtosis.toFixed(3)} />
              <MiniStat label="CV%" value={`${dist.cv_pct.toFixed(1)}%`} />
              <MiniStat label="Shapiro p" value={dist.shapiro_p < 0.001 ? "<0.001" : dist.shapiro_p.toFixed(3)} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ---------- NEW: Relationships Panel ---------- */

const RelationshipsPanel = ({ data, loading, error }: { data: any | null; loading: boolean; error: boolean }) => {
  if (error) return <EmptyState icon={Network} title="Unable to load relationships" subtitle="The backend server may need to be restarted with the latest code. Rebuild & restart Docker containers." />;
  if (loading) return <SkeletonChart />;
  const rels = data?.relationships ?? [];
  if (!rels.length) return <EmptyState icon={Network} title="No relationships discovered" subtitle="The engine auto-detects FK candidates, functional dependencies, and constant ratios between columns." />;

  const typeColor: Record<string, string> = {
    categorical_overlap: "bg-violet-500/10 text-violet-500",
    functional_dependency: "bg-emerald-500/10 text-emerald-500",
    constant_ratio: "bg-blue-500/10 text-blue-500",
  };

  return (
    <div className="space-y-3">
      <div className="card-soft p-5">
        <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
          <Network className="h-4 w-4 text-accent" /> Auto-Discovered Relationships
        </h3>
        <p className="text-[11px] text-muted-foreground mb-4">{rels.length} relationships found — FK candidates, dependencies, and constant ratios.</p>
        <div className="space-y-2">
          {rels.map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-surface/50 border border-border/60 animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
              <span className={cn("text-[10px] px-2 py-0.5 rounded font-mono uppercase whitespace-nowrap", typeColor[r.type] || "bg-surface text-muted-foreground")}>{r.type.replace(/_/g, " ")}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="font-mono font-medium text-foreground">{r.col_a}</span>
                  <span className="text-muted-foreground">↔</span>
                  <span className="font-mono font-medium text-foreground">{r.col_b}</span>
                </div>
                <p className="text-[10px] text-muted-foreground truncate">{r.hint}</p>
              </div>
              <span className="text-xs font-semibold tabular-nums text-foreground shrink-0">{typeof r.overlap_pct === "number" && r.overlap_pct > 1 ? `${r.overlap_pct}%` : r.overlap_pct}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ---------- NEW: Drift Panel ---------- */

const DriftPanel = ({ data, loading, error }: { data: any | null; loading: boolean; error: boolean }) => {
  if (error) return <EmptyState icon={Signal} title="Unable to load drift analysis" subtitle="The backend server may need to be restarted with the latest code. Rebuild & restart Docker containers." />;
  if (loading) return <SkeletonChart />;
  if (!data || data.error) return <EmptyState icon={Signal} title={data?.error || "Drift detection requires 20+ rows"} subtitle="The engine splits your data in half and compares distributions using KS-test & Population Stability Index (PSI)." />;

  const results = data.drift_results ?? [];
  const driftColor: Record<string, string> = { low: "bg-success/10 text-success", moderate: "bg-warning/10 text-warning", high: "bg-destructive/10 text-destructive" };

  return (
    <div className="space-y-4">
      <div className="card-soft p-5 animate-fade-in-up">
        <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
          <Signal className="h-4 w-4 text-accent" /> Data Drift Analysis
        </h3>
        <p className="text-[11px] text-muted-foreground mb-4">Split at row {data.split_at_row.toLocaleString()} of {data.total_rows.toLocaleString()} · {data.columns_drifted}/{data.columns_analyzed} columns show drift</p>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatBlock label="Columns Analyzed" value={String(data.columns_analyzed)} />
          <StatBlock label="Drifted" value={String(data.columns_drifted)} />
          <StatBlock label="Split Point" value={`Row ${data.split_at_row.toLocaleString()}`} />
        </div>
      </div>

      <div className="space-y-2">
        {results.map((r: any, i: number) => (
          <div key={r.column} className="card-soft p-4 animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">{r.column}</span>
              <span className={cn("text-[10px] px-2 py-0.5 rounded font-mono uppercase", driftColor[r.drift_level])}>{r.drift_level} drift</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <MiniStat label="KS Statistic" value={r.ks_statistic.toFixed(4)} />
              <MiniStat label="PSI" value={r.psi.toFixed(4)} />
              <MiniStat label="Mean (1st half)" value={r.mean_a.toLocaleString()} />
              <MiniStat label="Mean (2nd half)" value={r.mean_b.toLocaleString()} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ---------- NEW: Importance Panel ---------- */

const ImportancePanel = ({ columns, datasetId }: { columns: string[]; datasetId: string }) => {
  const [target, setTarget] = useState(columns[0] || "");

  useEffect(() => {
    if (columns.length > 0 && !columns.includes(target)) setTarget(columns[0]);
  }, [columns, target]);

  const { data, isLoading } = useQuery({
    queryKey: ["importance", datasetId, target],
    queryFn: () => apiFetch<any>(`/analytics/${datasetId}/importance`, {
      method: "POST",
      body: JSON.stringify({ target_col: target }),
    }),
    enabled: !!datasetId && !!target,
  });

  if (columns.length === 0) return <EmptyState icon={Target} title="No numeric columns" subtitle="Feature importance needs numeric features and a target column." />;

  const features = data?.features ?? [];
  return (
    <div className="space-y-4">
      <div className="card-soft p-5 animate-fade-in-up">
        <div className="flex items-center gap-3 flex-wrap mb-4">
          <div>
            <h3 className="text-sm font-semibold">Feature Importance</h3>
            <p className="text-[11px] text-muted-foreground">Ranked by correlation + mutual information vs. target</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground">Target</label>
            <select value={target} onChange={(e) => setTarget(e.target.value)}
              className="h-8 rounded-md border border-border bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40">
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {isLoading && <SkeletonChart />}

        {features.length > 0 && (
          <div className="space-y-2">
            {features.map((f: any, i: number) => (
              <div key={f.feature} className="flex items-center gap-3 animate-fade-in-up" style={{ animationDelay: `${i * 40}ms` }}>
                <span className="text-xs font-mono text-muted-foreground w-6 text-right">{i + 1}</span>
                <span className="text-sm font-medium text-foreground w-32 truncate">{f.feature}</span>
                <div className="flex-1 h-4 rounded-full bg-border/40 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-accent to-blue-500 transition-all duration-500"
                    style={{ width: `${f.importance_pct}%` }} />
                </div>
                <span className="text-xs font-semibold tabular-nums w-14 text-right">{f.importance_pct.toFixed(1)}%</span>
                <div className="hidden sm:flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground font-mono">r={f.correlation.toFixed(2)}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">MI={f.mutual_info.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {data?.error && <p className="text-xs text-destructive">{data.error}</p>}
      </div>
    </div>
  );
};

/* ---------- helpers ---------- */

function correlationColor(v: number): string {
  const intensity = Math.min(1, Math.abs(v));
  if (v >= 0) return `rgba(34, 197, 94, ${0.1 + intensity * 0.7})`; // green
  return `rgba(239, 68, 68, ${0.1 + intensity * 0.7})`; // red
}

function correlationTextColor(v: number): string {
  if (v >= 0.3) return "hsl(var(--success))";
  if (v <= -0.3) return "hsl(var(--destructive))";
  return "hsl(var(--foreground))";
}

export default Insights;
