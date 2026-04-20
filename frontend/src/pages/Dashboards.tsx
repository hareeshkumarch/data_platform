import { AppShell } from "@/components/layout/AppShell";
import { DynamicChart } from "@/components/charts/DynamicChart";
import { TrendingUp, Calendar, Filter, Download, Activity } from "lucide-react";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import { ApiResponse, Dataset, DatasetPreview } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import { toast } from "sonner";

const Dashboards = () => {
  const [loading, setLoading] = useState(true);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [mainDataset, setMainDataset] = useState<DatasetPreview | null>(null);
  const [systemStats, setSystemStats] = useState<{ llm_calls: number; llm_tokens: number; success_rate: number } | null>(null);
  const activeDatasetId = useAppStore((s) => s.dataset);

  const loadData = async () => {
    try {
      const resp: ApiResponse<Dataset> = await apiFetch("/datasets");
      setDatasets(resp.datasets || []);
      
      // Load system stats
      try {
        const stats = await apiFetch<{ llm_calls: number; llm_tokens: number; success_rate: number }>("/system/stats");
        setSystemStats(stats);
      } catch { /* non-critical */ }

      const targetId = activeDatasetId && activeDatasetId !== "Select dataset" 
        ? activeDatasetId 
        : (resp.datasets?.[0]?.id);

      if (targetId) {
        const preview: DatasetPreview = await apiFetch(`/datasets/${targetId}/preview`);
        setMainDataset(preview);
        
        // Load Recommendations
        const recs: any = await apiFetch(`/chart/recommend/${targetId}`);
        /* debug removed */
      }
    } catch (err) {
      /* silently ignore */
      toast.error("Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeDatasetId]);

  const totalRows = mainDataset?.row_count || mainDataset?.rows?.length || 0;
  const totalCols = mainDataset?.col_count || (mainDataset?.columns?.length) || 0;

  const kpis = [
    { label: "Active Datasets", value: datasets.length.toString(), delta: `${datasets.length}` },
    { label: "Total Rows", value: totalRows.toLocaleString(), delta: `${totalCols} cols` },
    { label: "LLM Calls", value: systemStats ? systemStats.llm_calls.toLocaleString() : "—", delta: `${systemStats?.llm_tokens?.toLocaleString() || 0} tokens` },
    { label: "Success Rate", value: systemStats ? `${systemStats.success_rate}%` : "—", delta: "" },
  ];

  return (
    <AppShell title="Dashboards" subtitle="Real-time Platform Overview" status={loading ? "processing" : "ready"}>
      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 animate-fade-in">
          <div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">System Performance</h1>
            <p className="text-sm text-muted-foreground mt-1">Live metrics from current environment</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button 
              onClick={() => {
                const id = activeDatasetId && activeDatasetId !== "Select dataset" ? activeDatasetId : datasets[0]?.id;
                if (id) window.open(`/api/v1/export/${id}/csv`);
                else toast.error("No dataset selected for export.");
              }}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-card border border-accent/20 text-xs font-medium text-foreground hover:border-accent/40 shadow-sm transition-colors ml-1"
            >
              <Download className="h-3.5 w-3.5 text-accent" /> Export CSV
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((k, i) => (
            <Widget key={k.label} delay={i * 60}>
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-2xl font-semibold text-foreground font-mono tracking-tight">{k.value}</span>
                <span className="inline-flex items-center text-[11px] font-medium text-success">
                  <TrendingUp className="h-3 w-3 mr-0.5" />
                  {k.delta}
                </span>
              </div>
            </Widget>
          ))}
        </div>

        {/* Charts grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Widget title="Primary Dataset distribution" wide delay={240}>
            {mainDataset && mainDataset.rows?.length > 1 ? (
              <DynamicChart spec={{ 
                chart: "line", 
                data: mainDataset.rows,
                xKey: Object.keys(mainDataset.rows[0] || {})[0] || "index",
                series: [{ key: Object.keys(mainDataset.rows[0] || {})[1] || "value", label: "Value" }],
                height: 280 
              }} />
            ) : (
              <div className="h-[280px] flex flex-col items-center justify-center border border-dashed border-border rounded-lg bg-surface/30">
                <Activity className="h-8 w-8 text-muted-foreground/20 mb-2" />
                <p className="text-xs text-muted-foreground">Upload a dataset to see visualization</p>
              </div>
            )}
          </Widget>
          
          <Widget title="Dataset Health" delay={300}>
             <div className="space-y-4 py-2">
                {datasets.slice(0, 3).map(d => (
                  <div key={d.id} className="flex items-center justify-between p-3 rounded-lg bg-surface/50 border border-border">
                    <span className="text-xs font-medium">{d.name || d.id}</span>
                    <span className="text-[10px] bg-success/10 text-success px-2 py-0.5 rounded">READY</span>
                  </div>
                ))}
                {datasets.length === 0 && <p className="text-xs text-muted-foreground text-center">No datasets active</p>}
             </div>
          </Widget>
        </div>
      </div>
    </AppShell>
  );
};

const Widget = ({
  children,
  title,
  wide,
  delay = 0,
}: {
  children: React.ReactNode;
  title?: string;
  wide?: boolean;
  delay?: number;
}) => {
  return (
    <div
      className={`group card-soft p-4 transition-all hover:border-accent/30 animate-fade-in-up ${wide ? "lg:col-span-2" : ""}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {title && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
        </div>
      )}
      {children}
    </div>
  );
};

export default Dashboards;
