import { AppShell } from "@/components/layout/AppShell";
import {
  Download, FileText, Sparkles, Activity, BarChart3, Lightbulb,
  AlertTriangle, CheckSquare, ShieldCheck, TrendingUp, GitBranch,
  BookOpen, Target, FlaskConical,
} from "lucide-react";
import { apiFetch, API_BASE } from "@/lib/api-client";
import { ApiResponse, Dataset, DatasetPreview } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import { toast } from "sonner";
import { MarkdownRenderer } from "@/components/ui/MarkdownRenderer";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

// Map icon keys from the backend prompt to Lucide components
const SECTION_ICONS: Record<string, React.ElementType> = {
  FileText,
  BarChart3,
  Lightbulb,
  AlertTriangle,
  CheckSquare,
  ShieldCheck,
  TrendingUp,
  GitBranch,
  BookOpen,
  Target,
  FlaskConical,
};

// Section color schemes per icon type
const SECTION_COLORS: Record<string, string> = {
  FileText:      "border-blue-500/30 bg-blue-500/5",
  BarChart3:     "border-indigo-500/30 bg-indigo-500/5",
  Lightbulb:     "border-amber-500/30 bg-amber-500/5",
  AlertTriangle: "border-red-500/30 bg-red-500/5",
  CheckSquare:   "border-emerald-500/30 bg-emerald-500/5",
  ShieldCheck:   "border-green-500/30 bg-green-500/5",
  TrendingUp:    "border-violet-500/30 bg-violet-500/5",
  GitBranch:     "border-cyan-500/30 bg-cyan-500/5",
};

const ICON_COLORS: Record<string, string> = {
  FileText:      "text-blue-500",
  BarChart3:     "text-indigo-500",
  Lightbulb:     "text-amber-500",
  AlertTriangle: "text-red-500",
  CheckSquare:   "text-emerald-500",
  ShieldCheck:   "text-green-500",
  TrendingUp:    "text-violet-500",
  GitBranch:     "text-cyan-500",
};

interface ReportSection {
  section_id: string;
  title: string;
  icon?: string;
  content: string;
  conclusion?: string;
  evidence?: string[];
  key_metric?: string;
  order: number;
}

interface StructuredReport {
  executive_headline?: string;
  sections?: ReportSection[];
}

