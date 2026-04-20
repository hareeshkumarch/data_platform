import { AppShell } from "@/components/layout/AppShell";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp, Bot, UserRound, CheckCircle2, Loader2,
  MessageSquareText, Workflow, Sparkles, Paperclip, History,
  Database, MousePointerClick, BarChart3,
} from "lucide-react";
import { ChartViewer } from "@/components/charts/ChartViewer";
import { QueryHistory } from "@/components/query/QueryHistory";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { useQueryStore } from "@/store/useQueryStore";
import {
  type PipelineStage, type QueryMessage, type QueryMode,
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

const Query = () => {
  const {
    conversations, activeId, mode,
    setMode, newConversation, appendMessage, updateLastMessage, renameFromFirstMessage,
  } = useQueryStore();
  const activeDatasetId = useAppStore((s) => s.dataset);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  const [historyOpen, setHistoryOpen] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages.length, active?.id]);

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
    const prompt = input.trim();
    if (!prompt || sending) return;
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
        (text) =>
          streamChatReply(text, activeDatasetId, (partial, done) => {
            updateLastMessage(convId, { content: partial, streaming: !done });
            if (done) setSending(false);
          }),
      );
    }
  };

  const messages = active?.messages.filter((m) => m.mode === mode) ?? [];

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
                  <History className="h-4 w-4" />
                </button>
              )}
              <ModeSwitcher mode={mode} onChange={setMode} />
            </div>
          </div>

          {/* Conversation */}
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[760px] px-3 sm:px-5 py-5 sm:py-8 space-y-5 sm:space-y-7">
              {messages.length === 0 ? (
                <EmptyState mode={mode} onPick={setInput} />
              ) : (
                messages.map((m) => <MessageBlock key={m.id} message={m} />)
              )}
              <div ref={endRef} />
            </div>
          </div>

          {/* Composer */}
          <div className="border-t border-border bg-background/85 backdrop-blur">
            <div className="mx-auto w-full max-w-[760px] px-3 sm:px-5 py-2.5 sm:py-3.5">
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
                  placeholder={mode === "chat" ? "Ask anything…" : "Run a multi-agent task…"}
                  className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[15px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none max-h-[200px]"
                />
                <div className="flex items-center justify-between px-1.5 pb-1.5">
                  <div className="flex items-center gap-1">
                    <ComposerChip icon={Paperclip} label="Attach" disabled title="Coming soon" />
                    <ComposerChip
                      icon={mode === "chat" ? MessageSquareText : Workflow}
                      label={mode === "chat" ? "Chat" : "Pipeline"}
                      active
                    />
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

const EmptyState = ({ mode, onPick }: { mode: QueryMode; onPick: (q: string) => void }) => {
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

      {/* Guided Onboarding Steps */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <div className="card-soft p-5 text-center relative overflow-hidden group hover:border-accent/30 transition-colors">
          <div className="mx-auto h-10 w-10 rounded-full bg-surface border border-border flex items-center justify-center mb-3 group-hover:bg-accent-soft group-hover:text-accent transition-colors">
            <Database className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-semibold mb-1 text-foreground">1. Upload Data</h3>
          <p className="text-[11px] text-muted-foreground mb-4">Add CSV, JSON or Parquet files</p>
          <button 
            onClick={() => (window.location.href = "/data")}
            className="w-full h-8 rounded-lg border border-border bg-surface text-[11px] font-medium hover:bg-muted transition-colors"
          >
            Go to Sources
          </button>
        </div>

        <div className="card-soft p-5 text-center relative overflow-hidden group border-accent/20 bg-accent/5 hover:border-accent/40 transition-colors">
          <div className="mx-auto h-10 w-10 rounded-full bg-accent-soft text-accent flex items-center justify-center mb-3 group-hover:bg-accent group-hover:text-accent-foreground transition-colors">
            <Sparkles className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-semibold mb-1 text-foreground">2. Try Demo</h3>
          <p className="text-[11px] text-muted-foreground mb-4">Load sample sales intelligence data</p>
          <button 
            onClick={async () => {
              try {
                const { apiFetch } = await import("@/lib/api-client");
                const resp = await apiFetch("/datasets/seed-demo", { method: "POST" });
                if (resp.dataset_id) {
                  alert("Demo dataset ingestion started! It will appear in the dropdown shortly.");
                }
              } catch (err) {
                console.error("Failed to seed demo", err);
              }
            }}
            className="w-full h-8 rounded-lg bg-accent text-accent-foreground shadow-sm text-[11px] font-medium hover:bg-accent/90 transition-colors"
          >
            Generate Demo
          </button>
        </div>

        <div className="card-soft p-5 text-center relative overflow-hidden group hover:border-accent/30 transition-colors hidden sm:block">
          <div className="mx-auto h-10 w-10 rounded-full bg-surface border border-border flex items-center justify-center mb-3 group-hover:bg-accent-soft group-hover:text-accent transition-colors">
            <MousePointerClick className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-semibold mb-1 text-foreground">3. Ask Questions</h3>
          <p className="text-[11px] text-muted-foreground mb-4">"Show sales trends by region"</p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {["Sales Q4", "Profit vs Cost"].map(t => (
              <span key={t} className="px-2 py-0.5 rounded-full bg-muted text-[9px] font-medium text-muted-foreground">{t}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground text-center mb-4">Suggested Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-2">
          {SUGGESTIONS[mode].map((s, i) => (
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
  const allDone = stages.every((s) => s.status === "done");
  const running = stages.find((s) => s.status === "running");
  const completed = stages.filter((s) => s.status === "done").length;
  const progress = (completed / stages.length) * 100;

  return (
    <div className="card-soft p-3 sm:p-4 animate-scale-in">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn(
            "h-7 w-7 rounded-md flex items-center justify-center shrink-0 transition-colors",
            allDone ? "bg-success/15 text-success" : "bg-accent-soft text-accent",
          )}>
            {allDone ? <CheckCircle2 className="h-4 w-4" /> : <Workflow className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">Agent Pipeline</p>
            <p className="text-[11px] text-muted-foreground truncate">
              {allDone
                ? `Completed in ${(stages.length * 0.7).toFixed(1)}s`
                : running ? `Running ${running.name}…` : "Initializing…"}
            </p>
          </div>
        </div>
        <span className="text-[11px] font-mono text-muted-foreground tabular-nums shrink-0">
          {completed}/{stages.length}
        </span>
      </div>

      <div className="h-1 rounded-full bg-border overflow-hidden mb-3">
        <div className="h-full bg-gradient-accent transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
      </div>

      <ol className="relative grid grid-cols-1 sm:grid-cols-4 gap-2 sm:gap-1.5 pt-2">
        {/* Connecting line background for desktop */}
        <div className="absolute top-[22px] left-8 w-[calc(100%-64px)] h-px bg-border hidden sm:block z-0" />
        
        {stages.map((stage) => {
          const Icon = stage.icon;
          return (
            <li
              key={stage.id}
              className={cn(
                "relative z-10 flex sm:flex-col items-center sm:items-start gap-3 sm:gap-2 p-2 rounded-xl transition-all duration-300",
                stage.status === "running" && "bg-accent-soft/40 shadow-sm sm:scale-105"
              )}
            >
              <div className={cn(
                "h-8 w-8 rounded-lg outline outline-4 outline-card bg-card flex items-center justify-center shrink-0 transition-all duration-300",
                stage.status === "done" && "bg-success/15 text-success",
                stage.status === "running" && "bg-accent text-accent-foreground shadow-glow animate-pulse-soft",
                stage.status === "pending" && "border border-border text-muted-foreground/40"
              )}>
                {stage.status === "done" ? <CheckCircle2 className="h-4 w-4" />
                  : stage.status === "running" ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Icon className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0 sm:w-full mt-1 sm:ml-1">
                <p className={cn(
                  "text-[12px] font-semibold leading-tight truncate",
                  stage.status === "pending" ? "text-muted-foreground/50" : "text-foreground"
                )}>
                  {stage.name}
                </p>
                <p className={cn(
                  "text-[11px] mt-0.5 sm:mt-1 pr-1 w-full line-clamp-2",
                  stage.status === "running" ? "text-accent font-medium animate-pulse" : "text-muted-foreground"
                )}>
                  {stage.status === "done" ? stage.detail : stage.log}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
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
      <div className={cn("flex-1 min-w-0 space-y-3", isUser && "text-right")}>
        {!isUser && message.pipeline && <AgenticPipeline stages={message.pipeline} />}

        {(isUser || message.content || message.streaming) && (
          <div className={cn(
            "inline-block max-w-full text-left",
            isUser
              ? "bg-card border border-border rounded-2xl rounded-tr-md px-3.5 py-2 text-sm text-foreground shadow-soft"
              : "text-[14.5px] text-foreground leading-relaxed",
          )}>
            {message.content.split("\n").map((line, i) => (
              <p key={i} className={cn("whitespace-pre-wrap", i > 0 && "mt-2")}>
                {line.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
                  part.startsWith("**") ? (
                    <strong key={j} className="font-semibold text-foreground">
                      {part.slice(2, -2)}
                    </strong>
                  ) : (
                    <span key={j}>{part}</span>
                  ),
                )}
              </p>
            ))}
            {message.streaming && (
              <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-accent animate-blink rounded-sm" />
            )}
          </div>
        )}

        {!isUser && message.datasetId && !message.streaming && (
          <ChartViewer defaultDatasetId={message.datasetId} />
        )}
      </div>
    </div>
  );
};

export default Query;
