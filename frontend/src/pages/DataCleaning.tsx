import { useEffect, useMemo, useState, useCallback } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiFetch } from "@/lib/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dataset } from "@/lib/types";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileText,
  Filter,
  Info,
  Loader2,
  PlayCircle,
  Save,
  ShieldAlert,
  Sparkles,
  Wand2,
  X,
  Mail,
  Globe,
  Phone,
  DollarSign,
  Calendar,
  Hash,
  Type,
  Regex,
  Braces,
  Trash2,
  ArrowRight,
  Settings2,
  Eraser,
  Binary,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Suggestion {
  id: string;
  column: string | null;
  op: string;
  label: string;
  description: string;
  severity: "critical" | "warning" | "info";
  category: string;
  semantic_type: string;
  impact: Record<string, number | string>;
  params: Record<string, unknown>;
  reversible: boolean;
  auto_safe: boolean;
}

interface SuggestResponse {
  dataset_id: string;
  row_count: number;
  col_count: number;
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
    auto_safe: number;
  };
  semantic_types: Record<string, string>;
  suggestions: Suggestion[];
}

interface PreviewResponse {
  rows_before: number;
  rows_after: number;
  cells_modified: number;
  columns_before: string[];
  columns_after: string[];
  columns_dropped: string[];
  columns_added: string[];
  null_pct_changes: Array<{
    column: string;
    before_null_pct: number;
    after_null_pct: number;
    delta_pct: number;
  }>;
  preview: { columns: string[]; rows: Array<Record<string, unknown>> };
  steps: Array<{
    id?: string;
    op: string;
    column?: string | null;
    status: string;
    cells_modified?: number;
    error?: string;
  }>;
}

interface ApplyResponse {
  dataset_id: string;
  source_dataset_id: string;
  filename: string;
  name: string;
  rows: number;
  cols: number;
  report: PreviewResponse;
}

// ---------------------------------------------------------------------------
// Visual helpers
// ---------------------------------------------------------------------------

const severityStyle = {
  critical: {
    badge: "bg-red-500/15 text-red-600 border-red-500/30",
    icon: ShieldAlert,
    label: "Critical",
  },
  warning: {
    badge: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    icon: AlertTriangle,
    label: "Warning",
  },
  info: {
    badge: "bg-sky-500/15 text-sky-600 border-sky-500/30",
    icon: Info,
    label: "Info",
  },
} as const;

const semanticColor: Record<string, string> = {
  numeric: "bg-blue-500/10 text-blue-600",
  datetime: "bg-violet-500/10 text-violet-600",
  boolean: "bg-emerald-500/10 text-emerald-600",
  email: "bg-pink-500/10 text-pink-600",
  url: "bg-indigo-500/10 text-indigo-600",
  phone: "bg-teal-500/10 text-teal-600",
  currency: "bg-yellow-500/10 text-yellow-600",
  identifier: "bg-slate-500/10 text-slate-600",
  categorical: "bg-orange-500/10 text-orange-600",
  text: "bg-zinc-500/10 text-zinc-600",
  dataset: "bg-purple-500/10 text-purple-600",
};

