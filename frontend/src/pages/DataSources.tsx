import { AppShell } from "@/components/layout/AppShell";
import { useState, useCallback, useEffect } from "react";
import {
  Upload, FileText, CheckCircle2, X, Database, Files, Sparkles, Wand2, Activity, TrendingUp,
  AlertTriangle, GitCompare,
} from "lucide-react";
import { MetricTile } from "@/components/cards/MetricTile";
import { cn } from "@/lib/utils";
import { API_BASE, apiFetch, pollTask } from "@/lib/api-client";
import { Dataset, DatasetPreview } from "@/lib/types";
import { toast } from "sonner";
import { useDatasetStore } from "@/store/useDatasetStore";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SourceConnect } from "@/components/cards/SourceConnect";

const MAX_FILE_SIZE_MB = 500;
const ACCEPTED_TYPES = ".csv,.json,.parquet,.xlsx,.xls";

interface DemoKind {
  kind: string;
  label: string;
  description: string;
}

interface DatasetStats {
  dataset_id: string;
  name: string;
  row_count: number;
  col_count: number;
  numeric_columns: number;
  text_columns: number;
  missing_cells: number;
  duplicate_rows: number;
  quality_score: number;
  top_category: { column: string; values: Array<{ label: string; count: number }> } | Record<string, never>;
  numeric_summary: Array<{ column: string; total: number; mean: number; min: number; max: number }>;
  sample_rows: Array<Record<string, unknown>>;
}

interface CleaningSuggestion {
  op: string;
  columns: string[] | null;
  params?: Record<string, unknown>;
  label: string;
}

