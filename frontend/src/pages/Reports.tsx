import { AppShell } from "@/components/layout/AppShell";
import { Download, FileText, Sparkles, Activity } from "lucide-react";
import { apiFetch, API_BASE } from "@/lib/api-client";
import { ApiResponse, Dataset, DatasetPreview } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import { toast } from "sonner";
import { MarkdownRenderer } from "@/components/ui/MarkdownRenderer";
import { useQuery } from "@tanstack/react-query";

const Reports = () => {
  const activeDatasetId = useAppStore((s) => s.dataset);

  const { data: datasetsResp, isLoading: loadingDatasets } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => apiFetch<ApiResponse<Dataset>>("/datasets"),
  });
  const datasets = datasetsResp?.datasets || [];
  const targetId = activeDatasetId && activeDatasetId !== "Select dataset" ? activeDatasetId : datasets[0]?.id;

  const { data: reportData, isLoading: loadingPreview } = useQuery({
    queryKey: ["preview", targetId],
    queryFn: () => apiFetch<DatasetPreview>(`/datasets/${targetId}/preview`),
    enabled: !!targetId,
  });

  const { data: reportText, isLoading: loadingText } = useQuery({
    queryKey: ["report-markdown", targetId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/export/${targetId}/insights/markdown`);
      if (!res.ok) throw new Error("No report yet");
      return await res.text();
    },
    enabled: !!targetId,
    retry: false,
  });

  const loading = loadingDatasets || (!!targetId && loadingPreview) || (!!targetId && loadingText && reportText === undefined);

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
                    if (targetId) window.open(`${API_BASE}/export/${targetId}/insights/markdown`);
                    else toast.error("No dataset to export.");
                  }}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors shadow-sm"
                >
                  <Download className="h-4 w-4" /> Export Document
                </button>
              </div>
            </div>

            <div className="lg:w-80 shrink-0 bg-surface/50 border border-border p-5 rounded-xl shadow-sm">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground mb-4 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-accent" /> Metadata
              </h3>
              <ul className="space-y-3.5 text-[13px] text-muted-foreground leading-relaxed">
                {reportData ? (
                  <>
                    <li><strong className="text-foreground">Volume:</strong> {reportData.rows?.length ?? 0} records analyzed.</li>
                    <li><strong className="text-foreground">Schema:</strong> {reportData.columns?.length ?? 0} dimensions mapping.</li>
                  </>
                ) : (
                  <li>No datasets found to analyze.</li>
                )}
              </ul>
            </div>
          </div>
        </div>

        <hr className="my-10 border-border lg:hidden" />

        <div className="mt-12">
          {loading ? (
            <div className="py-20 text-center animate-pulse">
              <div className="h-6 w-1/3 bg-surface rounded-md mx-auto mb-4" />
              <div className="h-4 w-2/3 bg-surface rounded-md mx-auto" />
            </div>
          ) : reportText ? (
            <div className="card-soft p-6 sm:p-10 animate-fade-in-up md:max-w-4xl max-w-full overflow-hidden">
               <div className="prose prose-invert max-w-full">
                 <MarkdownRenderer content={reportText} />
               </div>
            </div>
          ) : reportData ? (
            <div className="py-20 text-center card-soft px-8">
               <Sparkles className="h-10 w-10 text-accent/50 mx-auto mb-4 animate-float" />
               <h3 className="text-lg font-semibold mb-2">No AI report compiled yet</h3>
               <p className="text-muted-foreground text-sm max-w-md mx-auto">
                 The AI needs to complete a full pipeline run to generate a comprehensive markdown report. Return to the pipeline page and trigger an analysis on "{reportData.name}".
               </p>
            </div>
          ) : (
            <div className="py-20 text-center">
               <Activity className="h-10 w-10 text-muted-foreground/20 mx-auto mb-4" />
               <p className="text-muted-foreground text-sm">Please select a dataset to view its report.</p>
            </div>
          )}
        </div>

        <p className="mt-12 text-xs text-muted-foreground text-center">End of document · AI Output matches platform ingestion state</p>
      </div>
    </AppShell>
  );
};

export default Reports;
