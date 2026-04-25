import { Plus, MessageSquareText, Workflow, Trash2, History, PanelLeftClose, PanelLeftOpen, Search, X, Check } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useQueryStore } from "@/store/useQueryStore";
import type { QueryMode } from "@/lib/query-api";

interface QueryHistoryProps {
  open: boolean;
  onToggle: () => void;
  onNew: (mode: QueryMode) => void;
}

// Safe formatRelative
const formatRelative = (ts: any) => {
  const timestamp = Number(ts);
  if (isNaN(timestamp) || timestamp <= 0) return "—";
  const diff = Date.now() - timestamp;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export const QueryHistory = ({ open, onToggle, onNew }: QueryHistoryProps) => {
  const { conversations = [], activeId, selectConversation, deleteConversation, mode } = useQueryStore();
  const [q, setQ] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const list = Array.isArray(conversations) ? conversations.filter((c) =>
      c && (c.title || "").toLowerCase().includes(q.toLowerCase())
    ) : [];
    const sorted = [...list].sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    return sorted;
  }, [conversations, q]);

  return (
    <aside
      className={cn(
        "relative shrink-0 border-r border-border bg-sidebar/60 backdrop-blur-sm",
        "transition-[width] duration-300 ease-out overflow-hidden",
        open ? "w-64" : "w-0 sm:w-12",
      )}
    >
      {/* Collapsed rail */}
      {!open && (
        <div className="hidden sm:flex flex-col items-center gap-1.5 py-3">
          <button
            onClick={onToggle}
            className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
            aria-label="Open history"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
          <button
            onClick={() => onNew(mode)}
            className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
            aria-label="New conversation"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Expanded panel */}
      <div
        className={cn(
          "flex flex-col h-full w-64 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        <header className="flex items-center justify-between px-3 h-11 border-b border-border">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <History className="h-3.5 w-3.5" />
            <span>History</span>
          </div>
          <button
            onClick={onToggle}
            className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
            aria-label="Collapse history"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </header>

        <div className="p-2.5 space-y-2 border-b border-border">
          <button
            onClick={() => onNew(mode)}
            className="w-full inline-flex items-center justify-center gap-1.5 h-8 rounded-md bg-accent text-accent-foreground text-xs font-medium hover:bg-accent/90 active:scale-[0.98] transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            New conversation
          </button>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="w-full h-7 rounded-md bg-background border border-border pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>
        </div>

        <ol className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {filtered.length === 0 ? (
            <li className="px-2 py-6 text-center text-[11px] text-muted-foreground">
              No conversations
            </li>
          ) : (
            filtered.map((c, i) => {
              const Icon = c.mode === "chat" ? MessageSquareText : Workflow;
              const active = c.id === activeId;
              return (
                <li
                  key={c.id}
                  className="group animate-fade-in-up"
                  style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                >
                  <div
                    className={cn(
                      "relative flex items-start gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60",
                    )}
                    onClick={() => selectConversation(c.id)}
                  >
                    <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", active ? "text-accent" : "text-muted-foreground")} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{c.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {formatRelative(c.updatedAt)} · {c.mode}
                      </p>
                    </div>
                    {confirmDeleteId === c.id ? (
                      <div className="flex items-center gap-1 ml-2 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteConversation(c.id);
                            setConfirmDeleteId(null);
                          }}
                          className="h-6 w-6 rounded flex items-center justify-center text-destructive hover:bg-destructive/20 transition-colors"
                          aria-label="Confirm delete"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(null);
                          }}
                          className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
                          aria-label="Cancel delete"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(c.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0 ml-2"
                        aria-label="Delete conversation"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })
          )}
        </ol>
      </div>
    </aside>
  );
};
