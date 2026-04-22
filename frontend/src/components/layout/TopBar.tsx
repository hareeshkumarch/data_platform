import { useState, useEffect, useMemo } from "react";
import { Search, ChevronDown, Moon, Sun, Database } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAppStore, AppStatus } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Breadcrumbs } from "./Breadcrumbs";
import { useDatasetStore } from "@/store/useDatasetStore";

interface TopBarProps {
  title?: string;
  subtitle?: string;
  status?: AppStatus;
}

const statusMap: Record<AppStatus, { label: string; color: string }> = {
  ready:      { label: "Ready",      color: "text-success" },
  processing: { label: "Processing", color: "text-warning" },
  error:      { label: "Error",      color: "text-destructive" },
};

export const TopBar = ({
  title = "Insights",
  subtitle,
  status,
}: TopBarProps) => {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const dataset = useAppStore((s) => s.dataset);
  const setDataset = useAppStore((s) => s.setDataset);
  const storeStatus = useAppStore((s) => s.status);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);

  const datasets = useDatasetStore((s) => s.datasets);
  const fetchSharedDatasets = useDatasetStore((s) => s.fetchDatasets);

  // Resolve the UUID to a human-readable name
  const displayName = useMemo(() => {
    if (!dataset || dataset === "Select dataset") return "Select dataset";
    const found = Array.isArray(datasets) ? datasets.find((d) => d && (d.id || d.dataset_id) === dataset) : null;
    const name = found?.name || found?.filename || (typeof dataset === "string" ? dataset.slice(0, 8) + "…" : "Dataset");
    return name;
  }, [dataset, datasets]);

  useEffect(() => {
    const load = async () => {
      try {
        const list = await fetchSharedDatasets();
        // Validate persisted dataset ID
        if (dataset && dataset !== "Select dataset") {
          const exists = list.some((d: any) => (d.id || d.dataset_id) === dataset);
          if (!exists) {
            setDataset(list.length > 0 ? (list[0].id || list[0].dataset_id) : "Select dataset");
          }
        }
      } catch {
        /* silently ignore */
      }
    };
    load();
    // Re-fetch every 10s so newly ingested datasets appear automatically
    const interval = setInterval(() => { void fetchSharedDatasets(); }, 10_000);
    return () => clearInterval(interval);
  }, []);

  const effectiveStatus = status ?? storeStatus;
  const s = statusMap[effectiveStatus];

  return (
    <header className="h-14 shrink-0 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-30 animate-fade-in-down">
      <div className="h-full flex items-center gap-2 sm:gap-4 px-3 sm:px-6">
        <SidebarTrigger className="h-9 w-9 hover:bg-surface transition-transform duration-200 hover:scale-105" />

        <div className="hidden lg:block min-w-0 max-w-[220px] animate-fade-in-down">
          <h1 className="text-sm font-semibold text-foreground leading-tight truncate">
            {title}
          </h1>
          {subtitle ? (
            <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
          ) : (
            <Breadcrumbs className="mt-0.5" />
          )}
        </div>

        <div className="h-6 w-px bg-border hidden lg:block" />

        {/* Grouped Search and Dataset */}
        <div className="flex-1 min-w-0 max-w-2xl flex items-center h-9 rounded-md bg-surface border border-border focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/15 transition-all duration-200">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="hidden lg:flex items-center gap-2 h-full px-3 border-r border-border text-xs text-foreground hover:bg-muted/50 transition-colors shrink-0 outline-none">
                <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-soft" />
                <span className="font-mono truncate max-w-[140px]">{displayName}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 bg-surface border-border shadow-soft">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Select Dataset</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-border" />
              {(Array.isArray(datasets) && datasets.length === 0) ? (
                <div className="px-2 py-4 text-center text-[11px] text-muted-foreground italic">
                  No datasets found. Upload one to begin.
                </div>
              ) : Array.isArray(datasets) && (
                datasets.map((d) => (
                  <DropdownMenuItem
                    key={d ? (d.id || d.dataset_id) : Math.random()}
                    onClick={() => d && setDataset(d.id || d.dataset_id)}
                    className="flex flex-col items-start gap-1 py-2 px-3 focus:bg-accent-soft cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2 w-full">
                      <Database className="h-3.5 w-3.5 text-accent" />
                      <span className="text-xs font-medium truncate">{d?.name || d?.filename || d?.id}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono opacity-60">ID: {d?.id || d?.dataset_id}</span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          
          <div className="relative flex-1 h-full group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-accent" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ask anything…"
              aria-label="Search or ask a question"
              className="w-full h-full pl-10 pr-14 sm:pr-20 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-1 px-1.5 h-5 rounded border border-border bg-card text-[10px] font-mono text-muted-foreground">
              ⌘K
            </kbd>
          </div>
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="h-9 w-9 rounded-md border border-border bg-surface flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-accent/40 transition-all duration-200 hover:scale-105"
        >
          <span key={theme} className="animate-pop-in">
            {theme === "light" ? (
              <Moon className="h-4 w-4" />
            ) : (
              <Sun className="h-4 w-4" />
            )}
          </span>
        </button>

        {/* Status badge */}
        <div className="flex items-center gap-2 h-9 px-2">
          <span className={cn("relative flex h-2 w-2", s.color)}>
            <span
              className={cn(
                "absolute inset-0 rounded-full bg-current",
                effectiveStatus === "processing" && "animate-ping opacity-60"
              )}
            />
            <span className="relative inline-block h-2 w-2 rounded-full bg-current" />
          </span>
          <span className="text-[11px] font-semibold tracking-wider text-muted-foreground hidden sm:inline uppercase">
            {s.label}
          </span>
        </div>
      </div>
    </header>
  );
};
