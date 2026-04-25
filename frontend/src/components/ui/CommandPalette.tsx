import { useEffect, useState, useMemo } from "react";
import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import {
  Search, Database, LineChart, FileText, FileBarChart, Settings,
  Sparkles, Wand2, X, MessageSquareText, Trash2,
} from "lucide-react";
import { useDatasetStore } from "@/store/useDatasetStore";
import { useQueryStore } from "@/store/useQueryStore";
import { useAppStore } from "@/store/useAppStore";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const datasets = useDatasetStore((s) => s.datasets);
  const { conversations = [], setActiveId } = useQueryStore();
  const setDataset = useAppStore((s) => s.setDataset);

  // Toggle the menu when ⌘K is pressed
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const runCommand = (command: () => void) => {
    setOpen(false);
    command();
  };

  // Sorted conversations (newest first)
  const recentConversations = useMemo(
    () =>
      [...(Array.isArray(conversations) ? conversations : [])]
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, 8),
    [conversations],
  );

  if (!open) return null;

  const itemClass =
    "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="fixed inset-0"
        onClick={() => setOpen(false)}
        aria-label="Close command palette"
      />
      <Command
        className="relative z-50 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-2xl flex flex-col"
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <div className="flex items-center border-b border-border px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
          <Command.Input
            autoFocus
            className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Search datasets, conversations, or navigate…"
          />
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded-md hover:bg-surface text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <Command.List className="max-h-[400px] overflow-y-auto overflow-x-hidden p-2">
          <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
            No results found.
          </Command.Empty>

          {/* ── Navigation ── */}
          <Command.Group
            heading="Navigation"
            className="text-xs font-medium text-muted-foreground px-2 py-1.5 [&_[cmdk-group-items]]:mt-1 [&_[cmdk-group-items]]:space-y-0.5"
          >
            <Command.Item value="Go to Data Sources" onSelect={() => runCommand(() => navigate("/data"))} className={itemClass}>
              <Database className="mr-2 h-4 w-4" /> <span>Data Sources</span>
            </Command.Item>
            <Command.Item value="Go to Insights" onSelect={() => runCommand(() => navigate("/"))} className={itemClass}>
              <LineChart className="mr-2 h-4 w-4" /> <span>Insights & Analytics</span>
            </Command.Item>
            <Command.Item value="Clean Data — Data Cleaning" onSelect={() => runCommand(() => navigate("/cleaning"))} className={itemClass}>
              <Wand2 className="mr-2 h-4 w-4" /> <span>Data Cleaning</span>
            </Command.Item>
            <Command.Item value="Talk to AI Agent" onSelect={() => runCommand(() => navigate("/query"))} className={itemClass}>
              <Sparkles className="mr-2 h-4 w-4" /> <span>Ask Agent</span>
            </Command.Item>
            <Command.Item value="Go to Reports" onSelect={() => runCommand(() => navigate("/reports"))} className={itemClass}>
              <FileText className="mr-2 h-4 w-4" /> <span>Reports</span>
            </Command.Item>
            <Command.Item value="Global Settings" onSelect={() => runCommand(() => navigate("/settings"))} className={itemClass}>
              <Settings className="mr-2 h-4 w-4" /> <span>Settings</span>
            </Command.Item>
          </Command.Group>

          {/* ── Datasets ── */}
          {Array.isArray(datasets) && datasets.length > 0 && (
            <Command.Group
              heading="Datasets"
              className="text-xs font-medium text-muted-foreground px-2 py-1.5 [&_[cmdk-group-items]]:mt-1 [&_[cmdk-group-items]]:space-y-0.5"
            >
              {datasets.slice(0, 10).map((d) => {
                const did = d?.id || d?.dataset_id;
                const name = d?.filename || d?.name || did;
                return (
                  <Command.Item
                    key={did}
                    value={`Dataset ${name} ${did}`}
                    onSelect={() =>
                      runCommand(() => {
                        setDataset(did);
                        navigate("/");
                      })
                    }
                    className={itemClass}
                  >
                    <Database className="mr-2 h-4 w-4 text-accent" />
                    <div className="flex flex-col min-w-0">
                      <span className="truncate text-sm">{name}</span>
                      <span className="text-[10px] text-muted-foreground font-mono truncate">
                        {d?.row_count ? `${d.row_count} rows · ` : ""}
                        {d?.col_count ? `${d.col_count} cols` : ""}
                      </span>
                    </div>
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}

          {/* ── Recent Conversations ── */}
          {recentConversations.length > 0 && (
            <Command.Group
              heading="Recent Conversations"
              className="text-xs font-medium text-muted-foreground px-2 py-1.5 [&_[cmdk-group-items]]:mt-1 [&_[cmdk-group-items]]:space-y-0.5"
            >
              {recentConversations.map((conv) => (
                <Command.Item
                  key={conv.id}
                  value={`Conversation ${conv.title} ${conv.id}`}
                  onSelect={() =>
                    runCommand(() => {
                      setActiveId(conv.id);
                      navigate("/query");
                    })
                  }
                  className={itemClass}
                >
                  <MessageSquareText className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{conv.title || "Untitled"}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
