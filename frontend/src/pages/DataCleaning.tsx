import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiFetch } from "@/lib/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dataset } from "@/lib/types";
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
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold block mb-1.5">
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
              <X className="h-3.5 w-3.5" /> Clear
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
                uploads.
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
                    <Badge variant="outline" className={cn("text-[10px]", style.badge)}>
                      {style.label}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        semanticColor[s.semantic_type] ?? "bg-muted"
                      )}
                    >
                      {s.semantic_type}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {s.category}
                    </Badge>
                    {s.auto_safe && (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
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
      </div>
    </AppShell>
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
