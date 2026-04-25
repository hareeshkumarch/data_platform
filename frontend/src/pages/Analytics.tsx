import { useState, useEffect, useCallback, useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiFetch } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { Dataset } from "@/lib/types";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database, GitBranch, Copy, CheckCircle2,
  Eye, Layers, BarChart3, LineChart, PieChart,
  Table2, Gauge, ArrowUpDown, Calendar, Hash, Type,
  Sparkles, Code2, Loader2, Download, Search, SortAsc,
  Filter, ChevronDown, ChevronRight, TrendingUp, Zap,
  FunctionSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

const MEASURE_TYPE_STYLES: Record<string, { bg: string; text: string; border: string; glow: string; label: string }> = {
  aggregate:         { bg: "bg-blue-500/10",    text: "text-blue-500",    border: "border-blue-500/30",    glow: "shadow-blue-500/20",    label: "Aggregate" },
  time_intelligence: { bg: "bg-amber-500/10",   text: "text-amber-500",   border: "border-amber-500/30",   glow: "shadow-amber-500/20",   label: "Time Intelligence" },
  categorical:       { bg: "bg-violet-500/10",  text: "text-violet-500",  border: "border-violet-500/30",  glow: "shadow-violet-500/20",  label: "Categorical" },
  count:             { bg: "bg-emerald-500/10", text: "text-emerald-500", border: "border-emerald-500/30", glow: "shadow-emerald-500/20", label: "Count" },
  metadata:          { bg: "bg-slate-500/10",   text: "text-slate-500",   border: "border-slate-500/30",   glow: "shadow-slate-500/20",   label: "Metadata" },
  quality:           { bg: "bg-pink-500/10",    text: "text-pink-500",    border: "border-pink-500/30",    glow: "shadow-pink-500/20",    label: "Quality" },
};

const getTypeStyle = (type?: string) =>
  (type && MEASURE_TYPE_STYLES[type]) || { bg: "bg-slate-500/10", text: "text-slate-500", border: "border-slate-500/30", glow: "", label: type || "—" };

// --- DAX token highlighter (lightweight, zero-dep) ---
const DAX_KEYWORDS = new Set([
  "CALCULATE","CALCULATETABLE","FILTER","ALL","ALLEXCEPT","VALUES","DISTINCT","RELATED","RELATEDTABLE",
  "SUMX","AVERAGEX","COUNTX","COUNTAX","MAXX","MINX","SUM","AVERAGE","COUNT","COUNTA","MAX","MIN","DIVIDE",
  "IF","SWITCH","AND","OR","NOT","TRUE","FALSE","BLANK","ISBLANK","HASONEVALUE",
  "TOTALYTD","TOTALMTD","TOTALQTD","DATEADD","DATESYTD","SAMEPERIODLASTYEAR","PARALLELPERIOD","PREVIOUSMONTH","PREVIOUSYEAR","DATESBETWEEN",
  "VAR","RETURN","EARLIER","RANKX","TOPN","UNION","INTERSECT","EXCEPT","SELECTEDVALUE","CONCATENATEX",
  "FORMAT","ROUND","FIXED","LEN","UPPER","LOWER","LEFT","RIGHT","MID","SUBSTITUTE","TRIM",
]);

function highlightDax(src: string) {
  const re = /("(?:[^"\\]|\\.)*")|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|(.)/g;
  const out: Array<{ t: string; k: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1]) out.push({ t: m[1], k: "str" });
    else if (m[2]) out.push({ t: m[2], k: "com" });
    else if (m[3]) out.push({ t: m[3], k: "num" });
    else if (m[4]) out.push({ t: m[4], k: DAX_KEYWORDS.has(m[4].toUpperCase()) ? "kw" : "id" });
    else if (m[5]) out.push({ t: m[5], k: "ws" });
    else if (m[6]) out.push({ t: m[6], k: /[(),\[\].]/.test(m[6]) ? "pun" : "op" });
  }
  return out;
}

