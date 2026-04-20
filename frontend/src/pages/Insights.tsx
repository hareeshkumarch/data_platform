import { AppShell } from "@/components/layout/AppShell";
import { InsightCard } from "@/components/cards/InsightCard";
import { DynamicChart } from "@/components/charts/DynamicChart";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { ApiResponse, Dataset, DatasetColumn, DatasetPreview } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import { Sparkles, Activity, AlertTriangle, TrendingUp, Grid3x3, LineChart, Radar } from "lucide-react";
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

type Tab = "overview" | "correlations" | "trends" | "outliers" | "forecast" | "anomalies";

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

const Insights = () => {
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [mainDataset, setMainDataset] = useState<DatasetPreview | null>(null);
  const [correlations, setCorrelations] = useState<Correlations | null>(null);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [outliers, setOutliers] = useState<Outlier[]>([]);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyResponse | null>(null);
  const [forecastCol, setForecastCol] = useState<string>("");
  const [anomalyCol, setAnomalyCol] = useState<string>("");
  const [zThreshold, setZThreshold] = useState<number>(3.0);
  const [advancedLoading, setAdvancedLoading] = useState(false);
  const [activeTargetId, setActiveTargetId] = useState<string>("");
  const activeDatasetId = useAppStore((s) => s.dataset);

  const numericColumns = useMemo<string[]>(() => {
    const cols = (mainDataset?.columns as DatasetColumn[] | undefined) ?? [];
    return cols.filter((c) => c?.inferred_type === "numeric").map((c) => c.name);
  }, [mainDataset]);

  const loadOverview = async (targetId: string) => {
    try {
      const preview = await apiFetch<DatasetPreview>(`/datasets/${targetId}/preview`);
      setMainDataset(preview);

      const analyticsRec = await apiFetch<{ profile?: Array<Record<string, unknown>>; row_count?: number }>(`/analytics/${targetId}`, {
        method: "POST",
        body: JSON.stringify({ analysis_type: "profile", config: {} }),
      });
      const cols = analyticsRec.profile ?? [];
      const rowCount = analyticsRec.row_count ?? preview.row_count ?? 1;
      setFindings(cols.slice(0, 4).map((col) => ({
        tag: (col.inferred_type as string) ?? "Column",
        title: `Analysis of ${col.name as string}`,
        explanation: `Inferred as ${col.inferred_type}. Found ${(col.unique_count as number) ?? 0} unique values.`,
        confidence: 0.92,
        metrics: [
          { label: "Missing rows", value: `${(col.null_count as number) ?? 0}` },
          { label: "Unique ratio", value: rowCount > 0 ? `${((((col.unique_count as number) ?? 0) / rowCount) * 100).toFixed(1)}%` : "N/A" },
        ],
      })));
    } catch {
      setMainDataset(null);
      setFindings([]);
    }
  };

  const loadAdvanced = async (targetId: string) => {
    try {
      const [corr, tr, out] = await Promise.allSettled([
        apiFetch<Correlations>(`/analytics/${targetId}/correlations`),
        apiFetch<{ trends: Trend[] }>(`/analytics/${targetId}/trends`),
        apiFetch<{ outliers: Outlier[] }>(`/analytics/${targetId}/outliers`),
      ]);
      setCorrelations(corr.status === "fulfilled" ? corr.value : null);
      setTrends(tr.status === "fulfilled" ? tr.value.trends : []);
      setOutliers(out.status === "fulfilled" ? out.value.outliers : []);
    } catch {
      setCorrelations(null);
      setTrends([]);
      setOutliers([]);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const db: ApiResponse<Dataset> = await apiFetch("/datasets");
        const targetId = activeDatasetId && activeDatasetId !== "Select dataset"
          ? activeDatasetId
          : db.datasets?.[0]?.id;
        if (!targetId) { setLoading(false); return; }
        setActiveTargetId(targetId);
        await Promise.all([loadOverview(targetId), loadAdvanced(targetId)]);
      } finally {
        setLoading(false);
      }
    })();
  }, [activeDatasetId]);

  // Preselect the first numeric column for forecast / anomaly once schema loads
  useEffect(() => {
    if (numericColumns.length === 0) return;
    if (!forecastCol || !numericColumns.includes(forecastCol)) setForecastCol(numericColumns[0]);
    if (!anomalyCol || !numericColumns.includes(anomalyCol)) setAnomalyCol(numericColumns[0]);
  }, [numericColumns, forecastCol, anomalyCol]);

  const runForecast = async () => {
    if (!activeTargetId || !forecastCol) return;
    setAdvancedLoading(true);
    try {
      const data = await apiFetch<ForecastResponse>(
        `/analytics/${activeTargetId}/forecast?column=${encodeURIComponent(forecastCol)}&periods=12`,
      );
      setForecast(data);
    } catch {
      setForecast(null);
    } finally {
      setAdvancedLoading(false);
    }
  };

  const runAnomalies = async () => {
    if (!activeTargetId || !anomalyCol) return;
    setAdvancedLoading(true);
    try {
      const data = await apiFetch<AnomalyResponse>(
        `/analytics/${activeTargetId}/anomalies?column=${encodeURIComponent(anomalyCol)}&threshold=${zThreshold}`,
      );
      setAnomalies(data);
    } catch {
      setAnomalies(null);
    } finally {
      setAdvancedLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "forecast" && activeTargetId && forecastCol) void runForecast();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, activeTargetId, forecastCol]);

  useEffect(() => {
    if (tab === "anomalies" && activeTargetId && anomalyCol) void runAnomalies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, activeTargetId, anomalyCol, zThreshold]);

  const tabs: { id: Tab; label: string; icon: typeof Activity }[] = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "correlations", label: "Correlations", icon: Grid3x3 },
    { id: "trends", label: "Trends", icon: TrendingUp },
    { id: "outliers", label: "Outliers", icon: AlertTriangle },
    { id: "forecast", label: "Forecast", icon: LineChart },
    { id: "anomalies", label: "Anomalies", icon: Radar },
  ];

  return (
    <AppShell title="Insights" subtitle="Auto-generated findings from your latest dataset" status={loading ? "processing" : "ready"}>
      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-8" data-testid="insights-root">
        <div className="mb-8 animate-fade-in-up bg-card border border-border p-6 sm:p-8 rounded-2xl shadow-soft">
          <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-accent font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            Active Agent Analysis
          </span>
          <h1 className="mt-4 text-2xl sm:text-3xl font-bold text-foreground tracking-tight leading-tight max-w-4xl">
            {mainDataset ? `Synthesizing patterns across ${mainDataset.name}.` : "Upload a dataset to generate insights."}
          </h1>
          <p className="mt-3 text-[15px] sm:text-base text-muted-foreground leading-relaxed max-w-3xl">
            The agent pipeline is continuously scanning for anomalies, correlation shifts and trend resets.
            Flip between tabs to drill deeper without leaving the page.
          </p>
        </div>

        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-surface border border-border mb-6" role="tablist">
          {tabs.map((t) => (
            <button key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              data-testid={`tab-${t.id}`}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium transition-colors",
                tab === t.id ? "bg-accent text-accent-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && <Overview findings={findings} mainDataset={mainDataset} loading={loading} />}
        {tab === "correlations" && <CorrelationsPanel data={correlations} />}
        {tab === "trends" && <TrendsPanel trends={trends} dataset={mainDataset} />}
        {tab === "outliers" && <OutliersPanel outliers={outliers} />}
        {tab === "forecast" && (
          <ForecastPanel
            columns={numericColumns}
            column={forecastCol}
            setColumn={setForecastCol}
            data={forecast}
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
            data={anomalies}
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

const Overview = ({ findings, mainDataset, loading }: { findings: Finding[]; mainDataset: DatasetPreview | null; loading: boolean }) => (
  <section className="space-y-4">
    {findings.map((f, i) => (
      <InsightCard key={i} tag={f.tag} title={f.title} explanation={f.explanation}
        confidence={f.confidence} metrics={f.metrics} defaultOpen={i === 0} delay={i * 60}>
        {mainDataset?.rows && mainDataset.rows.length > 1 && (
          <DynamicChart spec={{
            chart: "area",
            data: mainDataset.rows,
            xKey: Object.keys(mainDataset.rows[0] || {})[0] || "index",
            series: [{ key: Object.keys(mainDataset.rows[0] || {})[1] || "value", label: "Trend" }],
          }} />
        )}
      </InsightCard>
    ))}
    {!loading && findings.length === 0 && (
      <div className="p-12 text-center border border-dashed border-border rounded-xl bg-surface/30">
        <Activity className="h-10 w-10 text-muted-foreground/20 mx-auto mb-4" />
        <p className="text-sm text-muted-foreground uppercase tracking-wider font-semibold">No insights yet</p>
        <p className="text-xs text-muted-foreground mt-1">Upload a dataset to trigger analysis</p>
      </div>
    )}
  </section>
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
  if (columns.length === 0) {
    return <EmptyState icon={LineChart} title="No numeric columns" subtitle="Forecasting needs at least one numeric + one date column." />;
  }

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
