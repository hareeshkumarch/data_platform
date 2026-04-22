import { useState } from "react";
import { Link, Server, Globe, ChevronRight, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE, apiFetch, pollTask } from "@/lib/api-client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

type SourceType = "url" | "sql";

export const SourceConnect = ({ onComplete }: { onComplete: (id: string) => void }) => {
  const [type, setType] = useState<SourceType>("url");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // URL/API Form
  const [url, setUrl] = useState("");
  const [datasetName, setDatasetName] = useState("");

  // SQL Form
  const [connStr, setConnStr] = useState("");
  const [query, setQuery] = useState("");

  const handleConnect = async () => {
    if (loading) return;
    
    setLoading(true);
    setProgress(0);
    setStage("Starting...");

    if (type === "url") {
      if (!url) {
        setLoading(false);
        return toast.error("Please enter a URL");
      }
      const name = datasetName || url.split("/").pop() || "API Export";
      
      try {
        const resp = await apiFetch<{ dataset_id: string; task_id: string }>(
          "/upload-api",
          {
            method: "POST",
            body: JSON.stringify({
              url,
              dataset_name: name,
              method: "GET",
            }),
          }
        );
        const result = await pollTask<{ success: boolean; error?: string }>(
          resp.task_id,
          (p, s) => {
            setProgress(p);
            if (s) setStage(s);
          }
        );
        if (result && !result.success) throw new Error(result.error || "Connection failed");
        
        toast.success(`"${name}" connected successfully`);
        await queryClient.invalidateQueries({ queryKey: ["datasets"] });
        onComplete(resp.dataset_id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Connection failed");
      } finally {
        setLoading(false);
        setStage(null);
      }
    } else {
      if (!connStr || !query) {
        setLoading(false);
        return toast.error("Please enter connection string and query");
      }
      const name = datasetName || "SQL Result";
      
      try {
        const resp = await apiFetch<{ dataset_id: string; task_id: string }>(
          "/upload-sql",
          {
            method: "POST",
            body: JSON.stringify({
              connection_string: connStr,
              query: query,
              dataset_name: name,
            }),
          }
        );
        const result = await pollTask<{ success: boolean; error?: string }>(
          resp.task_id,
          (p, s) => {
            setProgress(p);
            if (s) setStage(s);
          }
        );
        if (result && !result.success) throw new Error(result.error || "SQL execution failed");
        
        toast.success(`"${name}" imported successfully`);
        await queryClient.invalidateQueries({ queryKey: ["datasets"] });
        onComplete(resp.dataset_id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "SQL Import failed");
      } finally {
        setLoading(false);
        setStage(null);
      }
    }
  };

  return (
    <div className="card-soft p-5 h-full flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-8 w-8 rounded-md bg-accent-soft text-accent flex items-center justify-center">
          <Globe className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">External Sources</h3>
          <p className="text-xs text-muted-foreground">Connect to URLs, APIs, or Databases.</p>
        </div>
      </div>

      <div className="flex bg-surface p-1 rounded-lg mb-4">
        <button
          disabled={loading}
          onClick={() => setType("url")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all",
            type === "url" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            loading && "opacity-50 cursor-not-allowed"
          )}
        >
          <Link className="h-3 w-3" /> URL / API
        </button>
        <button
          disabled={loading}
          onClick={() => setType("sql")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all",
            type === "sql" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            loading && "opacity-50 cursor-not-allowed"
          )}
        >
          <Server className="h-3 w-3" /> SQL DB
        </button>
      </div>

      <div className="space-y-3 flex-1">
        {type === "url" ? (
          <>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Source URL</label>
              <input
                disabled={loading}
                type="text"
                placeholder="https://example.com/data.csv"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent transition-all disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Dataset Name</label>
              <input
                disabled={loading}
                type="text"
                placeholder="Marketing Data Q4"
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent transition-all disabled:opacity-50"
              />
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Connection String</label>
              <input
                disabled={loading}
                type="text"
                placeholder="postgresql://user:pass@host:5432/db"
                value={connStr}
                onChange={(e) => setConnStr(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent transition-all disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">SQL Query</label>
              <textarea
                disabled={loading}
                placeholder="SELECT * FROM table LIMIT 1000"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm h-20 resize-none focus:outline-none focus:ring-1 focus:ring-accent transition-all disabled:opacity-50"
              />
            </div>
          </>
        )}
      </div>

      {loading && (
        <div className="mt-4 px-1">
          <div className="h-1.5 bg-surface rounded-full overflow-hidden border border-border">
            <div className="h-full bg-accent rounded-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between items-center mt-1.5">
            <span className="text-[10px] text-muted-foreground font-mono">{progress}%</span>
            <span className="text-[10px] text-accent font-medium animate-pulse">{stage}</span>
          </div>
        </div>
      )}

      <button
        onClick={handleConnect}
        disabled={loading}
        className="mt-4 w-full h-10 rounded-xl bg-accent text-accent-foreground text-sm font-semibold flex items-center justify-center gap-2 hover:bg-accent/90 transition-all disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Processing...
          </>
        ) : (
          <>
            Connect Source <ChevronRight className="h-4 w-4" />
          </>
        )}
      </button>
    </div>

  );
};
