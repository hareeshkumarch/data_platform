import { AppShell } from "@/components/layout/AppShell";
import { useState, useCallback, useEffect } from "react";
import { Upload, FileText, CheckCircle2, X, Database, AlertTriangle, Files, Sparkles } from "lucide-react";
import { MetricTile } from "@/components/cards/MetricTile";
import { cn } from "@/lib/utils";
import { apiFetch, pollTask } from "@/lib/api-client";
import { Dataset, DatasetPreview } from "@/lib/types";
import { toast } from "sonner";
import { useDatasetStore } from "@/store/useDatasetStore";

const MAX_FILE_SIZE_MB = 500;
const ACCEPTED_TYPES = ".csv,.json,.parquet,.xlsx,.xls";

const DataSources = () => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [demoLoading, setDemoLoading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [schema, setSchema] = useState<DatasetPreview | null>(null);
  const { invalidate: invalidateStore } = useDatasetStore();

  const fetchDatasets = useCallback(async () => {
    try {
      const resp = await apiFetch<{ datasets: any[] }>("/datasets");
      const mapped = (resp.datasets || []).map((d: any) => ({
        ...d,
        id: d.id || d.dataset_id
      }));
      setDatasets(mapped);
      if (mapped.length > 0 && !selectedId) {
        setSelectedId(mapped[0].id);
      }
    } catch (err) {
      toast.error("Failed to load datasets");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const fetchSchema = async (id: string) => {
    try {
      const data = await apiFetch<DatasetPreview>(`/schema/${id}`);
      setSchema(data);
    } catch (err) {
      setSchema(null);
    }
  };

  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  useEffect(() => {
    if (selectedId) fetchSchema(selectedId);
  }, [selectedId]);

  const onUpload = useCallback(async (file: File) => {
    // Client-side file size check (#35)
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      toast.error(`File too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.`);
      return;
    }
    // Client-side file type check
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !["csv", "json", "parquet", "xlsx", "xls"].includes(ext)) {
      toast.error("Unsupported file type. Please upload CSV, JSON, Parquet, or Excel files.");
      return;
    }

    if (uploading) return;  // Guard against concurrent uploads (#63)
    setUploading(true);
    setUploadProgress(0);
    const formData = new FormData();
    formData.append("file", file);
    
    try {
      // Upload with progress tracking via XMLHttpRequest (#36)
      const uploadResult = await new Promise<{ task_id: string; dataset_id: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/v1/upload-data");
        xhr.setRequestHeader("Accept", "application/json");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch { reject(new Error("Invalid response")); }
          } else {
            try {
              const err = JSON.parse(xhr.responseText);
              reject(new Error(err.detail || `Upload failed (${xhr.status})`));
            } catch { reject(new Error(`Upload failed (${xhr.status})`)); }
          }
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(formData);
      });
      
      const data = uploadResult;
      setUploadProgress(100);
      toast.info(`Processing ${file.name}...`);

      // Inject ghost entry
      setDatasets(prev => [{
        id: data.dataset_id,
        filename: file.name,
        created_at: new Date().toISOString(),
        status: "processing"
      } as any, ...prev]);

      // Wait for ingestion and check success (#7)
      const ingestResult = await pollTask<{ success: boolean; error?: string }>(data.task_id);
      if (ingestResult && !ingestResult.success) {
        throw new Error(ingestResult.error || "Ingestion failed");
      }
      
      // Automatic EDA — poll the task (#21/#30)
      toast.info("Running automatic data analysis...");
      const processResp = await apiFetch<{ task_id: string }>(`/process-data/${data.dataset_id}`, {
        method: "POST",
        body: JSON.stringify({
          run_anomaly_detection: true,
          run_time_series: false
        })
      });
      if (processResp.task_id) {
        await pollTask(processResp.task_id);
      }
      
      toast.success("Dataset ready for analysis!");
      fetchDatasets();
      invalidateStore(); // Notify all consumers (#57)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
      fetchDatasets();
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, [fetchDatasets, uploading, invalidateStore]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file) onUpload(file);
  }, [onUpload]);

  const deleteDataset = async (id: string) => {
    if (!confirm("Delete this dataset?")) return;
    try {
      await apiFetch(`/datasets/${id}`, { method: "DELETE" });
      setDatasets(datasets.filter(d => d.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setSchema(null);
      }
      toast.success("Dataset deleted");
    } catch (err) {
      toast.error("Delete failed");
    }
  };

  return (
    <AppShell title="Data Sources" subtitle="Upload, preview and validate your datasets" status={loading ? "processing" : "ready"}>
      <div className="max-w-5xl mx-auto px-6 lg:px-10 py-8 space-y-8">
        
        {/* Upload Area */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            className={cn(
              "md:col-span-2 rounded-xl border-2 border-dashed p-10 text-center transition-all cursor-pointer animate-fade-in",
              drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-surface/50"
            )}
            onClick={() => document.getElementById("file-input")?.click()}
          >
            <input 
              id="file-input" 
              type="file" 
              className="hidden" 
              accept={ACCEPTED_TYPES}
              aria-label="Upload dataset file"
              onChange={(e) => { e.target.files?.[0] && onUpload(e.target.files[0]); e.target.value = ""; }}
            />
            <div className="mx-auto h-11 w-11 rounded-full bg-card border border-border flex items-center justify-center mb-4">
              <Upload className="h-5 w-5 text-accent" />
            </div>
            <h3 className="text-base font-semibold text-foreground">{uploading ? "Uploading…" : "Click or drop a file to begin"}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">CSV, JSON, Parquet, Excel · up to {MAX_FILE_SIZE_MB} MB</p>
            {uploading && uploadProgress > 0 && (
              <div className="mt-3 w-full max-w-xs mx-auto">
                <div className="h-2 bg-surface rounded-full overflow-hidden border border-border">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 tabular-nums font-mono">{uploadProgress}%</p>
              </div>
            )}
          </div>

          <div className="card-soft p-8 flex flex-col items-center justify-center text-center bg-accent/5 border-accent/20">
            <div className="h-11 w-11 rounded-full bg-accent-soft text-accent flex items-center justify-center mb-4">
              <Sparkles className="h-5 w-5" />
            </div>
            <h3 className="text-base font-semibold text-foreground">Quick Demo</h3>
            <p className="mt-1.5 text-sm text-muted-foreground mb-6">Load sample sales data in one click</p>
            <button 
              disabled={demoLoading}
              onClick={async () => {
                if (demoLoading) return;
                setDemoLoading(true);
                try {
                  toast.info("Initializing demo ingestion...");
                  const resp = await apiFetch<{ dataset_id: string, task_id: string }>("/datasets/seed-demo", { method: "POST" });
                  
                  setDatasets(prev => [{
                    id: resp.dataset_id,
                    filename: "Sales Performance (Demo)",
                    created_at: new Date().toISOString(),
                    status: "processing"
                  } as any, ...prev]);

                  if (resp.task_id) {
                    toast.info("Demo ingestion running…");
                    const result = await pollTask<{ success: boolean; error?: string }>(resp.task_id);
                    if (result && !result.success) {
                      throw new Error(result.error || "Demo ingestion failed");
                    }
                    toast.success("Demo dataset ready!");
                    fetchDatasets();
                  }
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Demo seeding failed");
                  fetchDatasets();
                } finally {
                  setDemoLoading(false);
                }
              }}
              className="w-full h-10 rounded-xl bg-accent text-accent-foreground font-semibold hover:bg-accent/90 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {demoLoading ? "Generating…" : "Generate Demo"}
            </button>
          </div>
        </div>

        {selectedId && (
          <div className="flex items-center justify-between gap-3 animate-fade-in">
            <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground font-semibold">Actions</h2>
            <div className="flex items-center gap-3">
              <button 
                onClick={() => window.open(`/api/v1/export/${selectedId}/csv`)}
                className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <Database className="w-4 h-4" />
                Export CSV
              </button>
              <button 
                onClick={() => window.open(`/api/v1/export/${selectedId}/excel`)}
                className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <Files className="w-4 h-4" />
                Excel
              </button>
            </div>
          </div>
        )}
        {datasets.length > 0 && (
          <section>
            <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-3">Your Datasets</h2>
            <div className="space-y-2">
              {datasets.filter(d => d.id || (d as any).dataset_id).map((d) => (
                <div 
                  key={d.id || (d as any).dataset_id} 
                  className={cn(
                    "group card-soft p-4 flex items-center justify-between transition-all cursor-pointer",
                    selectedId === d.id ? "border-accent ring-1 ring-accent/20" : "hover:border-accent/30"
                  )}
                  onClick={() => setSelectedId(d.id)}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="h-9 w-9 rounded-md bg-surface border border-border flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{d.name || d.filename || d.id}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {d.status === "processing" ? (
                          <span className="text-accent animate-pulse font-medium">Analyzing data...</span>
                        ) : (
                          <>{d.row_count?.toLocaleString() || 0} rows · {d.col_count || 0} columns</>
                        )}
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); deleteDataset(d.id); }}
                    aria-label="Delete dataset"
                    className="h-10 w-10 rounded-md hover:bg-destructive/10 flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Dataset Statistics */}
        {schema && (
          <section className="animate-fade-in-up mb-8">
            <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-3">Statistics</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricTile label="Total Rows" value={schema.row_count || 0} icon={Database} delay={0} />
              <MetricTile label="Columns" value={schema.col_count || 0} icon={Files} delay={100} />
              <MetricTile label="Size" value={parseFloat((schema.size_bytes / 1024 / 1024).toFixed(2))} suffix="MB" icon={FileText} delay={200} />
              <MetricTile label="Status" value={100} suffix="%" icon={CheckCircle2} delay={300} status="good" />
            </div>
          </section>
        )}

        {/* Schema preview */}
        {schema && schema.columns && (
          <section className="card-soft animate-fade-in-up">
            <header className="px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Column Schema</h3>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border bg-surface/30">
                    <th className="px-5 py-2.5 font-medium">Column</th>
                    <th className="px-5 py-2.5 font-medium">Inferred Type</th>
                    <th className="px-5 py-2.5 font-medium">Cleanliness</th>
                  </tr>
                </thead>
                <tbody>
                  {schema.columns.map((col: any, idx: number) => (
                    <tr key={col.name} className="border-b border-border last:border-0 hover:bg-surface/20 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-foreground font-semibold truncate max-w-[200px]" title={col.name}>{col.name}</td>
                      <td className="px-5 py-3">
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-mono bg-surface border border-border text-muted-foreground uppercase">
                          {col.inferred_type}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 w-20 bg-surface rounded-full overflow-hidden">
                            <div className="h-full bg-success" style={{ width: `${((1 - (col.null_pct ?? 0)) * 100)}%` }} />
                          </div>
                          <span className="text-[11px] font-mono">{((1 - (col.null_pct ?? 0)) * 100).toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
};

export default DataSources;
