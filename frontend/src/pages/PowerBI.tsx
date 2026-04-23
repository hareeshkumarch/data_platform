import { useState, useEffect, useCallback } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiFetch } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { Dataset } from "@/lib/types";
import { motion } from "framer-motion";
import {
  Database, FileBarChart, GitBranch, Copy, CheckCircle2,
  Eye, Layers, BarChart3, LineChart, PieChart,
  Table2, Gauge, ArrowUpDown, Calendar, Hash, Type,
  Sparkles, Code2, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const VISUAL_ICONS: Record<string, typeof BarChart3> = {
  lineChart: LineChart,
  barChart: BarChart3,
  scatterPlot: Sparkles,
  pieChart: PieChart,
  kpiCard: Gauge,
  gauge: Gauge,
  comboChart: BarChart3,
  matrix: Table2,
};

const MEASURE_TYPE_COLORS: Record<string, string> = {
  aggregate: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  time_intelligence: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  categorical: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  count: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  metadata: "bg-slate-500/10 text-slate-600 border-slate-500/30",
  quality: "bg-pink-500/10 text-pink-600 border-pink-500/30",
};

const PowerBI = () => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("dax");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Dataset list
  const { data: datasetsResp } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => apiFetch<{ datasets: Dataset[] }>("/datasets"),
  });
  const datasets = datasetsResp?.datasets ?? [];

  useEffect(() => {
    if (!selectedId && datasets.length > 0) {
      setSelectedId(datasets[0].id);
    }
  }, [selectedId, datasets]);

  // DAX measures
  const { data: daxData, isLoading: daxLoading } = useQuery({
    queryKey: ["pbi-dax", selectedId],
    queryFn: () => apiFetch<any>(`/powerbi/${selectedId}/dax-measures`),
    enabled: !!selectedId && activeTab === "dax",
    retry: false,
  });

  // M Query
  const { data: mqData, isLoading: mqLoading } = useQuery({
    queryKey: ["pbi-mq", selectedId],
    queryFn: () => apiFetch<any>(`/powerbi/${selectedId}/m-query`),
    enabled: !!selectedId && activeTab === "mquery",
    retry: false,
  });

  // Data Model
  const { data: modelData, isLoading: modelLoading } = useQuery({
    queryKey: ["pbi-model", selectedId],
    queryFn: () => apiFetch<any>(`/powerbi/${selectedId}/data-model`),
    enabled: !!selectedId && activeTab === "model",
    retry: false,
  });

  const copyToClipboard = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const measures = daxData?.measures ?? [];

  const copyAllDax = useCallback(() => {
    if (measures.length === 0) return;
    const text = measures.map((m: any) => `${m.name} = ${m.expression}`).join("\n\n");
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${measures.length} measures`);
    setCopiedId("copy-all");
    setTimeout(() => setCopiedId(null), 2000);
  }, [measures]);

  return (
    <AppShell title="Power BI" subtitle="DAX measures, M Query, and data model generation" status="ready">
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md">
                <FileBarChart className="h-5 w-5 text-white" />
              </div>
              Power BI Report Builder
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Auto-generate DAX measures, Power Query M code, and data models from your datasets
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedId ?? ""} onValueChange={setSelectedId}>
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Select a dataset" />
              </SelectTrigger>
              <SelectContent>
                {datasets.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    <span className="flex items-center gap-2">
                      <Database className="h-3.5 w-3.5 text-muted-foreground" />
                      {d.name || d.filename || d.id}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Main tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="dax" className="gap-1.5">
              <FileBarChart className="h-3.5 w-3.5" /> DAX Measures
            </TabsTrigger>
            <TabsTrigger value="mquery" className="gap-1.5">
              <Code2 className="h-3.5 w-3.5" /> M Query
            </TabsTrigger>
            <TabsTrigger value="model" className="gap-1.5">
              <GitBranch className="h-3.5 w-3.5" /> Data Model
            </TabsTrigger>
          </TabsList>

          {/* DAX Measures */}
          <TabsContent value="dax" className="space-y-4 mt-4">
            {daxLoading ? (
              <LoadingCard />
            ) : daxData?.measures ? (
              <>
                {/* Summary bar */}
                <Card className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <span className="text-sm text-muted-foreground">Generated for</span>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-foreground text-lg tabular-nums">{daxData.total_measures}</span>
                      <span className="text-sm text-muted-foreground">measures in</span>
                      <span className="font-mono text-accent">{daxData.table_name}</span>
                    </div>
                  </div>
                  {Array.isArray(daxData.categories) && daxData.categories.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {daxData.categories.map((c: string) => (
                        <Badge key={c} variant="outline" className="text-[10px] font-mono uppercase tracking-wide">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyAllDax}
                    disabled={measures.length === 0}
                    className="gap-2"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copiedId === "copy-all" ? "Copied" : "Copy all"}
                  </Button>
                </Card>

                {/* Measures list */}
                <div className="space-y-3">
                  {measures.map((m: any, i: number) => (
                    <Card key={m.name + i} className="p-4 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <FileBarChart className="h-4 w-4 text-accent" />
                        <span className="text-sm font-semibold text-foreground">{m.name}</span>
                        {m.type && (
                          <Badge variant="outline" className={cn("text-[9px] capitalize", MEASURE_TYPE_COLORS[m.type] || "")}>
                            {m.type.replace("_", " ")}
                          </Badge>
                        )}
                        {m.column && m.column !== "_table_" && (
                          <span className="text-[10px] text-muted-foreground font-mono">{m.column}</span>
                        )}
                      </div>
                      <pre className="p-3 rounded-lg bg-surface/60 border border-border/40 text-[12px] font-mono text-foreground whitespace-pre-wrap leading-relaxed">
                        {m.name} = {m.expression}
                      </pre>
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-2"
                          onClick={() => copyToClipboard(`${m.name} = ${m.expression}`, m.name)}
                        >
                          {copiedId === m.name ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                          {copiedId === m.name ? "Copied" : "Copy"}
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </>
            ) : (
              <EmptyCard message="Select a dataset to generate DAX measures" />
            )}
          </TabsContent>

          {/* M Query */}
          <TabsContent value="mquery" className="space-y-4 mt-4">
            {mqLoading ? (
              <LoadingCard />
            ) : mqData?.m_query ? (
              <Card className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Power Query M Code</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {mqData.column_count} columns · Table: <span className="font-mono text-accent">{mqData.table_name}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => copyToClipboard(mqData.m_query, "mquery-full")}>
                      {copiedId === "mquery-full" ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                      Copy M Query
                    </Button>
                  </div>
                </div>

                <pre className="p-4 rounded-xl bg-surface/60 border border-border/40 text-[12px] font-mono text-foreground overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-[400px]">
                  {mqData.m_query}
                </pre>

                {/* Column list */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Columns ({mqData.column_count})</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(mqData.columns || []).map((col: string) => (
                      <Badge key={col} variant="outline" className="text-[10px] font-mono">
                        {col}
                      </Badge>
                    ))}
                  </div>
                </div>
              </Card>
            ) : (
              <EmptyCard message="Select a dataset to generate Power Query M code" />
            )}
          </TabsContent>

          {/* Data Model */}
          <TabsContent value="model" className="space-y-4 mt-4">
            {modelLoading ? (
              <LoadingCard />
            ) : modelData ? (
              <>
                {/* Suggested visuals */}
                {modelData.suggested_visuals?.length > 0 && (
                  <Card className="p-5">
                    <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                      <Eye className="h-4 w-4 text-accent" /> Recommended Visuals
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {modelData.suggested_visuals.map((v: any, i: number) => {
                        const Icon = VISUAL_ICONS[v.type] || BarChart3;
                        return (
                          <motion.div
                            key={i}
                            className="rounded-xl border border-border bg-card p-4 hover:border-accent/40 transition-all"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.05 }}
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <div className="h-8 w-8 rounded-lg bg-accent/10 flex items-center justify-center">
                                <Icon className="h-4 w-4 text-accent" />
                              </div>
                              <div>
                                <p className="text-[11px] font-semibold text-foreground capitalize">{v.type}</p>
                                <p className="text-[9px] text-muted-foreground">{v.description}</p>
                              </div>
                            </div>
                            <p className="text-[11px] text-foreground font-medium truncate">{v.title}</p>
                          </motion.div>
                        );
                      })}
                    </div>
                  </Card>
                )}

                {/* Table schema */}
                {modelData.tables?.length > 0 && (
                  <Card className="p-5">
                    <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                      <Table2 className="h-4 w-4 text-accent" /> Table Schema
                    </h3>
                    {modelData.tables.map((table: any) => (
                      <div key={table.name} className="space-y-2">
                        <div className="flex items-center gap-2 mb-3">
                          <Database className="h-4 w-4 text-accent" />
                          <span className="text-sm font-semibold text-foreground">{table.name}</span>
                          <Badge variant="outline" className="text-[10px]">{table.columns?.length} columns</Badge>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {(table.columns || []).map((col: any) => (
                            <div key={col.name} className="flex items-center gap-2 p-2.5 rounded-lg bg-surface/40 border border-border/40">
                              {col.role === "measure" ? <Hash className="h-3.5 w-3.5 text-blue-500 shrink-0" /> :
                                col.role === "date" ? <Calendar className="h-3.5 w-3.5 text-amber-500 shrink-0" /> :
                                  <Type className="h-3.5 w-3.5 text-violet-500 shrink-0" />}
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-medium text-foreground truncate">{col.name}</p>
                                <p className="text-[9px] text-muted-foreground font-mono">{col.dataType} · {col.role}</p>
                              </div>
                              {col.summarizeBy && (
                                <Badge variant="outline" className="text-[8px]">{col.summarizeBy}</Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </Card>
                )}

                {/* Hierarchies */}
                {modelData.hierarchies?.length > 0 && (
                  <Card className="p-5">
                    <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                      <Layers className="h-4 w-4 text-accent" /> Date Hierarchies
                    </h3>
                    <div className="space-y-3">
                      {modelData.hierarchies.map((h: any) => (
                        <div key={h.name} className="rounded-lg bg-surface/30 border border-border/40 p-3">
                          <p className="text-[12px] font-semibold text-foreground mb-2">{h.name}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            {(h.levels || []).map((l: any, i: number) => (
                              <div key={l.name} className="flex items-center gap-1.5">
                                <div className="px-2.5 py-1 rounded-md bg-accent/10 border border-accent/20">
                                  <p className="text-[10px] font-semibold text-accent">{l.name}</p>
                                  <p className="text-[8px] text-muted-foreground font-mono">{l.expression}</p>
                                </div>
                                {i < h.levels.length - 1 && <span className="text-muted-foreground text-xs">→</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Relationships */}
                {modelData.relationships?.length > 0 && (
                  <Card className="p-5">
                    <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-accent" /> Detected Relationships
                    </h3>
                    <div className="space-y-2">
                      {modelData.relationships.slice(0, 10).map((rel: any, i: number) => (
                        <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-surface/30 border border-border/40">
                          <ArrowUpDown className="h-4 w-4 text-accent shrink-0" />
                          <span className="text-[11px] font-medium text-foreground">{rel.column_a || rel.from}</span>
                          <span className="text-[10px] text-muted-foreground">↔</span>
                          <span className="text-[11px] font-medium text-foreground">{rel.column_b || rel.to}</span>
                          {rel.strength && (
                            <Badge variant="outline" className="text-[9px] ml-auto">{rel.strength}</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </>
            ) : (
              <EmptyCard message="Select a dataset to generate a data model" />
            )}
          </TabsContent>

          {/* Advanced metrics section removed to keep Power BI page focused */}
        </Tabs>
      </div>
    </AppShell>
  );
};

const LoadingCard = () => (
  <Card className="p-10 flex items-center justify-center">
    <Loader2 className="h-5 w-5 animate-spin text-accent mr-2" />
    <span className="text-sm text-muted-foreground">Generating...</span>
  </Card>
);

const EmptyCard = ({ message }: { message: string }) => (
  <Card className="p-10 text-center text-muted-foreground">
    <Database className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
    <p className="text-sm">{message}</p>
  </Card>
);

export default PowerBI;
