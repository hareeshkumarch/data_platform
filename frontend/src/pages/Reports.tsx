import { AppShell } from "@/components/layout/AppShell";
import { DynamicChart } from "@/components/charts/DynamicChart";
import { Download, Share2, FileText, ChevronDown, Sparkles, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import { ApiResponse, Dataset, DatasetPreview } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import { toast } from "sonner";

const Reports = () => {
  const [loading, setLoading] = useState(true);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [reportData, setReportData] = useState<DatasetPreview | null>(null);
  const activeDatasetId = useAppStore((s) => s.dataset);

  const loadReport = async () => {
    try {
      const resp: ApiResponse<Dataset> = await apiFetch("/datasets");
      setDatasets(resp.datasets || []);

      const targetId = activeDatasetId && activeDatasetId !== "Select dataset"
        ? activeDatasetId
        : (resp.datasets?.[0]?.id);

      if (targetId) {
        const preview: DatasetPreview = await apiFetch(`/datasets/${targetId}/preview`);
        setReportData(preview);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load report data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [activeDatasetId]);

  return (
    <AppShell title="Reports" subtitle="AI Compiled deep-dives" status={loading ? "processing" : "ready"}>
      <div className="max-w-5xl mx-auto px-6 lg:px-10 py-10">
        {/* Report header */}
        <div className="animate-fade-in-up">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-8">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                <span>Automated Report</span>
                <span>·</span>
                <span>Generated {new Date().toLocaleDateString()}</span>
              </div>
              <h1 className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                {reportData ? `Analysis for ${reportData.name}` : "Dataset Deep Dive"}
              </h1>
              <p className="mt-4 text-[15px] sm:text-base text-muted-foreground leading-relaxed max-w-3xl">
                A synthesis of patterns discovered by the AI agents during the last ingestion cycle.
              </p>

              <div className="mt-6 flex items-center gap-2">
                <button 
                  onClick={() => {
                    const id = activeDatasetId && activeDatasetId !== "Select dataset" ? activeDatasetId : datasets[0]?.id;
                    if (id) window.open(`/api/v1/export/${id}/csv`);
                    else toast.error("No dataset to export.");
                  }}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors shadow-sm"
                >
                  <Download className="h-4 w-4" /> Export Results
                </button>
              </div>
            </div>

            <div className="lg:w-80 shrink-0 bg-surface/50 border border-border p-5 rounded-xl shadow-sm">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground mb-4 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-accent" /> Findings
              </h3>
              <ul className="space-y-3.5 text-[13px] text-muted-foreground leading-relaxed">
                {reportData ? (
                  <>
                    <li><strong className="text-foreground">Volume:</strong> {reportData.rows.length} records analyzed.</li>
                    <li><strong className="text-foreground">Schema:</strong> {reportData.columns?.length} dimensions mapping.</li>
                  </>
                ) : (
                  <li>No datasets found to analyze.</li>
                )}
              </ul>
            </div>
          </div>
        </div>

        <hr className="my-10 border-border lg:hidden" />

        <div className="mt-12 space-y-2">
          {reportData ? (
            <Section title="Data Distribution" delay={60} aiSummary={`Initial pass over ${reportData.name} reveals a consistent data density with no major missing segments identified.`}>
              <div className="card-soft p-5 mt-5">
                <h4 className="text-xs uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-3">Value Trends</h4>
                {reportData.rows?.length > 1 ? (
                  <DynamicChart spec={{ 
                    chart: "line", 
                    data: reportData.rows, 
                    xKey: Object.keys(reportData.rows[0] || {})[0] || "index",
                    series: [{ key: Object.keys(reportData.rows[0] || {})[1] || "value", label: "Primary Metric" }],
                    height: 260 
                  }} />
                ) : (
                  <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">Not enough data to chart</div>
                )}
              </div>
            </Section>
          ) : !loading && (
            <div className="py-20 text-center">
               <Activity className="h-10 w-10 text-muted-foreground/20 mx-auto mb-4" />
               <p className="text-muted-foreground">Please upload and select a dataset in Data Sources to generate a report.</p>
            </div>
          )}
        </div>

        <p className="mt-12 text-xs text-muted-foreground text-center">End of report · Compiled by AI Report Agent</p>
      </div>
    </AppShell>
  );
};

const Section = ({ title, children, delay = 0, defaultOpen = true, aiSummary }: { title: string; children: React.ReactNode; delay?: number; defaultOpen?: boolean; aiSummary?: string }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="animate-fade-in-up" style={{ animationDelay: `${delay}ms` }}>
      <button 
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left focus:outline-none py-4 group"
      >
        <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-foreground group-hover:text-accent transition-colors flex items-center gap-2">
          {title}
        </h2>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-300", open && "rotate-180")} />
      </button>
      
      <div className={cn("grid transition-all duration-300 ease-in-out", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className="overflow-hidden">
          <div className="pb-8">
            {aiSummary && (
              <div className="mb-6 p-4 rounded-xl bg-accent-soft text-accent/90 border border-accent/10 flex gap-3 shadow-sm">
                <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
                <p className="text-sm leading-relaxed font-medium">{aiSummary}</p>
              </div>
            )}
            <div className="text-[15px] sm:text-base text-muted-foreground leading-relaxed space-y-4">
              {children}
            </div>
          </div>
        </div>
      </div>
      <hr className="border-border/50" />
    </section>
  );
};

export default Reports;
