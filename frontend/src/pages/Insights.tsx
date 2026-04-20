import { AppShell } from "@/components/layout/AppShell";
import { InsightCard } from "@/components/cards/InsightCard";
import { DynamicChart } from "@/components/charts/DynamicChart";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { ApiResponse, Dataset, DatasetPreview } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import { Sparkles, Activity } from "lucide-react";
import { toast } from "sonner";

interface Finding {
  tag: string;
  title: string;
  explanation: string;
  confidence: number;
  metrics: { label: string; value: string }[];
}

const Insights = () => {
  const [loading, setLoading] = useState(true);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [mainDataset, setMainDataset] = useState<DatasetPreview | null>(null);
  const activeDatasetId = useAppStore((s) => s.dataset);

  const loadInsights = async () => {
    try {
      const dbResp: ApiResponse<Dataset> = await apiFetch("/datasets");
      
      const targetId = activeDatasetId && activeDatasetId !== "Select dataset" 
        ? activeDatasetId 
        : (dbResp.datasets?.[0]?.id);

      if (targetId) {
        const preview: DatasetPreview = await apiFetch(`/datasets/${targetId}/preview`);
        setMainDataset(preview);
        
        const analyticsRec = await apiFetch<any>(`/analytics/${targetId}`, {
          method: "POST",
          body: JSON.stringify({ 
            analysis_type: "profile",
            config: {} 
          })
        });

        // Backend returns `profile` array, not `columns` (#2)
        const profileCols = analyticsRec.profile || analyticsRec.columns || [];
        const rowCount = analyticsRec.row_count || preview.row_count || 1;
        
        const realFindings: Finding[] = profileCols.slice(0, 4).map((col: any) => ({
          tag: col.inferred_type || "Column",
          title: `Analysis of ${col.name}`,
          explanation: `Inferred as ${col.inferred_type}. Found ${col.unique_count ?? 0} unique values.`,
          confidence: 0.9,
          metrics: [
            { label: "Missing Rows", value: `${col.null_count ?? col.missing_count ?? 0}` },
            { label: "Unique Ratio", value: rowCount > 0 ? `${(((col.unique_count ?? 0) / rowCount) * 100).toFixed(1)}%` : "N/A" }
          ]
        }));
        setFindings(realFindings);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load insights. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInsights();
  }, [activeDatasetId]);

  return (
    <AppShell
      title="Insights"
      subtitle="Auto-generated findings from your latest dataset"
      status={loading ? "processing" : "ready"}
    >
      <div className="max-w-5xl mx-auto px-6 lg:px-10 py-8">
        {/* Hero */}
        <div className="mb-10 animate-fade-in-up bg-card border border-border p-6 sm:p-8 rounded-2xl shadow-soft">
          <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-accent font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            Active Agent Analysis
          </span>
          <h1 className="mt-4 text-2xl sm:text-3xl font-bold text-foreground tracking-tight leading-tight max-w-4xl">
            {mainDataset ? `Synthesizing patterns across ${mainDataset.name}.` : "Upload a dataset to generate insights."}
          </h1>
          <p className="mt-3 text-[15px] sm:text-base text-muted-foreground leading-relaxed max-w-3xl">
            Our agentic pipeline is continuously scanning for anomalies, correlation shifts, and trend resets in your data warehouse.
          </p>
        </div>

        {/* Insights */}
        <section className="space-y-4">
          {findings.map((f, i) => (
            <InsightCard
              key={i}
              tag={f.tag}
              title={f.title}
              explanation={f.explanation}
              confidence={f.confidence}
              metrics={f.metrics}
              defaultOpen={i === 0}
              delay={i * 60}
            >
              {mainDataset && mainDataset.rows?.length > 1 && (
              <DynamicChart spec={{ 
                chart: "area", 
                data: mainDataset.rows,
                xKey: Object.keys(mainDataset.rows[0] || {})[0] || "index",
                series: [{ key: Object.keys(mainDataset.rows[0] || {})[1] || "value", label: "Trend" }]
              }} />
              )}
            </InsightCard>
          ))}
          
          {!loading && findings.length === 0 && (
            <div className="p-12 text-center border border-dashed border-border rounded-xl bg-surface/30">
               <Activity className="h-10 w-10 text-muted-foreground/20 mx-auto mb-4" />
               <p className="text-sm text-muted-foreground uppercase tracking-wider font-semibold">No insights yet</p>
               <p className="text-xs text-muted-foreground mt-1">Upload data and run a query to trigger analysis</p>
            </div>
          )}
        </section>

        <p className="mt-10 text-xs text-muted-foreground text-center">
          <Sparkles className="h-3 w-3 inline mr-1" />
          Always verify critical decisions with source data
        </p>
      </div>
    </AppShell>
  );
};

export default Insights;
