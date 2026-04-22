import { AppShell } from "@/components/layout/AppShell";
import { toast } from "sonner";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp, Bot, UserRound, CheckCircle2, Loader2,
  MessageSquareText, Workflow, Sparkles, Paperclip, History as HistoryIcon,
  Trash2, Copy, Send, Settings, MoreHorizontal, Database, Plus, RefreshCw, AlertTriangle,
  ChevronDown, BarChart3, LineChart, AreaChart, PieChart as PieChartIcon
} from "lucide-react";

import { ChartViewer } from "@/components/charts/ChartViewer";
import { DynamicChart, type ChartSpec } from "@/components/charts/DynamicChart";
import { MarkdownRenderer } from "@/components/ui/MarkdownRenderer";
import { QueryHistory } from "@/components/query/QueryHistory";
import { useQueryStore } from "@/store/useQueryStore";
import { useAppStore } from "@/store/useAppStore";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { cn } from "@/lib/utils";
import {
  type AgentSummary, type PipelineStage, type QueryMessage, type QueryMode,
  newPipeline, runPipeline, streamChatReply, uid,
} from "@/lib/query-api";

const SUGGESTIONS: Record<QueryMode, string[]> = {
  chat: [
    "Summarize Q4 revenue performance",
    "Which customer segment grew fastest?",
    "Explain the week-9 churn anomaly",
  ],
  pipeline: [
    "Run a full retention analysis on last quarter",
    "Build a forecast for Q1 with confidence bands",
    "Verify the revenue total against source rows",
  ],
};

/**
 * Backend now natively returns DynamicChart ChartSpec format.
 */