function impactSummary(s: Suggestion): string {
  const i = s.impact || {};
  const parts: string[] = [];
  if (typeof i.rows_removed === "number") parts.push(`${i.rows_removed} rows removed`);
  if (typeof i.rows_affected === "number") parts.push(`${i.rows_affected} rows`);
  if (typeof i.cells_modified === "number") parts.push(`${i.cells_modified} cells`);
  if (typeof i.cells_removed === "number") parts.push(`${i.cells_removed} cells`);
  if (typeof i.groups_merged === "number") parts.push(`merges ${i.groups_merged} groups`);
  if (typeof i.null_pct === "number") parts.push(`${i.null_pct}% missing`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const DataCleaning = () => {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterSeverity, setFilterSeverity] = useState<"all" | "critical" | "warning" | "info">("all");
  const [filterColumn, setFilterColumn] = useState<string>("all");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  // ── Dataset list ────────────────────────────────────────────────────────
  const { data: datasetsResp } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => apiFetch<{ datasets: Dataset[] }>("/datasets"),
  });
  const datasets = useMemo(
    () => (datasetsResp?.datasets ?? []).map((d) => ({ ...d, id: d.id || (d as unknown as { dataset_id: string }).dataset_id })),
    [datasetsResp]
  );

  // Auto-select first dataset when the list first loads.
  useEffect(() => {
    if (!selectedId && datasets.length > 0) setSelectedId(datasets[0].id);
  }, [datasets, selectedId]);

  // ── Suggestions ─────────────────────────────────────────────────────────
  const { data: suggestResp, isLoading: suggestLoading, refetch: refetchSuggestions } =
    useQuery<SuggestResponse>({
      queryKey: ["cleaning-suggest", selectedId],
      queryFn: () => apiFetch(`/cleaning/suggest/${selectedId}`, { method: "POST" }),
      enabled: !!selectedId,
      staleTime: 60_000,
    });

  const suggestions = suggestResp?.suggestions ?? [];

  const filtered = useMemo(() => {
    return suggestions.filter((s) => {
      if (filterSeverity !== "all" && s.severity !== filterSeverity) return false;
      if (filterColumn !== "all" && (s.column || "_dataset") !== filterColumn) return false;
      return true;
    });
  }, [suggestions, filterSeverity, filterColumn]);

  const uniqueColumns = useMemo(() => {
    const set = new Set<string>();
    suggestions.forEach((s) => set.add(s.column || "_dataset"));
    return Array.from(set);
  }, [suggestions]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPreview(null);
  };

  const selectAll = (severities: Array<"critical" | "warning" | "info"> | "auto") => {
    const ids = suggestions
      .filter((s) => (severities === "auto" ? s.auto_safe : severities.includes(s.severity)))
      .map((s) => s.id);
    setSelected(new Set(ids));
    setPreview(null);
  };

  const clearSelection = () => {
    setSelected(new Set());
    setPreview(null);
  };

  const selectedOps = useMemo(
    () => suggestions.filter((s) => selected.has(s.id)),
    [suggestions, selected]
  );

  // ── Preview / Apply ─────────────────────────────────────────────────────
  const runPreview = async () => {
    if (!selectedId || selectedOps.length === 0) return;
    setPreviewLoading(true);
    try {
      const result = await apiFetch<PreviewResponse>(
        `/cleaning/preview/${selectedId}`,
        {
          method: "POST",
          body: JSON.stringify({
            operations: selectedOps.map((s) => ({
              id: s.id,
              op: s.op,
              column: s.column,
              params: s.params,
            })),
          }),
        }
      );
      setPreview(result);
      setShowPreview(true);
    } catch (err) {
      toast.error((err as Error).message || "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  };

  const runApply = async () => {
    if (!selectedId || selectedOps.length === 0) return;
    setApplyLoading(true);
    try {
      const result = await apiFetch<ApplyResponse>(
        `/cleaning/apply/${selectedId}`,
        {
          method: "POST",
          body: JSON.stringify({
            save_as: saveName || undefined,
            operations: selectedOps.map((s) => ({
              id: s.id,
              op: s.op,
              column: s.column,
              params: s.params,
            })),
          }),
        }
      );
      toast.success(`Cleaned dataset created: ${result.name}`);
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      setSelectedId(result.dataset_id);
      setSelected(new Set());
      setPreview(null);
      setSaveName("");
      refetchSuggestions();
    } catch (err) {
      toast.error((err as Error).message || "Apply failed");
    } finally {
      setApplyLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  const summary = suggestResp?.summary;
  const currentDataset = datasets.find((d) => d.id === selectedId);

  return (
    <AppShell
      title="Data Cleaning"
      subtitle="Type-aware, auditable cleanup suggestions for your datasets"
    >
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Dataset picker & summary */}
        <Card className="p-5">
          <div className="flex flex-wrap items-end gap-4 justify-between">
            <div className="flex items-end gap-3 min-w-[260px]">
              <div>
                <label className="text-[12px] uppercase tracking-wide text-muted-foreground font-semibold block mb-1.5">
                  Dataset
                </label>
                <Select value={selectedId ?? ""} onValueChange={setSelectedId}>
                  <SelectTrigger className="w-[320px]">
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

              <Button
                onClick={() => refetchSuggestions()}
                disabled={!selectedId || suggestLoading}
                variant="outline"
              >
                {suggestLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                Re-analyze
              </Button>
            </div>

            {summary && (
              <div className="flex items-center gap-6 text-sm">
                <SummaryPill
                  label="Critical"
                  value={typeof summary.critical === "number" ? summary.critical : 0}
                  severity="critical"
                />
                <SummaryPill
                  label="Warning"
                  value={typeof summary.warning === "number" ? summary.warning : 0}
                  severity="warning"
                />
                <SummaryPill label="Info" value={typeof summary.info === "number" ? summary.info : 0} severity="info" />
                <div className="text-muted-foreground pl-4 border-l border-border">
                  <span className="font-semibold text-foreground">
                    {typeof summary.auto_safe === "number" ? summary.auto_safe : 0}
                  </span>{" "}
                  auto-safe
                </div>
              </div>
            )}
          </div>

          {currentDataset && (
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>
                <span className="font-semibold text-foreground">
                  {suggestResp?.row_count?.toLocaleString() ?? "—"}
                </span>{" "}
                rows
              </span>
              <span>
                <span className="font-semibold text-foreground">
                  {suggestResp?.col_count ?? "—"}
                </span>{" "}
                columns
              </span>
              <span>
                File:{" "}
                <span className="font-mono text-foreground/80">
                  {currentDataset.filename ?? currentDataset.id}
                </span>
              </span>
            </div>
          )}
        </Card>

        {/* Toolbar */}
        <Card className="p-4 flex flex-wrap items-center gap-3">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
          <Tabs
            value={filterSeverity}
            onValueChange={(v) => setFilterSeverity(v as typeof filterSeverity)}
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="critical">Critical</TabsTrigger>
              <TabsTrigger value="warning">Warnings</TabsTrigger>
              <TabsTrigger value="info">Info</TabsTrigger>
            </TabsList>
          </Tabs>

          <Select value={filterColumn} onValueChange={setFilterColumn}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Column" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All columns</SelectItem>
              {uniqueColumns.map((c) => (
                <SelectItem key={c} value={c}>
                  {c === "_dataset" ? "Dataset-level" : c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1" />

          <Button variant="outline" size="sm" onClick={() => selectAll(["critical", "warning", "info"])}>
            Select all ({filtered.length})
          </Button>
          <Button variant="outline" size="sm" onClick={() => selectAll("auto")}>
            <Sparkles className="h-3.5 w-3.5" />
            Select auto-safe
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => selectAll(["critical"])}
          >
            Select critical
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => selectAll(["critical", "warning"])}
          >
            Select critical + warnings
          </Button>
          {selected.size > 0 && (
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              <X className="h-3.5 w-3.5" /> Clear ({selected.size})
            </Button>
          )}
        </Card>

        {/* Suggestion list */}
        <div className="grid gap-3">
          {suggestLoading && (
            <Card className="p-10 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Analyzing dataset…
            </Card>
          )}

          {!suggestLoading && suggestions.length === 0 && selectedId && (
            <Card className="p-10 text-center text-muted-foreground">
              <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-emerald-500" />
              <div className="font-semibold text-foreground">
                No cleaning issues detected
              </div>
              <div className="text-sm mt-1">
                Your data is already in good shape. Re-run analysis after new
                uploads or try the semantic operations builder below.
              </div>
            </Card>
          )}

          {!suggestLoading && !selectedId && (
            <Card className="p-10 text-center text-muted-foreground">
              <Database className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
              <div className="font-semibold text-foreground">
                No dataset selected
              </div>
              <div className="text-sm mt-1">
                Choose a dataset from the dropdown above to scan for cleaning opportunities.
              </div>
            </Card>
          )}

          {filtered.map((s) => {
            const style = severityStyle[s?.severity as keyof typeof severityStyle] ?? severityStyle.info;
            const Icon = style.icon;
            const isSelected = selected.has(s.id);
            return (
              <Card
                key={s.id}
                className={cn(
                  "p-4 flex gap-4 items-start cursor-pointer transition-all border-l-4",
                  isSelected
                    ? "border-l-accent bg-accent/5 ring-1 ring-accent/40"
                    : "border-l-transparent hover:bg-muted/30",
                  s.severity === "critical" && !isSelected && "border-l-red-500/50",
                  s.severity === "warning" && !isSelected && "border-l-amber-500/50",
                  s.severity === "info" && !isSelected && "border-l-sky-500/40"
                )}
                onClick={() => toggle(s.id)}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggle(s.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1"
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        s.severity === "critical" && "text-red-500",
                        s.severity === "warning" && "text-amber-500",
                        s.severity === "info" && "text-sky-500"
                      )}
                    />
                    <span className="font-medium text-sm">{s.label}</span>
                    <Badge variant="outline" className={cn("text-[11px]", style.badge)}>
                      {style.label}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[11px]",
                        semanticColor[s.semantic_type] ?? "bg-muted"
                      )}
                    >
                      {s.semantic_type}
                    </Badge>
                    <Badge variant="outline" className="text-[11px] uppercase">
                      {s.category}
                    </Badge>
                    {s.auto_safe && (
                      <Badge
                        variant="outline"
                        className="text-[11px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                      >
                        auto-safe
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                    {s.description}
                  </p>
                  {impactSummary(s) && (
                    <div className="mt-2 text-xs text-muted-foreground font-mono">
                      Impact: {impactSummary(s)}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        {/* Footer action bar */}
        {selected.size > 0 && (
          <div className="sticky bottom-4 z-10 mx-auto">
            <Card className="p-3 flex items-center gap-3 shadow-xl border-accent/40 bg-background/95 backdrop-blur">
              <div className="text-sm">
                <span className="font-semibold text-foreground">
                  {selected.size}
                </span>{" "}
                operation{selected.size === 1 ? "" : "s"} selected
              </div>

              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Save as (optional name)"
                className="w-[260px]"
              />

              <div className="flex-1" />

              <Button
                variant="outline"
                onClick={runPreview}
                disabled={previewLoading}
              >
                {previewLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlayCircle className="h-4 w-4" />
                )}
                Preview
              </Button>
              <Button onClick={runApply} disabled={applyLoading}>
                {applyLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Apply & Save Copy
              </Button>
            </Card>
          </div>
        )}

        {/* Preview dialog */}
        <Dialog open={showPreview} onOpenChange={setShowPreview}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" /> Cleaning preview
              </DialogTitle>
              <DialogDescription>
                Dry-run of {selected.size} operation
                {selected.size === 1 ? "" : "s"}. Nothing has been saved yet.
              </DialogDescription>
            </DialogHeader>

            {preview && (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-3">
                  <MiniStat
                    label="Rows"
                    value={typeof preview.rows_before === "number" ? preview.rows_before : 0}
                    after={typeof preview.rows_after === "number" ? preview.rows_after : 0}
                  />
                  <MiniStat
                    label="Columns"
                    value={Array.isArray(preview.columns_before) ? preview.columns_before.length : 0}
                    after={Array.isArray(preview.columns_after) ? preview.columns_after.length : 0}
                  />
                  <MiniStat
                    label="Cells modified"
                    value={0}
                    after={typeof preview.cells_modified === "number" ? preview.cells_modified : 0}
                    highlight
                  />
                  <MiniStat
                    label="Columns dropped"
                    value={0}
                    after={Array.isArray(preview.columns_dropped) ? preview.columns_dropped.length : 0}
                    highlight
                  />
                </div>

                {Array.isArray(preview.null_pct_changes) && preview.null_pct_changes.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                      Missing-data improvements
                    </div>
                    <div className="space-y-1 text-xs">
                      {preview.null_pct_changes.slice(0, 8).map((c, i) => (
                        <div
                          key={c?.column ?? i}
                          className="flex items-center gap-3 font-mono"
                        >
                          <span className="w-40 truncate">{c?.column ?? "—"}</span>
                          <span className="text-muted-foreground">
                            {typeof c?.before_null_pct === "number" ? c.before_null_pct.toFixed(1) : "—"}%
                          </span>
                          <span>→</span>
                          <span
                            className={cn(
                              "font-semibold",
                              (typeof c?.delta_pct === "number" ? c.delta_pct : 0) > 0 ? "text-emerald-600" : "text-red-600"
                            )}
                          >
                            {typeof c?.after_null_pct === "number" ? c.after_null_pct.toFixed(1) : "—"}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {preview.preview && Array.isArray(preview.preview.columns) && (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                      First 20 cleaned rows
                    </div>
                    <div className="overflow-auto max-h-[320px] border border-border rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 sticky top-0">
                          <tr>
                            {preview.preview.columns.map((c) => (
                              <th
                                key={c}
                                className="px-2 py-1.5 text-left font-medium text-foreground"
                              >
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {Array.isArray(preview.preview.rows) && preview.preview.rows.slice(0, 20).map((row, idx) => (
                            <tr
                              key={idx}
                              className="border-t border-border/50 hover:bg-muted/30"
                            >
                              {preview.preview!.columns.map((c) => (
                                <td
                                  key={c}
                                  className="px-2 py-1 font-mono text-foreground/80"
                                >
                                  {formatCell(row?.[c])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowPreview(false)}>
                    Close
                  </Button>
                  <Button onClick={runApply} disabled={applyLoading}>
                    {applyLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Apply & save copy
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
        {/* ═══════ Semantic Operations Builder ═══════ */}
        <SemanticOpsBuilder datasetId={selectedId} />
      </div>
    </AppShell>
  );
};

// ---------------------------------------------------------------------------
// Semantic Operations Builder
// ---------------------------------------------------------------------------

type ParamKind = "string" | "int" | "float" | "enum";
interface ParamSpec {
  name: string;
  kind: ParamKind;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  options?: string[]; // for kind="enum"
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
}

interface OpDef {
  id: string;
  label: string;
  icon: typeof Mail;
  desc: string;
  category: string;
  needsColumn: boolean;
  params?: ParamSpec[];
}

const SEMANTIC_OPS: OpDef[] = [
  { id: "validate_emails", label: "Validate Emails", icon: Mail, desc: "Flag or remove invalid email addresses", category: "validation", needsColumn: true },
  { id: "validate_urls", label: "Validate URLs", icon: Globe, desc: "Flag or remove malformed URLs", category: "validation", needsColumn: true },
  { id: "validate_phones", label: "Validate Phones", icon: Phone, desc: "Flag or remove invalid phone numbers", category: "validation", needsColumn: true },
  { id: "normalize_currency", label: "Normalize Currency", icon: DollarSign, desc: "Strip symbols ($, €, ¥) and convert to numeric", category: "normalization", needsColumn: true },
  { id: "standardize_dates", label: "Standardize Dates", icon: Calendar, desc: "Convert to consistent date format (ISO 8601)", category: "normalization", needsColumn: true },
  {
    id: "regex_replace", label: "Regex Replace", icon: Regex, desc: "Apply regex pattern replacement", category: "transformation", needsColumn: true,
    params: [
      { name: "pattern", kind: "string", placeholder: "e.g. \\s+", required: true },
      { name: "replacement", kind: "string", placeholder: "replacement", defaultValue: "" },
    ],
  },
  { id: "remove_html_tags", label: "Strip HTML", icon: Braces, desc: "Remove HTML/XML tags from text", category: "cleaning", needsColumn: true },
  { id: "normalize_whitespace", label: "Normalize Whitespace", icon: Eraser, desc: "Collapse multiple spaces, trim edges", category: "cleaning", needsColumn: true },
  { id: "extract_numbers", label: "Extract Numbers", icon: Hash, desc: "Extract first numeric value from text", category: "extraction", needsColumn: true },
  {
    id: "round_numbers", label: "Round Numbers", icon: Hash, desc: "Round numeric values to N decimals", category: "transformation", needsColumn: true,
    params: [{ name: "decimals", kind: "int", defaultValue: "2", min: 0, max: 10, required: true }],
  },
  {
    id: "encode_categoricals", label: "Encode Categoricals", icon: Binary, desc: "One-hot or label encode categorical columns", category: "encoding", needsColumn: true,
    params: [{ name: "method", kind: "enum", options: ["one_hot", "label", "ordinal"], defaultValue: "one_hot", required: true }],
  },
  {
    id: "bin_numeric", label: "Bin Numeric", icon: Settings2, desc: "Bucket numeric values into bins", category: "transformation", needsColumn: true,
    params: [{ name: "bins", kind: "int", defaultValue: "5", min: 2, max: 50, required: true }],
  },
  { id: "log_transform", label: "Log Transform", icon: Settings2, desc: "Apply log(1+x) transform to reduce skewness", category: "transformation", needsColumn: true },
  {
    id: "deduplicate_fuzzy", label: "Fuzzy Dedup", icon: Type, desc: "Merge near-duplicate text values", category: "deduplication", needsColumn: true,
    params: [{ name: "threshold", kind: "float", defaultValue: "0.85", min: 0, max: 1, step: 0.01, required: true }],
  },
];

/** Coerce param map into correctly-typed values ready to ship to the backend. */
const coerceParams = (def: OpDef | undefined, raw: Record<string, string>): Record<string, unknown> => {
  const specs = def?.params ?? [];
  const out: Record<string, unknown> = {};
  for (const spec of specs) {
    const v = raw[spec.name];
    if (v === undefined || v === null || v === "") {
      if (spec.defaultValue !== undefined && spec.defaultValue !== "") {
        out[spec.name] = spec.kind === "int" ? parseInt(spec.defaultValue, 10)
          : spec.kind === "float" ? parseFloat(spec.defaultValue)
          : spec.defaultValue;
      }
      continue;
    }
    if (spec.kind === "int") {
      const n = parseInt(v, 10);
      out[spec.name] = Number.isFinite(n) ? n : 0;
    } else if (spec.kind === "float") {
      const n = parseFloat(v);
      out[spec.name] = Number.isFinite(n) ? n : 0;
    } else {
      out[spec.name] = v;
    }
  }
  return out;
};

/** Returns error message if op is invalid, else null. */
const validateOp = (def: OpDef | undefined, op: PendingOp): string | null => {
  if (!def) return "Unknown operation";
  if (def.needsColumn && !op.column) return `${def.label}: choose a column`;
  for (const spec of def.params ?? []) {
    if (!spec.required) continue;
    const v = op.params[spec.name] ?? spec.defaultValue ?? "";
    if (v === "") return `${def.label}: ${spec.name} is required`;
    if (spec.kind === "int" || spec.kind === "float") {
      const n = spec.kind === "int" ? parseInt(v, 10) : parseFloat(v);
      if (!Number.isFinite(n)) return `${def.label}: ${spec.name} must be numeric`;
      if (spec.min !== undefined && n < spec.min) return `${def.label}: ${spec.name} ≥ ${spec.min}`;
      if (spec.max !== undefined && n > spec.max) return `${def.label}: ${spec.name} ≤ ${spec.max}`;
    }
  }
  return null;
};

const CATEGORY_COLORS: Record<string, string> = {
  validation: "bg-pink-500/10 text-pink-600 border-pink-500/30",
  normalization: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  transformation: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  cleaning: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  extraction: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  encoding: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30",
  deduplication: "bg-orange-500/10 text-orange-600 border-orange-500/30",
};

interface PendingOp {
  uid: string;
  opId: string;
  column: string;
  params: Record<string, string>;
}

const SemanticOpsBuilder = ({ datasetId }: { datasetId: string | null }) => {
  const [ops, setOps] = useState<PendingOp[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [applying, setApplying] = useState(false);
  const [previewResult, setPreviewResult] = useState<PreviewResponse | null>(null);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const queryClient = useQueryClient();

  const { data: schemaData } = useQuery({
    queryKey: ["dataset-preview", datasetId],
    queryFn: () => apiFetch<any>(`/datasets/${datasetId}/preview`),
    enabled: !!datasetId,
  });

  const columns = useMemo(() => {
    const cols = schemaData?.columns ?? [];
    return cols.map((c: any) => c.name || c);
  }, [schemaData]);

  const addOp = useCallback((opId: string) => {
    const uid = `op_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const def = SEMANTIC_OPS.find(d => d.id === opId);
    const params: Record<string, string> = {};
    for (const spec of def?.params ?? []) {
      if (spec.defaultValue !== undefined) params[spec.name] = spec.defaultValue;
    }
    setOps(prev => [...prev, { uid, opId, column: columns[0] || "", params }]);
  }, [columns]);

  const removeOp = useCallback((uid: string) => {
    setOps(prev => prev.filter(o => o.uid !== uid));
  }, []);

  const updateOp = useCallback((uid: string, field: string, value: string) => {
    setOps(prev => prev.map(o => {
      if (o.uid !== uid) return o;
      if (field === "column") return { ...o, column: value };
      return { ...o, params: { ...o.params, [field]: value } };
    }));
  }, []);

  const buildOperationsPayload = (): { ok: true; ops: any[] } | { ok: false; error: string } => {
    const payload: any[] = [];
    for (const o of ops) {
      const def = SEMANTIC_OPS.find(d => d.id === o.opId);
      const err = validateOp(def, o);
      if (err) return { ok: false, error: err };
      payload.push({
        op: o.opId,
        column: o.column || null,
        params: coerceParams(def, o.params),
      });
    }
    return { ok: true, ops: payload };
  };

  const runSemanticPreview = async () => {
    if (!datasetId || ops.length === 0) return;
    const built = buildOperationsPayload();
    if (!built.ok) { toast.error(built.error); return; }
    setApplying(true);
    try {
      const result = await apiFetch<PreviewResponse>(
        `/cleaning/preview/${datasetId}`,
        { method: "POST", body: JSON.stringify({ operations: built.ops }) }
      );
      setPreviewResult(result);
      setShowPreviewDialog(true);
    } catch (err) {
      toast.error((err as Error).message || "Preview failed");
    } finally {
      setApplying(false);
    }
  };

  const runSemanticApply = async () => {
    if (!datasetId || ops.length === 0) return;
    const built = buildOperationsPayload();
    if (!built.ok) { toast.error(built.error); return; }
    setApplying(true);
    try {
      const result = await apiFetch<ApplyResponse>(
        `/cleaning/apply/${datasetId}`,
        { method: "POST", body: JSON.stringify({ operations: built.ops }) }
      );
      toast.success(`Semantic cleaning applied: ${result.name}`);
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      setOps([]);
      setPreviewResult(null);
      setShowPreviewDialog(false);
    } catch (err) {
      toast.error((err as Error).message || "Apply failed");
    } finally {
      setApplying(false);
    }
  };

  const categories = useMemo(() => {
    const set = new Set(SEMANTIC_OPS.map(o => o.category));
    return ["all", ...Array.from(set)];
  }, []);

  const filteredOps = categoryFilter === "all" ? SEMANTIC_OPS : SEMANTIC_OPS.filter(o => o.category === categoryFilter);

  if (!datasetId) return null;

  const datasetColCount = Array.isArray(columns) ? columns.length : 0;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            Semantic Cleaning Operations
          </h3>
          {datasetId && (
            <Badge variant="outline" className="text-[10px] font-mono">
              <Database className="h-3 w-3 mr-1" /> {datasetColCount} columns
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-surface border border-border">
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={cn(
                "px-2 py-1 rounded-md text-[10px] font-medium transition-colors capitalize",
                categoryFilter === c ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Operation palette */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2 mb-5">
        {filteredOps.map(op => (
          <motion.button
            key={op.id}
            onClick={() => addOp(op.id)}
            className="group rounded-lg border border-border bg-card p-3 text-left hover:border-accent/40 hover:bg-accent/5 transition-all"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="flex items-center gap-2 mb-1">
              <op.icon className="h-3.5 w-3.5 text-accent" />
              <span className="text-[11px] font-medium text-foreground truncate">{op.label}</span>
            </div>
            <p className="text-[9px] text-muted-foreground leading-tight truncate">{op.desc}</p>
            <Badge variant="outline" className={cn("text-[8px] mt-1.5 capitalize", CATEGORY_COLORS[op.category] || "")}>
              {op.category}
            </Badge>
          </motion.button>
        ))}
      </div>

      {/* Queued operations */}
      {ops.length > 0 && (
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Queued Operations ({ops.length})
            </span>
            <Button variant="ghost" size="sm" onClick={() => setOps([])}>
              <X className="h-3 w-3" /> Clear all
            </Button>
          </div>
          <AnimatePresence>
            {ops.map((op, i) => {
              const def = SEMANTIC_OPS.find(d => d.id === op.opId);
              if (!def) return null;
              return (
                <motion.div
                  key={op.uid}
                  initial={{ opacity: 0, y: -8, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, x: 20, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface/30"
                >
                  <span className="text-[10px] font-mono text-muted-foreground w-5 text-center">{i + 1}</span>
                  <def.icon className="h-4 w-4 text-accent shrink-0" />
                  <span className="text-[12px] font-medium text-foreground shrink-0">{def.label}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />

                  <Select value={op.column} onValueChange={v => updateOp(op.uid, "column", v)}>
                    <SelectTrigger className="w-[160px] h-7 text-[11px]">
                      <SelectValue placeholder="Column" />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((c: string) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {(def.params ?? []).map(spec => {
                    const val = op.params[spec.name] ?? "";
                    if (spec.kind === "enum") {
                      return (
                        <Select
                          key={spec.name}
                          value={val}
                          onValueChange={(v) => updateOp(op.uid, spec.name, v)}
                        >
                          <SelectTrigger className="w-[130px] h-7 text-[11px]">
                            <SelectValue placeholder={spec.name} />
                          </SelectTrigger>
                          <SelectContent>
                            {(spec.options ?? []).map((o) => (
                              <SelectItem key={o} value={o} className="text-[11px]">{o}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    }
                    const isNum = spec.kind === "int" || spec.kind === "float";
                    return (
                      <Input
                        key={spec.name}
                        placeholder={spec.placeholder ?? spec.name}
                        value={val}
                        type={isNum ? "number" : "text"}
                        inputMode={isNum ? "decimal" : "text"}
                        step={spec.step ?? (spec.kind === "float" ? 0.01 : 1)}
                        min={spec.min}
                        max={spec.max}
                        onChange={e => updateOp(op.uid, spec.name, e.target.value)}
                        className={cn("h-7 text-[11px]", isNum ? "w-[90px]" : "w-[130px]")}
                      />
                    );
                  })}

                  <div className="flex-1" />
                  <button
                    onClick={() => removeOp(op.uid)}
                    className="h-6 w-6 rounded flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Action buttons */}
      {ops.length > 0 && (
        <div className="flex items-center gap-3 pt-3 border-t border-border">
          <div className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{ops.length}</span> semantic operation{ops.length !== 1 ? "s" : ""} queued
          </div>
          <div className="flex-1" />
          <Button variant="outline" onClick={runSemanticPreview} disabled={applying}>
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            Preview
          </Button>
          <Button onClick={runSemanticApply} disabled={applying}>
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Apply Semantic Cleaning
          </Button>
        </div>
      )}

      {/* Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-accent" /> Semantic Cleaning Preview
            </DialogTitle>
            <DialogDescription>
              Preview of {ops.length} semantic operation{ops.length !== 1 ? "s" : ""}.
            </DialogDescription>
          </DialogHeader>
          {previewResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <MiniStat label="Rows" value={previewResult.rows_before || 0} after={previewResult.rows_after || 0} />
                <MiniStat label="Columns" value={(previewResult.columns_before || []).length} after={(previewResult.columns_after || []).length} />
                <MiniStat label="Cells modified" value={0} after={previewResult.cells_modified || 0} highlight />
                <MiniStat label="Cols dropped" value={0} after={(previewResult.columns_dropped || []).length} highlight />
              </div>
              {previewResult.steps && previewResult.steps.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">Step Results</div>
                  <div className="space-y-1">
                    {previewResult.steps.map((step, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs p-2 rounded bg-surface/40">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", step.status === "applied" ? "bg-success" : "bg-destructive")} />
                        <span className="font-medium">{step.op}</span>
                        {step.column && <span className="text-muted-foreground">→ {step.column}</span>}
                        <span className="text-muted-foreground font-mono">{step.cells_modified ?? 0} cells</span>
                        {step.error && <span className="text-destructive text-[10px]">{step.error}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowPreviewDialog(false)}>Close</Button>
                <Button onClick={runSemanticApply} disabled={applying}>
                  {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Apply & Save
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Small helper components
// ---------------------------------------------------------------------------

const SummaryPill = ({
  label,
  value,
  severity,
}: {
  label: string;
  value: number;
  severity: "critical" | "warning" | "info";
}) => (
  <div className="flex items-center gap-2">
    <Badge
      variant="outline"
      className={cn("text-[11px] font-semibold", severityStyle[severity].badge)}
    >
      {value}
    </Badge>
    <span className="text-xs text-muted-foreground uppercase tracking-wide">
      {label}
    </span>
  </div>
);

const MiniStat = ({
  label,
  value,
  after,
  highlight = false,
}: {
  label: string;
  value: number;
  after: number;
  highlight?: boolean;
}) => {
  const safeValue = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const safeAfter = typeof after === "number" && Number.isFinite(after) ? after : 0;
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        {!highlight && (
          <>
            <span className="text-xs text-muted-foreground">{safeValue.toLocaleString()}</span>
            <span className="text-xs text-muted-foreground">→</span>
          </>
        )}
        <span
          className={cn(
            "font-semibold",
            highlight ? "text-accent text-lg" : "text-foreground"
          )}
        >
          {safeAfter.toLocaleString()}
        </span>
      </div>
    </div>
  );
};

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(3);
  if (typeof value === "object") return JSON.stringify(value);
  const s = String(value);
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

export default DataCleaning;