const DaxCode = ({ code }: { code: string }) => {
  const tokens = useMemo(() => highlightDax(code), [code]);
  return (
    <pre className="p-4 rounded-xl bg-[#0b1020] border border-border/40 text-[12.5px] font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">
      {tokens.map((t, i) => {
        const cls =
          t.k === "kw"  ? "text-sky-400 font-semibold" :
          t.k === "str" ? "text-emerald-300" :
          t.k === "num" ? "text-amber-300" :
          t.k === "com" ? "text-slate-500 italic" :
          t.k === "pun" ? "text-slate-400" :
          t.k === "op"  ? "text-pink-400" :
          t.k === "id"  ? "text-slate-100" :
                          "text-slate-300";
        return <span key={i} className={cls}>{t.t}</span>;
      })}
    </pre>
  );
};

const downloadFile = (filename: string, content: string, mime = "text/plain") => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// --- Fancy animated brand mark ---
const BrandMark = () => (
  <div className="relative h-12 w-12 shrink-0">
    <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-amber-400 p-[1.5px] shadow-lg">
      <div className="h-full w-full rounded-[14px] bg-[#0b1020] flex items-center justify-center">
        <FunctionSquare className="h-6 w-6 text-white drop-shadow" strokeWidth={2.2} />
        <Sparkles className="h-3 w-3 text-amber-300 absolute top-1.5 right-1.5 drop-shadow" />
      </div>
    </div>
  </div>
);

type SortMode = "name" | "type" | "column";