const Query = () => {
  const {
    conversations = [], activeId = null, mode = "chat",
    setMode, newConversation, appendMessage, updateLastMessage, renameFromFirstMessage,
    hydrateFromServer,
  } = useQueryStore();
  const activeDatasetId = useAppStore((s) => s.dataset);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);

  const active = useMemo(
    () => (Array.isArray(conversations) ? conversations.find((c) => c.id === activeId) : null) ?? null,
    [conversations, activeId],
  );



  const [historyOpen, setHistoryOpen] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Hydrate server-side conversations once on mount
  useEffect(() => {
    void hydrateFromServer();
  }, [hydrateFromServer]);

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [Array.isArray(active?.messages) ? active?.messages?.length : 0, active?.id]);

  // Auto-grow textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  // Collapse history on small screens by default
  useEffect(() => {
    if (window.matchMedia("(max-width: 768px)").matches) setHistoryOpen(false);
  }, []);

  const ensureConversation = (m: QueryMode) => active?.id ?? newConversation(m);

  const send = () => {
    let prompt = input.trim();
    if (mode === "pipeline" && !prompt) {
      prompt = "Run full exploratory data analysis pipeline";
    }
    if (!prompt || sending) return;
    if (!activeDatasetId || activeDatasetId === "Select dataset") {
      toast.error("Please load or select a dataset first from the Left Sidebar before running queries.");
      setSidebarOpen(true);
      return;
    }
    setSending(true);

    const convId = ensureConversation(mode);
    const userMsg: QueryMessage = { id: uid(), role: "user", content: prompt, mode };
    const reply: QueryMessage = mode === "chat"
      ? { id: uid(), role: "assistant", content: "", streaming: true, mode: "chat" }
      : {
          id: uid(), role: "assistant", content: "", streaming: true,
        mode: "pipeline", pipeline: newPipeline(), datasetId: activeDatasetId,
        };

    appendMessage(convId, userMsg);
    appendMessage(convId, reply);
    renameFromFirstMessage(convId, prompt);
    setInput("");

    if (mode === "chat") {
      streamChatReply(prompt, activeDatasetId, (partial, done) => {
        updateLastMessage(convId, { content: partial, streaming: !done });
        if (done) setSending(false);
      });
    } else {
      runPipeline(
        prompt,
        activeDatasetId,
        (stages: PipelineStage[]) => updateLastMessage(convId, { pipeline: stages }),
        (reply, dsId, charts, agentSummaries) => {
          updateLastMessage(convId, { 
            content: reply, 
            streaming: false,
            datasetId: dsId || activeDatasetId,
            charts: charts,
            agentSummaries: agentSummaries,
          });
          setSending(false);
        },
      );
    }
  };

  const messages = useMemo(() => {
    if (!active || !Array.isArray(active.messages)) return [];
    return active.messages.filter((m) => m && m.mode === mode);
  }, [active, mode, (Array.isArray(active?.messages) ? active?.messages?.length : 0)]);

  return (
    <AppShell title="Query" subtitle="Ask in plain English — get verifiable answers" status="ready">
      <div className="flex h-[calc(100vh-3.5rem)]">
        <QueryHistory
          open={historyOpen}
          onToggle={() => setHistoryOpen((v) => !v)}
          onNew={(m) => {
            newConversation(m);
            setInput("");
          }}
        />

        <div className="flex-1 flex flex-col min-w-0">
          {/* Mode switcher */}
          <div className="border-b border-border bg-background/80 backdrop-blur-md">
            <div className="mx-auto w-full max-w-[760px] px-3 sm:px-5 py-2.5 flex items-center gap-2">
              {!historyOpen && (
                <button
                  onClick={() => setHistoryOpen(true)}
                  className="sm:hidden h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-surface hover:text-foreground transition-colors"
                  aria-label="Open history"
                >
                  <HistoryIcon className="h-4 w-4" />
                </button>
              )}
              <ModeSwitcher mode={mode} onChange={setMode} />
            </div>
          </div>

          {/* Conversation */}
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[760px] px-3 sm:px-5 py-5 sm:py-8 space-y-5 sm:space-y-7">
              {(Array.isArray(messages) && messages.length === 0) ? (
                <EmptyState mode={mode} onPick={setInput} onSend={send} />
              ) : Array.isArray(messages) && (
                messages.filter(m => m && m.id).map((m) => <MessageBlock key={m.id} message={m} />)
              )}
              <div ref={endRef} />
            </div>
          </div>

          {/* Composer */}
          <div className="border-t border-border bg-background/85 backdrop-blur">
            <div className="mx-auto w-full max-w-[760px] px-3 sm:px-5 py-2.5 sm:py-3.5">
              {mode === "chat" ? (
                <div className="relative rounded-2xl bg-card border border-border shadow-soft transition-all focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/15">
                  <textarea
                    ref={taRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    rows={1}
                    placeholder="Ask anything…"
                    className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[15px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none max-h-[200px]"
                  />
                  <div className="flex items-center justify-between px-1.5 pb-1.5">
                    <div className="flex items-center gap-1">
                      <ComposerChip icon={Paperclip} label="Attach" disabled title="Coming soon" />
                      <ComposerChip icon={MessageSquareText} label="Chat" active />
                    </div>
                    <button
                      onClick={send}
                      disabled={!input.trim() || sending}
                      className={cn(
                        "h-8 w-8 rounded-lg flex items-center justify-center transition-all",
                        "bg-accent text-accent-foreground hover:bg-accent/90 active:scale-95",
                        "disabled:bg-muted disabled:text-muted-foreground/50 disabled:cursor-not-allowed",
                      )}
                      aria-label="Send"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : null}
              <p className="mt-1.5 text-[11px] text-muted-foreground text-center">
                System can make mistakes. Verify important results.
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
};

/* ---------------- Subcomponents ---------------- */

const ModeSwitcher = ({ mode, onChange }: { mode: QueryMode; onChange: (m: QueryMode) => void }) => {
  const tabs: { id: QueryMode; label: string; icon: typeof MessageSquareText }[] = [
    { id: "chat", label: "Normal chat", icon: MessageSquareText },
    { id: "pipeline", label: "Agent pipeline", icon: Workflow },
  ];
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-surface border border-border w-full sm:w-auto">
      {tabs.map((t) => {
        const active = mode === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              "relative flex-1 sm:flex-none inline-flex items-center justify-center gap-2 h-8 px-3 sm:px-4 rounded-lg text-xs sm:text-[13px] font-medium transition-all",
              active ? "text-accent-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && <span className="absolute inset-0 rounded-lg bg-accent shadow-soft animate-scale-in" />}
            <span className="relative inline-flex items-center gap-1.5">
              <t.icon className="h-3.5 w-3.5" />
              <span>{t.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
};

const EmptyState = ({ mode, onPick, onSend }: { mode: QueryMode; onPick: (q: string) => void; onSend?: () => void }) => {
  const Icon = mode === "chat" ? Sparkles : Workflow;
  return (
    <div className="py-4 sm:py-6 animate-fade-in-up w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent mb-5 animate-scale-in shadow-sm">
          <Icon className="h-6 w-6" />
        </div>
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          {mode === "chat" ? "What would you like to know?" : "Orchestrate your agents"}
        </h2>
        <p className="mt-2 text-[15px] text-muted-foreground max-w-lg mx-auto px-2">
          {mode === "chat"
            ? "Ask questions in plain English. Our system analyzes your datasets and generates verifiable insights."
            : "Define a goal, and coordinate specialized agents to clean, analyze, and visualize your data."}
        </p>
      </div>

      {/* Pipeline Action */}
      {mode === "pipeline" && (
        <div className="flex justify-center mb-10 w-full animate-fade-in">
          <button
            onClick={onSend}
            className="group relative h-16 sm:h-20 w-full max-w-sm rounded-2xl bg-gradient-to-br from-accent to-accent-foreground p-0.5 transition-all hover:scale-[1.02] active:scale-95 overflow-hidden shadow-md"
          >
            <div className="absolute inset-0 bg-white/20 opacity-0 transition-opacity group-hover:opacity-100 mix-blend-overlay" />
            <div className="flex h-full w-full items-center justify-center gap-3 sm:gap-4 rounded-[14px] bg-accent backface-hidden px-6 py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 shadow-inner">
                <Workflow className="h-5 w-5 text-white" />
              </div>
              <div className="flex flex-col text-left text-white leading-tight">
                <span className="text-base sm:text-lg font-bold tracking-tight shadow-sm">Start Intelligence Pipeline</span>
                <span className="text-xs font-medium text-white/80">Coordinate 6 AI agents to analyze data</span>
              </div>
            </div>
          </button>
        </div>
      )}

      {mode === "chat" && (
        <div className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground text-center mb-4">Suggested Actions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-2">
            {Array.isArray(SUGGESTIONS[mode] || SUGGESTIONS["chat"]) && (SUGGESTIONS[mode] || SUGGESTIONS["chat"]).map((s, i) => (
              <button
                key={s}
                onClick={() => onPick(s)}
                className="text-left px-4 py-3 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:border-accent/40 hover:bg-surface/50 hover-lift transition-all animate-fade-in-up flex items-center justify-between group"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <span className="truncate pr-4">{s}</span>
                <ArrowUp className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity rotate-45 sm:rotate-45" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const ComposerChip = ({
  icon: Icon, label, active, disabled, title,
}: { icon: typeof Paperclip; label: string; active?: boolean; disabled?: boolean; title?: string }) => (
  <button
    type="button"
    disabled={disabled}
    title={title}
    className={cn(
      "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors",
      active ? "bg-accent-soft text-accent" : "text-muted-foreground hover:bg-surface hover:text-foreground",
      disabled && "opacity-50 cursor-not-allowed",
    )}
  >
    <Icon className="h-3.5 w-3.5" />
    <span className="hidden sm:inline">{label}</span>
  </button>
);

const AgenticPipeline = ({ stages }: { stages: PipelineStage[] }) => {
  const safeStages = Array.isArray(stages) ? stages : [];
  const allDone = safeStages.length > 0 && safeStages.every((s) => s && s.status === "done");
  const running = safeStages.find((s) => s && s.status === "running");
  const completed = safeStages.filter((s) => s && s.status === "done").length;
  const progress = safeStages.length > 0 ? (completed / safeStages.length) * 100 : 0;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="card-soft animate-scale-in">
      {/* ── Compact header row (always visible) ── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface/30 rounded-xl transition-colors"
      >
        <div className={cn(
          "h-6 w-6 rounded-md flex items-center justify-center shrink-0 transition-colors",
          allDone ? "bg-success/15 text-success" : "bg-accent-soft text-accent",
        )}>
          {allDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Workflow className="h-3.5 w-3.5" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-foreground">Agent Pipeline</span>
            <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
              {completed}/{safeStages.length}
            </span>
            {allDone && (
              <span className="text-[10px] text-muted-foreground">· {(safeStages.length * 0.7).toFixed(1)}s</span>
            )}
          </div>
          {/* Inline progress bar */}
          <div className="h-1 mt-1 rounded-full bg-border overflow-hidden">
            <div className="h-full bg-gradient-accent transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Mini status dots */}
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          {safeStages.filter(s => s && s.id).map((s) => (
            <span
              key={s.id}
              title={s.name}
              className={cn(
                "h-2 w-2 rounded-full transition-colors",
                s.status === "done" && "bg-success",
                s.status === "running" && "bg-accent animate-pulse",
                s.status === "pending" && "bg-border",
              )}
            />
          ))}
        </div>

        <ChevronDown className={cn(
          "h-3.5 w-3.5 text-muted-foreground/60 shrink-0 transition-transform duration-200",
          expanded && "rotate-180",
        )} />
      </button>

      {/* ── Expanded detail grid ── */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 animate-fade-in">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {safeStages.filter(s => s && s.id).map((stage) => (
              <div
                key={stage.id}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors",
                  stage.status === "running" && "bg-accent-soft/40",
                )}
              >
                <span className={cn(
                  "h-2 w-2 rounded-full shrink-0",
                  stage.status === "done" && "bg-success",
                  stage.status === "running" && "bg-accent animate-pulse",
                  stage.status === "pending" && "bg-border",
                )} />
                <div className="min-w-0">
                  <p className={cn(
                    "text-[11px] font-medium leading-tight truncate",
                    stage.status === "pending" ? "text-muted-foreground/50" : "text-foreground",
                  )}>
                    {stage.name}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {stage.status === "done" ? stage.detail : stage.status === "running" ? stage.log : "Pending"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── Agent Insight Cards — compact rows ─── */
const STATUS_DOT: Record<string, string> = {
  success: "bg-success",
  error: "bg-destructive",
  skipped: "bg-muted-foreground/40",
};

const renderInlineMarkdown = (text: string) => {
  // Bold
  let parsed = text.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-foreground">$1</strong>');
  // Italic
  parsed = parsed.replace(/\*(.*?)\*/g, '<em class="italic">$1</em>');
  return parsed;
};

const AgentInsightCards = ({ summaries }: { summaries: AgentSummary[] }) => {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!Array.isArray(summaries) || summaries.length === 0) return null;
  
  const activeSummaries = summaries.filter(s => s && s.agentId && s.status !== "skipped");
  if (activeSummaries.length === 0) return null;

  return (
    <div className="mt-3 card-soft overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/60">
        <Workflow className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">Agent Summary</span>
        <span className="text-[10px] text-muted-foreground/60 ml-auto">
          {activeSummaries.filter(s => s.status === "success").length}/{activeSummaries.length} done
        </span>
      </div>
      {/* Rows */}
      <div className="divide-y divide-border/40">
        {activeSummaries.map((agent) => {
          const isOpen = expanded === agent.agentId;
          const hasDetails = Array.isArray(agent.details) && agent.details.length > 0;

          return (
            <div key={agent.agentId}>
              <button
                type="button"
                onClick={() => hasDetails && setExpanded(isOpen ? null : agent.agentId)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
                  hasDetails && "hover:bg-surface/40 cursor-pointer",
                  !hasDetails && "cursor-default",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", STATUS_DOT[agent.status] || STATUS_DOT.skipped)} />
                <span className="text-[11px] font-semibold text-foreground shrink-0">{agent.agentName}</span>
                <span className="text-[10px] text-muted-foreground truncate flex-1 mx-1">— {agent.headline}</span>
                {hasDetails && (
                  <ChevronDown className={cn(
                    "h-3 w-3 text-muted-foreground/40 shrink-0 transition-transform duration-200",
                    isOpen && "rotate-180",
                  )} />
                )}
              </button>
              {isOpen && hasDetails && (
                <div className="px-3 pb-2 pt-0.5 ml-5 pl-3 border-l-2 border-border/60 animate-fade-in space-y-1">
                  {agent.details.map((detail, i) => (
                    <div 
                      key={i} 
                      className="text-[11px] text-muted-foreground leading-relaxed font-sans"
                      dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(detail) }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ─── Chart type icon lookup ─── */
const CHART_TYPE_ICON: Record<string, typeof BarChart3> = {
  bar: BarChart3, histogram: BarChart3, waterfall: BarChart3, heatmap: BarChart3,
  line: LineChart, candlestick: LineChart,
  area: AreaChart, violin: AreaChart,
  pie: PieChartIcon, donut: PieChartIcon,
};

const TabbedChartViewer = ({ charts }: { charts: any[] }) => {
  const specs = useMemo(() => {
    if (!Array.isArray(charts)) return [];
    // Deduplicate by title + type to prevent "3 times" issue
    const unique = new Map();
    charts.filter(c => c).forEach(raw => {
      const spec = raw;
      // Case-insensitive key to catch "Pie" vs "PIE" duplicates
      const key = `${spec.chart}-${(spec.title || "").toLowerCase().trim()}`;
      if (!unique.has(key)) unique.set(key, spec);
    });
    return Array.from(unique.values());
  }, [charts]);
  const [activeIdx, setActiveIdx] = useState(0);

  if (specs.length === 0) return null;
  const activeSpec = specs[Math.min(activeIdx, specs.length - 1)];

  return (
    <div className="rounded-xl border border-border bg-card/60 backdrop-blur-sm overflow-hidden animate-fade-in">
      {/* Tab strip — only when there are 2+ charts */}
      {specs.length > 1 && (
        <div className="flex items-center gap-0.5 px-2 pt-2 pb-0 overflow-x-auto">
          {specs.map((spec, i) => {
            const Icon = CHART_TYPE_ICON[spec.chart] || BarChart3;
            const isActive = i === activeIdx;
            return (
              <button
                key={i}
                onClick={() => setActiveIdx(i)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-[11px] font-medium transition-colors shrink-0 border-b-2",
                  isActive
                    ? "border-accent text-foreground bg-surface/50"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-surface/30",
                )}
              >
                <Icon className="h-3 w-3" />
                <span className="truncate max-w-[120px]">{spec.title || `Chart ${i + 1}`}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Active chart content area */}
      <div className="px-2 pb-3 pt-1">
        <DynamicChart spec={{ ...activeSpec, showTitle: false }} />
      </div>
    </div>
  );
};

const MessageBlock = ({ message }: { message: QueryMessage }) => {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-2.5 sm:gap-3.5 animate-fade-in-up", isUser && "flex-row-reverse")}>
      <div className={cn(
        "h-7 w-7 sm:h-8 sm:w-8 shrink-0 rounded-lg flex items-center justify-center shadow-soft",
        isUser ? "bg-card border border-border" : "bg-gradient-accent",
      )}>
        {isUser
          ? <UserRound className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
          : <Bot className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary-foreground" />}
      </div>
      <div className={cn("flex-1 min-w-0 space-y-2", isUser && "text-right")}>
        {!isUser && message.pipeline && <AgenticPipeline stages={message.pipeline} />}

        {(isUser || message.content || message.streaming || (Array.isArray(message.rows) && message.rows.length > 0)) && (
          <div className={cn(
            "inline-block max-w-full text-left",
            isUser
              ? "bg-card border border-border rounded-2xl rounded-tr-md px-3.5 py-2 text-sm text-foreground shadow-soft"
              : "text-[14px] text-foreground leading-relaxed",
          )}>
            {message.content && (
              isUser ? (
                <span className="whitespace-pre-wrap">{message.content}</span>
              ) : (
                <MarkdownRenderer content={message.content} />
              )
            )}
            {Array.isArray(message.rows) && message.rows.length > 0 && (
              <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm text-left text-foreground">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      {message.rows[0] && Object.keys(message.rows[0] || {}).map((key) => (
                        <th key={key} className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-b border-border">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {message.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-muted/30 transition-colors">
                        {row && Object.values(row).map((val, j) => (
                          <td key={j} className="px-2.5 py-1 text-[12px] font-mono tabular-nums border-b border-border/50 whitespace-nowrap">
                            {String(val ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {message.streaming && (
              <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-accent animate-blink rounded-sm" />
            )}
          </div>
        )}

        {!isUser && Array.isArray(message.agentSummaries) && message.agentSummaries.length > 0 && !message.streaming && (
          <AgentInsightCards summaries={message.agentSummaries} />
        )}

        {!isUser && message.datasetId && !message.streaming && (
          <div>
            {Array.isArray(message.charts) && message.charts.length > 0 ? (
              <TabbedChartViewer charts={message.charts} />
            ) : (
              <ChartViewer defaultDatasetId={message.datasetId} />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Query;