const DataSources = () => {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);
  const [compareMetric, setCompareMetric] = useState<string>("");
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareResult, setCompareResult] = useState<any>(null);
  const { invalidate: invalidateStore } = useDatasetStore();

  const { data: datasetsResp, isLoading: loadingDatasets } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => apiFetch<{ datasets: Dataset[] }>("/datasets"),
  });
  
  const datasets = (datasetsResp?.datasets ?? []).map((d) => ({ ...d, id: d.id || (d as unknown as { dataset_id: string }).dataset_id }));

  useEffect(() => {
    if (datasets.length > 0 && !selectedId && !loadingDatasets) {
      setSelectedId(datasets[0].id);
    }
  }, [datasets, selectedId, loadingDatasets]);

  const { data: catalogueResp } = useQuery({
    queryKey: ["demo-catalogue"],
    queryFn: () => apiFetch<{ datasets: DemoKind[] }>("/datasets/demo-catalogue"),
    staleTime: Infinity,
  });
  const catalogue = catalogueResp?.datasets ?? [];

  const { data: schema } = useQuery({
    queryKey: ["schema", selectedId],
    queryFn: () => apiFetch<DatasetPreview>(`/schema/${selectedId}`),
    enabled: !!selectedId,
  });

  const { data: stats } = useQuery({
    queryKey: ["stats", selectedId],
    queryFn: () => apiFetch<DatasetStats>(`/datasets/${selectedId}/stats`),
    enabled: !!selectedId,
  });

  const { data: suggResp } = useQuery({
    queryKey: ["suggestions", selectedId],
    queryFn: () => apiFetch<{ suggestions: CleaningSuggestion[] }>(`/cleaning/suggestions/${selectedId}`),
    enabled: !!selectedId,
  });
  const suggestions = suggResp?.suggestions ?? [];

  const onUpload = useCallback(async (file: File) => {
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      toast.error(`File too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.`);
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !["csv", "json", "parquet", "xlsx", "xls"].includes(ext)) {
      toast.error("Unsupported file type. Please upload CSV, JSON, Parquet, or Excel files.");
      return;
    }
    if (uploading) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadStage("Uploading...");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const uploadResult = await new Promise<{ task_id: string; dataset_id: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE}/upload-data`);
        xhr.setRequestHeader("Accept", "application/json");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error("Invalid response")); }
          } else {
            try { const err = JSON.parse(xhr.responseText); reject(new Error(err.detail || `Upload failed (${xhr.status})`)); }
            catch { reject(new Error(`Upload failed (${xhr.status})`)); }
          }
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(formData);
      });

      setUploadProgress(100);
      setUploadStage("Queued...");
      const ingestResult = await pollTask<{ success: boolean; error?: string }>(
        uploadResult.task_id,
        (p, s) => {
          setUploadProgress(p);
          if (s) setUploadStage(s);
        }
      );
      if (ingestResult && !ingestResult.success) throw new Error(ingestResult.error || "Ingestion failed");
      toast.success(`"${file.name}" ingested successfully`);
      invalidateStore?.();
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      setSelectedId(uploadResult.dataset_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadStage(null);
    }
  }, [uploading, queryClient, invalidateStore]);

  const seedDemo = async (kind: string) => {
    if (busyKind) return;
    setBusyKind(kind);
    setBusyStage("Starting...");
    try {
      toast.info("Generating synthetic dataset…");
      const resp = await apiFetch<{ dataset_id: string; task_id: string; filename: string }>(
        `/datasets/seed-demo/${kind}`,
        { method: "POST" },
      );
      const result = await pollTask<{ success: boolean; error?: string }>(
        resp.task_id,
        (p, s) => {
          if (s) setBusyStage(s);
        }
      );
      if (result && !result.success) throw new Error(result.error || "Demo ingestion failed");
      toast.success("Demo dataset ready!");
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      setSelectedId(resp.dataset_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Demo seed failed");
    } finally {
      setBusyKind(null);
      setBusyStage(null);
    }
  };

  const applyCleaning = async (suggestion: CleaningSuggestion) => {
    if (!selectedId || cleaning) return;
    setCleaning(true);
    try {
      toast.info(`Applying: ${suggestion.label}`);
      const body = {
        operations: [{
          op: suggestion.op,
          columns: suggestion.columns ?? undefined,
          params: suggestion.params ?? {},
        }],
        save_as_new: true,
      };
      const resp = await apiFetch<{ dataset_id: string; task_id: string }>(
        `/cleaning/${selectedId}/apply`,
        { method: "POST", body: JSON.stringify(body) },
      );
      const result = await pollTask<{ success: boolean; error?: string }>(resp.task_id);
      if (result && !result.success) throw new Error(result.error || "Cleaning failed");
      toast.success("Cleaned dataset created");
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      setSelectedId(resp.dataset_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cleaning failed");
    } finally {
      setCleaning(false);
    }
  };

  const removeDataset = async (id: string) => {
    try {
      await apiFetch(`/datasets/${id}`, { method: "DELETE" });
      toast.success("Dataset removed");
      if (selectedId === id) setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
    } catch {
      toast.error("Failed to remove dataset");
    }
  };

  const runCompare = async () => {
    if (!compareA || !compareB || !compareMetric) return;
    setCompareLoading(true);
    try {
      const result = await apiFetch<any>(`/compare`, {
        method: "POST",
        body: JSON.stringify({
          dataset_id_a: compareA,
          dataset_id_b: compareB,
          metric_col: compareMetric,
        }),
      });
      setCompareResult(result);
      toast.success("Comparison complete");
    } catch (err: any) {
      toast.error(err.message || "Comparison failed");
    } finally {
      setCompareLoading(false);
    }
  };

  const numericColumns = (dsId: string | null) => {
    if (!dsId) return [];
    const ds = datasets.find((d) => d.id === dsId);
    return (ds as any)?.numeric_summary?.map((c: any) => c.column) ?? [];
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void onUpload(file);
  }, [onUpload]);

  return (
    <AppShell title="Data Sources" subtitle="Ingest, inspect and clean datasets" status={loadingDatasets ? "processing" : "ready"}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-8 space-y-8" data-testid="data-sources-root">
        <header className="animate-fade-in-up">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Data Sources</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
            Drop a CSV / XLSX / Parquet / JSON, connect to a remote API/URL, or spin up a synthetic dataset from the demo catalogue.
            Every dataset is profiled on arrival and surfaced with one-click cleaning suggestions.
          </p>
        </header>

        {/* Upload + connect + demo row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Upload Card */}
          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            className={cn(
              "card-soft p-6 flex flex-col items-center justify-center text-center border-dashed transition-all duration-500",
              drag ? "border-accent bg-accent/5" : "border-border",
              uploading && "animate-glow-ring border-accent/40 bg-accent/[0.02]"
            )}
            data-testid="upload-area"
          >
            <div className={cn(
              "h-10 w-10 rounded-full bg-accent-soft text-accent flex items-center justify-center mb-3 transition-transform duration-500",
              uploading && "scale-110 shadow-glow"
            )}>
              <Upload className={cn("h-5 w-5", uploading && "animate-bounce")} />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Drop a file</h3>
            <p className="mt-1 text-[11px] text-muted-foreground mb-5">
              CSV, JSON, Parquet or Excel · up to {MAX_FILE_SIZE_MB} MB
            </p>
            <label className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-accent text-accent-foreground text-sm font-semibold cursor-pointer hover:bg-accent/90 transition-colors shadow-sm active:scale-95">
              <FileText className="h-4 w-4" /> Choose file
              <input type="file" accept={ACCEPTED_TYPES} className="hidden" data-testid="file-input"
                onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
              />
            </label>
            {uploading && (
              <div className="mt-4 w-full max-w-[180px] mx-auto animate-pop-in">
                <div className="h-1.5 bg-surface rounded-full overflow-hidden border border-border relative">
                  <div className="h-full bg-accent rounded-full transition-all duration-500 ease-out relative" style={{ width: `${uploadProgress}%` }}>
                    <div className="absolute inset-0 w-full h-full animate-shimmer" style={{ backgroundSize: '200% 100%' }} />
                  </div>
                </div>
                <div className="flex justify-between items-center mt-1.5 px-0.5">
                  <p className="text-[10px] text-muted-foreground tabular-nums font-mono">{uploadProgress}%</p>
                  <p className="text-[10px] text-accent font-bold animate-pulse-soft truncate max-w-[110px]">{uploadStage}</p>
                </div>
              </div>
            )}
          </div>


          {/* Connect Card */}
          <SourceConnect onComplete={(id) => setSelectedId(id)} />

          {/* Demo Card */}
          <div className="card-soft p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded-md bg-accent-soft text-accent flex items-center justify-center">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Demo catalogue</h3>
                <p className="text-xs text-muted-foreground">Generate realistic synthetic data.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {(catalogue.length ? catalogue : []).map((d) => (
                <button key={d.kind}
                  disabled={!!busyKind}
                  onClick={() => seedDemo(d.kind)}
                  data-testid={`demo-${d.kind}`}
                  className={cn(
                    "text-left rounded-lg border border-border bg-card px-3 py-2 transition-colors",
                    busyKind === d.kind ? "ring-2 ring-accent" : "hover:border-accent/50 hover:bg-accent/5",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-foreground capitalize">{d.label}</span>
                    {busyKind === d.kind && (
                      <span className="text-[10px] text-accent font-medium animate-pulse">
                        {busyStage || "loading…"}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{d.description}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Datasets list */}
        {datasets.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground font-semibold">Datasets</h2>
              {datasets.length >= 2 && (
                <button
                  onClick={() => {
                    setCompareOpen(true);
                    setCompareA(datasets[0]?.id ?? null);
                    setCompareB(datasets[1]?.id ?? null);
                    setCompareResult(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent/80 transition-colors"
                >
                  <GitCompare className="h-3.5 w-3.5" />
                  Compare datasets
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="dataset-list">
              {datasets.map((d) => (
                <button key={d.id}
                  onClick={() => setSelectedId(d.id)}
                  data-testid={`dataset-${d.id.slice(0,8)}`}
                  className={cn(
                    "text-left p-4 rounded-xl border bg-card transition-colors",
                    selectedId === d.id ? "border-accent ring-1 ring-accent/40" : "border-border hover:border-accent/50"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                      <span className="text-sm font-medium truncate" title={d.name || d.filename || d.id}>{d.name || d.filename || d.id}</span>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); void removeDataset(d.id); }}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      aria-label="Delete"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground tabular-nums">
                    <span>{(d.row_count ?? 0).toLocaleString()} rows</span>
                    <span>·</span>
                    <span>{d.col_count ?? 0} cols</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Dataset Comparison */}
        {compareOpen && (
          <section className="space-y-3 animate-fade-in-up">
            <div className="flex items-center justify-between">
              <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground font-semibold">Compare Datasets</h2>
              <button onClick={() => { setCompareOpen(false); setCompareResult(null); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="card-soft p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Dataset A</label>
                  <select
                    value={compareA ?? ""}
                    onChange={(e) => setCompareA(e.target.value)}
                    className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm"
                  >
                    {datasets.map((d) => (
                      <option key={d.id} value={d.id}>{d.name || d.filename || d.id}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Dataset B</label>
                  <select
                    value={compareB ?? ""}
                    onChange={(e) => setCompareB(e.target.value)}
                    className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm"
                  >
                    {datasets.map((d) => (
                      <option key={d.id} value={d.id}>{d.name || d.filename || d.id}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Metric column</label>
                  <select
                    value={compareMetric}
                    onChange={(e) => setCompareMetric(e.target.value)}
                    className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm"
                  >
                    <option value="">Select column…</option>
                    {numericColumns(compareA).map((c: string) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                onClick={runCompare}
                disabled={compareLoading || !compareA || !compareB || !compareMetric}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
              >
                <GitCompare className="h-4 w-4" />
                {compareLoading ? "Comparing…" : "Run comparison"}
              </button>

              {compareResult && compareResult.metric_comparison && (
                <div className="mt-4 rounded-xl border border-border bg-card p-4 animate-fade-in">
                  <h3 className="text-sm font-semibold mb-3">Metric comparison: {compareResult.metric_comparison.column}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-lg bg-surface p-3 border border-border">
                      <p className="text-[11px] text-muted-foreground">{compareResult.dataset_a?.name || "Dataset A"} Mean</p>
                      <p className="text-lg font-semibold tabular-nums">{Number(compareResult.metric_comparison.a_mean).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                    </div>
                    <div className="rounded-lg bg-surface p-3 border border-border">
                      <p className="text-[11px] text-muted-foreground">{compareResult.dataset_b?.name || "Dataset B"} Mean</p>
                      <p className="text-lg font-semibold tabular-nums">{Number(compareResult.metric_comparison.b_mean).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                    </div>
                    <div className="rounded-lg bg-surface p-3 border border-border">
                      <p className="text-[11px] text-muted-foreground">Difference</p>
                      <p className={cn(
                        "text-lg font-semibold tabular-nums",
                        (compareResult.metric_comparison.mean_diff_pct ?? 0) > 0 ? "text-success" : "text-destructive"
                      )}>
                        {compareResult.metric_comparison.mean_diff_pct != null
                          ? `${compareResult.metric_comparison.mean_diff_pct > 0 ? "+" : ""}${compareResult.metric_comparison.mean_diff_pct}%`
                          : "N/A"}
                      </p>
                    </div>
                    <div className="rounded-lg bg-surface p-3 border border-border">
                      <p className="text-[11px] text-muted-foreground">Std Dev A / B</p>
                      <p className="text-sm font-semibold tabular-nums">{Number(compareResult.metric_comparison.a_std).toFixed(2)} / {Number(compareResult.metric_comparison.b_std).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Stats panel */}
        {stats && (
          <section className="space-y-3 animate-fade-in-up">
            <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground font-semibold">
              Profile — {stats.name}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <MetricTile label="Rows" value={stats.row_count} icon={Database} delay={0} />
              <MetricTile label="Columns" value={stats.col_count} icon={Files} delay={60} />
              <MetricTile label="Numeric" value={stats.numeric_columns} icon={Activity} delay={120} status="good" />
              <MetricTile label="Text" value={stats.text_columns} icon={FileText} delay={180} />
              <MetricTile label="Missing" value={stats.missing_cells} icon={AlertTriangle} delay={240} status={stats.missing_cells > 0 ? "warning" : "good"} />
              <MetricTile label="Quality" value={stats.quality_score} suffix="%" icon={CheckCircle2} delay={300} status={stats.quality_score >= 90 ? "good" : "warning"} />
            </div>
            {stats.numeric_summary?.length > 0 && (
              <div className="card-soft p-5">
                <h3 className="text-sm font-semibold mb-3">Numeric highlights</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {stats.numeric_summary.map((col) => {
                    const mean = typeof col?.mean === "number" && Number.isFinite(col.mean) ? col.mean : null;
                    const min = typeof col?.min === "number" && Number.isFinite(col.min) ? col.min : null;
                    const max = typeof col?.max === "number" && Number.isFinite(col.max) ? col.max : null;
                    return (
                      <div key={col?.column ?? Math.random()} className="rounded-lg bg-surface p-3 border border-border">
                        <p className="text-xs font-medium text-foreground truncate">{col?.column ?? "—"}</p>
                        <p className="text-lg font-semibold tabular-nums">{mean !== null ? mean.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</p>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground font-mono">
                          <span>min {min !== null ? min.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</span>
                          <span>·</span>
                          <span>max {max !== null ? max.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Cleaning suggestions */}
        {suggestions.length > 0 && selectedId && (
          <section className="space-y-3 animate-fade-in-up">
            <div className="flex items-center justify-between">
              <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground font-semibold">One-click cleaning</h2>
              <span className="text-[11px] text-muted-foreground">Creates a derived dataset — original preserved</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s, i) => (
                <button
                  key={`${s.op}-${i}`}
                  disabled={cleaning}
                  onClick={() => applyCleaning(s)}
                  data-testid={`cleaning-${s.op}`}
                  className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-card border border-border text-[12px] font-medium hover:border-accent hover:bg-accent/5 transition-colors disabled:opacity-50"
                >
                  <Wand2 className="h-3 w-3" />
                  {s.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Schema / exports */}
        {selectedId && schema && (
          <section className="space-y-3 animate-fade-in-up" data-testid="schema-panel">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground font-semibold">Schema & exports</h2>
              <div className="flex items-center gap-3">
                <button onClick={() => window.open(`${API_BASE}/export/${selectedId}/csv`)}
                  className="px-4 py-2 rounded-xl bg-surface border border-border hover:bg-muted transition-colors flex items-center gap-2 text-sm font-medium"
                  data-testid="export-csv-btn"
                >
                  <Database className="w-4 h-4" /> Export CSV
                </button>
                <button onClick={() => window.open(`${API_BASE}/export/${selectedId}/excel`)}
                  className="px-4 py-2 rounded-xl bg-surface border border-border hover:bg-muted transition-colors flex items-center gap-2 text-sm font-medium"
                  data-testid="export-excel-btn"
                >
                  <Files className="w-4 h-4" /> Excel
                </button>
              </div>
            </div>
            <div className="card-soft overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface border-b border-border">
                    <tr>
                      <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Column</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Type</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sample</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Completeness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(schema.columns || []).map((col) => (
                      <tr key={col.name} className="border-b border-border/60 hover:bg-surface/60 transition-colors">
                        <td className="px-5 py-3 font-medium text-sm">{col.name}</td>
                        <td className="px-5 py-3">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-soft text-accent text-[11px] font-mono">
                            {col.inferred_type}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-muted-foreground font-mono truncate max-w-[200px]" title={col.sample_values?.join(", ")}>
                          {col.sample_values?.slice(0, 3).join(", ") || "—"}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 w-20 bg-surface rounded-full overflow-hidden">
                              <div className="h-full bg-success" style={{ width: `${Math.max(0, 100 - (col.null_pct ?? 0))}%` }} />
                            </div>
                            <span className="text-[11px] font-mono">{Math.max(0, 100 - (col.null_pct ?? 0)).toFixed(0)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
};

export default DataSources;