const Reports = () => {
  const activeDatasetId = useAppStore((s) => s.dataset);

  const { data: datasetsResp, isLoading: loadingDatasets } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => apiFetch<ApiResponse<Dataset>>("/datasets"),
  });
  const datasets = datasetsResp?.datasets || [];
  const targetId = activeDatasetId && activeDatasetId !== "Select dataset" ? activeDatasetId : datasets[0]?.id;
  const datasetName = datasets.find((d: any) => (d.id || d.dataset_id) === targetId)?.filename
    || datasets.find((d: any) => (d.id || d.dataset_id) === targetId)?.name
    || "Dataset";

  const { data: reportData, isLoading: loadingPreview } = useQuery({
    queryKey: ["preview", targetId],
    queryFn: () => apiFetch<DatasetPreview>(`/datasets/${targetId}/preview`),
    enabled: !!targetId,
  });

  // Try structured JSON endpoint first
  const { data: structuredReport, isLoading: loadingStructured } = useQuery<StructuredReport>({
    queryKey: ["report-structured", targetId],
    queryFn: async () => {
      const res = await apiFetch<any>(`/datasets/${targetId}/report`);
      return res;
    },
    enabled: !!targetId,
    retry: false,
  });

  // Fallback to markdown export
  const { data: reportText, isLoading: loadingText } = useQuery({
    queryKey: ["report-markdown", targetId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/export/${targetId}/insights/markdown`);
      if (!res.ok) throw new Error("No report yet");
      return await res.text();
    },
    enabled: !!targetId && !structuredReport?.sections?.length,
    retry: false,
  });

  const loading = loadingDatasets || (!!targetId && (loadingPreview || loadingStructured));
  const sortedSections = structuredReport?.sections
    ? [...structuredReport.sections].sort((a, b) => a.order - b.order)
    : [];

  return (
    <AppShell title="Reports" subtitle="AI-compiled intelligence reports" status={loading ? "processing" : "ready"}>
      <div className="max-w-5xl mx-auto px-6 lg:px-10 py-10 space-y-10">

        {/* Report header */}
        <div className="animate-fade-in-up flex flex-col lg:flex-row lg:items-start justify-between gap-8">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              <span>Automated Intelligence Report</span>
              <span>·</span>
              <span>Generated {new Date().toLocaleDateString()}</span>
            </div>
            <h1 className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              {targetId ? `Analysis for ${datasetName}` : "Dataset Deep Dive"}
            </h1>

            {/* Executive Headline */}
            {structuredReport?.executive_headline && (
              <div className="mt-4 px-4 py-3 rounded-lg bg-accent/10 border border-accent/20">
                <p className="text-sm font-medium text-foreground leading-relaxed">
                  {structuredReport.executive_headline}
                </p>
              </div>
            )}

            <p className="mt-4 text-sm text-muted-foreground leading-relaxed max-w-3xl">
              A synthesis of patterns discovered by the AI agents during the last ingestion cycle.
            </p>

            <div className="mt-6 flex items-center gap-2">
              <button
                onClick={() => {
                  if (targetId) window.open(`${API_BASE}/export/${targetId}/report/pdf`);
                  else toast.error("No dataset to export.");
                }}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors shadow-sm"
              >
                <Download className="h-4 w-4" /> Export PDF
              </button>
            </div>
          </div>

          {/* Metadata sidebar */}
          <div className="lg:w-72 shrink-0 bg-surface/50 border border-border p-5 rounded-xl shadow-sm">
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground mb-4 flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-accent" /> Report Metadata
            </h3>
            <ul className="space-y-3 text-[13px] text-muted-foreground">
              {reportData ? (
                <>
                  <li className="flex justify-between">
                    <span className="text-foreground font-medium">Records</span>
                    <span>{(reportData.row_count || reportData.rows?.length || 0).toLocaleString()}</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-foreground font-medium">Dimensions</span>
                    <span>{(reportData.col_count || reportData.columns?.length || 0)} columns</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-foreground font-medium">Sections</span>
                    <span>{sortedSections.length || "—"}</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-foreground font-medium">Quality</span>
                    <span className="text-success font-mono">{(reportData as any).quality_score ?? "—"}/100</span>
                  </li>
                </>
              ) : (
                <li>No datasets found to analyze.</li>
              )}
            </ul>
          </div>
        </div>

        {/* Report body */}
        {loading ? (
          <div className="py-20 text-center animate-pulse space-y-3">
            <div className="h-6 w-1/3 bg-surface rounded-md mx-auto" />
            <div className="h-4 w-2/3 bg-surface rounded-md mx-auto" />
            <div className="h-4 w-1/2 bg-surface rounded-md mx-auto" />
          </div>
        ) : sortedSections.length > 0 ? (
          <div className="space-y-6">
            {sortedSections.map((section, idx) => {
              const IconComp = SECTION_ICONS[section.icon || "FileText"] || FileText;
              const borderColor = SECTION_COLORS[section.icon || "FileText"] || "";
              const iconColor = ICON_COLORS[section.icon || "FileText"] || "text-accent";

              return (
                <div
                  key={section.section_id}
                  className={cn("rounded-xl border p-6 animate-fade-in-up", borderColor)}
                  style={{ animationDelay: `${idx * 80}ms` }}
                >
                  {/* Section header */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className={cn("p-2 rounded-lg bg-background/60 border border-border/40")}>
                      <IconComp className={cn("h-4 w-4", iconColor)} />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-foreground">{section.title}</h2>
                      {section.key_metric && (
                        <span className="text-[11px] font-mono text-muted-foreground">{section.key_metric}</span>
                      )}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="prose prose-sm max-w-full text-foreground/90">
                    <MarkdownRenderer content={section.content} />
                  </div>

                  {/* Evidence strip */}
                  {section.evidence && section.evidence.length > 0 && (
                    <div className="mt-5 border-t border-border/40 pt-4">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
                        <FlaskConical className="h-3 w-3" /> Supporting Evidence
                      </p>
                      <ul className="space-y-1">
                        {section.evidence.map((ev, i) => (
                          <li key={i} className="flex items-start gap-2 text-[12px] text-muted-foreground">
                            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                            {ev}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Conclusion */}
                  {section.conclusion && (
                    <div className="mt-4 flex items-start gap-2.5 rounded-lg bg-background/60 border border-border/30 px-4 py-3">
                      <Target className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      <p className="text-[12px] text-foreground font-medium leading-relaxed">{section.conclusion}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : reportText ? (
          // Fallback: plain markdown
          <div className="card-soft p-6 sm:p-10 animate-fade-in-up">
            <div className="prose prose-sm max-w-full">
              <MarkdownRenderer content={reportText} />
            </div>
          </div>
        ) : reportData ? (
          <div className="py-20 text-center card-soft px-8">
            <Sparkles className="h-10 w-10 text-accent/50 mx-auto mb-4 animate-float" />
            <h3 className="text-lg font-semibold mb-2">No AI report compiled yet</h3>
            <p className="text-muted-foreground text-sm max-w-md mx-auto">
              Return to the pipeline page and run an analysis on this dataset to generate a full structured report.
            </p>
          </div>
        ) : (
          <div className="py-20 text-center">
            <Activity className="h-10 w-10 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-muted-foreground text-sm">Please select a dataset to view its report.</p>
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center pt-4 border-t border-border">
          End of document — AI output matches platform ingestion state
        </p>
      </div>
    </AppShell>
  );
};

export default Reports;