const Analytics = () => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("dax");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("type");
  const [groupByType, setGroupByType] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const { data: datasetsResp } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => apiFetch<{ datasets: Dataset[] }>("/datasets"),
  });
  const datasets = datasetsResp?.datasets ?? [];

  useEffect(() => {
    if (!selectedId && datasets.length > 0) setSelectedId(datasets[0].id);
  }, [selectedId, datasets]);

  const { data: daxData, isLoading: daxLoading } = useQuery({
    queryKey: ["pbi-dax", selectedId],
    queryFn: () => apiFetch<any>(`/powerbi/${selectedId}/dax-measures`),
    enabled: !!selectedId && activeTab === "dax",
    retry: false,
  });

  const { data: mqData, isLoading: mqLoading } = useQuery({
    queryKey: ["pbi-mq", selectedId],
    queryFn: () => apiFetch<any>(`/powerbi/${selectedId}/m-query`),
    enabled: !!selectedId && activeTab === "mquery",
    retry: false,
  });

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

  const rawMeasures: any[] = daxData?.measures ?? [];
  const activeDataset = datasets.find((d) => d.id === selectedId);
  const datasetLabel = activeDataset?.name || activeDataset?.filename || daxData?.table_name || "—";

  // Type breakdown stats
  const typeBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    rawMeasures.forEach((m) => map.set(m.type || "other", (map.get(m.type || "other") || 0) + 1));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [rawMeasures]);

  // Filter + sort pipeline
  const filteredMeasures = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rawMeasures.filter((m) => {
      if (typeFilter !== "all" && m.type !== typeFilter) return false;
      if (!q) return true;
      return (
        (m.name || "").toLowerCase().includes(q) ||
        (m.expression || "").toLowerCase().includes(q) ||
        (m.column || "").toLowerCase().includes(q) ||
        (m.type || "").toLowerCase().includes(q)
      );
    });
    list = [...list].sort((a, b) => {
      const av = (a[sortMode] || "").toString().toLowerCase();
      const bv = (b[sortMode] || "").toString().toLowerCase();
      return av.localeCompare(bv);
    });
    return list;
  }, [rawMeasures, search, typeFilter, sortMode]);

  // Group by type for nicer layout
  const groupedMeasures = useMemo(() => {
    if (!groupByType) return [{ key: "all", label: "All measures", items: filteredMeasures }];
    const groups = new Map<string, any[]>();
    filteredMeasures.forEach((m) => {
      const key = m.type || "other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    });
    return Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([key, items]) => ({ key, label: getTypeStyle(key).label, items }));
  }, [filteredMeasures, groupByType]);

  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  const copyAllDax = useCallback(() => {
    if (filteredMeasures.length === 0) return;
    const text = filteredMeasures.map((m: any) => `${m.name} = ${m.expression}`).join("\n\n");
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${filteredMeasures.length} measure${filteredMeasures.length > 1 ? "s" : ""}`);
    setCopiedId("copy-all");
    setTimeout(() => setCopiedId(null), 2000);
  }, [filteredMeasures]);

  const exportDax = useCallback(() => {
    if (filteredMeasures.length === 0) return;
    const header = `// Analytics Measure export\n// Dataset: ${datasetLabel}\n// Measures: ${filteredMeasures.length}\n// Generated: ${new Date().toISOString()}\n\n`;
    const body = filteredMeasures.map((m: any) => `// Type: ${m.type || "—"}${m.column ? `  Column: ${m.column}` : ""}\n${m.name} = ${m.expression}`).join("\n\n");
    downloadFile(`analytics-measures-${(datasetLabel || "dataset").replace(/\s+/g, "_")}.dax`, header + body);
    toast.success("DAX file downloaded");
  }, [filteredMeasures, datasetLabel]);

  const exportMQuery = useCallback(() => {
    if (!mqData?.m_query) return;
    downloadFile(`analytics-measures-${(datasetLabel || "dataset").replace(/\s+/g, "_")}.pq`, mqData.m_query);
    toast.success("M Query file downloaded");
  }, [mqData, datasetLabel]);

  return (
    <AppShell
      title="Analytics Studio"
      subtitle="Dynamic DAX, Power Query M, and data model generator"
      status={daxLoading || mqLoading || modelLoading ? "processing" : "ready"}
    >
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <BrandMark />
            <div>
              <h1 className="text-2xl font-semibold text-foreground tracking-tight flex items-center gap-2">
                Analytics Studio
                <Badge variant="outline" className="text-[10px] font-mono border-fuchsia-500/30 text-fuchsia-500 bg-fuchsia-500/5">
                  DAX · M · MODEL
                </Badge>
              </h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                Auto-generate production-grade measures, Power Query transforms, and semantic models — with live search, type-aware grouping, and one-click export.
              </p>
            </div>
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

        {/* KPI strip */}
        {rawMeasures.length > 0 && activeTab === "dax" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-3"
          >
            <KpiTile icon={FunctionSquare} label="Total measures" value={rawMeasures.length} accent="from-indigo-500 to-fuchsia-500" />
            <KpiTile icon={Filter} label="Filtered" value={filteredMeasures.length} accent="from-sky-500 to-cyan-400" />
            <KpiTile icon={Layers} label="Distinct types" value={typeBreakdown.length} accent="from-emerald-500 to-lime-400" />
            <KpiTile icon={TrendingUp} label="Table" value={daxData?.table_name || "—"} accent="from-amber-500 to-orange-500" isText />
          </motion.div>
        )}

        {/* Main tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="dax" className="gap-1.5">
              <FunctionSquare className="h-3.5 w-3.5" /> DAX Measures
            </TabsTrigger>
            <TabsTrigger value="mquery" className="gap-1.5">
              <Code2 className="h-3.5 w-3.5" /> M Query
            </TabsTrigger>
            <TabsTrigger value="model" className="gap-1.5">
              <GitBranch className="h-3.5 w-3.5" /> Data Model
            </TabsTrigger>
          </TabsList>

          {/* ==================== DAX ==================== */}
          <TabsContent value="dax" className="space-y-4 mt-4">
            {daxLoading ? (
              <LoadingCard />
            ) : daxData?.measures ? (
              <>
                {/* Toolbar */}
                <Card className="p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-1 items-center gap-2 flex-wrap">
                    <div className="relative flex-1 min-w-[220px] max-w-md">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search name, expression, column…"
                        className="pl-8 h-9"
                      />
                    </div>
                    <Select value={typeFilter} onValueChange={setTypeFilter}>
                      <SelectTrigger className="w-[170px] h-9">
                        <Filter className="h-3.5 w-3.5 mr-1" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All types</SelectItem>
                        {typeBreakdown.map(([type, count]) => (
                          <SelectItem key={type} value={type}>
                            {getTypeStyle(type).label} · {count}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
                      <SelectTrigger className="w-[150px] h-9">
                        <SortAsc className="h-3.5 w-3.5 mr-1" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="type">Sort: Type</SelectItem>
                        <SelectItem value="name">Sort: Name</SelectItem>
                        <SelectItem value="column">Sort: Column</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant={groupByType ? "default" : "outline"}
                      size="sm"
                      onClick={() => setGroupByType((v) => !v)}
                      className="h-9 gap-1.5"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      Group
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={copyAllDax} disabled={filteredMeasures.length === 0} className="gap-2 h-9">
                      <Copy className="h-3.5 w-3.5" />
                      {copiedId === "copy-all" ? "Copied" : "Copy all"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportDax} disabled={filteredMeasures.length === 0} className="gap-2 h-9">
                      <Download className="h-3.5 w-3.5" /> .dax
                    </Button>
                  </div>
                </Card>

                {/* Type breakdown chips */}
                {typeBreakdown.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => setTypeFilter("all")}
                      className={cn(
                        "text-[11px] px-2.5 py-1 rounded-md border transition-colors",
                        typeFilter === "all" ? "bg-accent/15 border-accent/40 text-accent" : "border-border hover:border-accent/30"
                      )}
                    >
                      All · {rawMeasures.length}
                    </button>
                    {typeBreakdown.map(([type, count]) => {
                      const s = getTypeStyle(type);
                      return (
                        <button
                          key={type}
                          onClick={() => setTypeFilter((c) => (c === type ? "all" : type))}
                          className={cn(
                            "text-[11px] px-2.5 py-1 rounded-md border transition-colors",
                            s.border, s.bg, s.text,
                            typeFilter === type ? "ring-1 ring-offset-0 ring-current" : "opacity-85 hover:opacity-100",
                          )}
                        >
                          {s.label} · {count}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Measures */}
                {filteredMeasures.length === 0 ? (
                  <EmptyCard message="No measures match your filters" />
                ) : (
                  <div className="space-y-5">
                    {groupedMeasures.map((group) => {
                      const collapsed = collapsedGroups[group.key];
                      const style = getTypeStyle(group.key);
                      return (
                        <div key={group.key} className="space-y-3">
                          {groupByType && (
                            <button
                              onClick={() => toggleGroup(group.key)}
                              className={cn(
                                "w-full flex items-center gap-2 p-2.5 rounded-lg border bg-card hover:bg-accent/5 transition-colors",
                                style.border,
                              )}
                            >
                              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              <span className={cn("text-sm font-semibold", style.text)}>{group.label}</span>
                              <Badge variant="outline" className="ml-auto text-[11px]">{group.items.length}</Badge>
                            </button>
                          )}
                          <AnimatePresence initial={false}>
                            {!collapsed && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="space-y-3 overflow-hidden"
                              >
                                {group.items.map((m, i) => (
                                  <MeasureCard
                                    key={`${group.key}-${m.name}-${i}`}
                                    measure={m}
                                    copiedId={copiedId}
                                    onCopy={() => copyToClipboard(`${m.name} = ${m.expression}`, m.name)}
                                  />
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <EmptyCard message="Select a dataset to generate DAX measures" />
            )}
          </TabsContent>

          {/* ==================== M QUERY ==================== */}
          <TabsContent value="mquery" className="space-y-4 mt-4">
            {mqLoading ? (
              <LoadingCard />
            ) : mqData?.m_query ? (
              <Card className="p-5 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Zap className="h-4 w-4 text-amber-500" /> Power Query M Code
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {mqData.column_count} columns · Table: <span className="font-mono text-accent">{mqData.table_name}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => copyToClipboard(mqData.m_query, "mquery-full")}>
                      {copiedId === "mquery-full" ? <CheckCircle2 className="h-3.5 w-3.5 text-success mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
                      Copy
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportMQuery}>
                      <Download className="h-3.5 w-3.5 mr-1.5" /> .pq
                    </Button>
                  </div>
                </div>

                <pre className="p-4 rounded-xl bg-[#0b1020] border border-border/40 text-[12.5px] font-mono text-slate-100 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-[460px]">
                  {mqData.m_query}
                </pre>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Columns ({mqData.column_count})
                  </p>
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

          {/* ==================== MODEL ==================== */}
          <TabsContent value="model" className="space-y-4 mt-4">
            {modelLoading ? (
              <LoadingCard />
            ) : modelData ? (
              <>
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
                                  <p className="text-[11px] font-semibold text-accent">{l.name}</p>
                                  <p className="text-[10px] text-muted-foreground font-mono">{l.expression}</p>
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

                {modelData.relationships?.length > 0 && (
                  <Card className="p-5">
                    <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-accent" /> Detected Relationships
                    </h3>
                    <div className="space-y-2">
                      {modelData.relationships.slice(0, 10).map((rel: any, i: number) => (
                        <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-surface/30 border border-border/40">
                          <ArrowUpDown className="h-4 w-4 text-accent shrink-0" />
                          <span className="text-[12px] font-medium text-foreground">{rel.column_a || rel.from}</span>
                          <span className="text-[11px] text-muted-foreground">↔</span>
                          <span className="text-[12px] font-medium text-foreground">{rel.column_b || rel.to}</span>
                          {rel.strength && (
                            <Badge variant="outline" className="text-[10px] ml-auto">{rel.strength}</Badge>
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
        </Tabs>
      </div>
    </AppShell>
  );
};

// ---- Subcomponents ----

const KpiTile = ({
  icon: Icon, label, value, accent, isText,
}: { icon: typeof Gauge; label: string; value: number | string; accent: string; isText?: boolean }) => (
  <Card className="relative overflow-hidden p-4">
    <div className="flex items-center gap-2 text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      <span className="text-[12px] uppercase tracking-[0.14em]">{label}</span>
    </div>
    <p className={cn("mt-2 text-2xl font-semibold tabular-nums text-foreground", isText && "text-base font-mono truncate")}>{value}</p>
  </Card>
);

const MeasureCard = ({
  measure: m, copiedId, onCopy,
}: { measure: any; copiedId: string | null; onCopy: () => void }) => {
  const [expanded, setExpanded] = useState(true);
  const style = getTypeStyle(m.type);
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
      <Card className={cn("p-4 space-y-3 border-l-[3px]", style.border)}>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setExpanded((v) => !v)} className="flex items-center gap-1.5 text-left">
            {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            <FunctionSquare className={cn("h-4 w-4", style.text)} />
            <span className="text-sm font-semibold text-foreground">{m.name}</span>
          </button>
          {m.type && (
            <Badge variant="outline" className={cn("text-[10px] capitalize", style.bg, style.text, style.border)}>
              {style.label}
            </Badge>
          )}
          {m.column && m.column !== "_table_" && (
            <span className="text-[11px] text-muted-foreground font-mono">{m.column}</span>
          )}
          <div className="ml-auto">
            <Button variant="ghost" size="sm" className="gap-1.5 h-7" onClick={onCopy}>
              {copiedId === m.name ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
              {copiedId === m.name ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <DaxCode code={`${m.name} = ${m.expression}`} />
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
};

const LoadingCard = () => (
  <Card className="p-10 flex items-center justify-center">
    <Loader2 className="h-5 w-5 animate-spin text-accent mr-2" />
    <span className="text-sm text-muted-foreground">Generating...</span>
  </Card>
);

const EmptyCard = ({ message, hint }: { message: string; hint?: string }) => (
  <Card className="p-10 text-center text-muted-foreground">
    <Database className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
    <p className="text-sm font-medium text-foreground">{message}</p>
    {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    {!hint && <p className="text-xs text-muted-foreground mt-1">Choose a dataset from the dropdown above, or upload a new one to get started.</p>}
  </Card>
);

export default Analytics;
