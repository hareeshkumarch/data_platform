import { CheckCircle2, Loader2, Circle, AlertCircle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

export type AgentStatus = "pending" | "running" | "completed" | "failed";

export interface AgentStep {
  id: string;
  name: string;
  description: string;
  status: AgentStatus;
  duration?: string;
  logs?: string[];
}

interface AgentTimelineProps {
  steps: AgentStep[];
  title?: string;
}

const StatusIcon = ({ status }: { status: AgentStatus }) => {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-success" />;
    case "running":
      return <Loader2 className="h-4 w-4 text-accent animate-spin" />;
    case "failed":
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground/40" />;
  }
};

export const AgentTimeline = ({ steps, title = "Agents Running" }: AgentTimelineProps) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const running = steps.some((s) => s.status === "running");

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
          {running && <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />}
        </div>
      </div>

      <ol className="relative space-y-1">
        {/* connector line */}
        <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" aria-hidden />

        {steps.map((step, i) => {
          const open = expanded === step.id;
          return (
            <li key={step.id} className="relative animate-fade-in-up" style={{ animationDelay: `${i * 60}ms` }}>
              <button
                onClick={() => step.logs && setExpanded(open ? null : step.id)}
                className={cn(
                  "w-full flex items-start gap-3 py-2.5 px-2 -mx-2 rounded-md text-left transition-colors",
                  step.logs && "hover:bg-card/60 cursor-pointer"
                )}
              >
                <div className="relative z-10 mt-0.5 h-[22px] w-[22px] flex items-center justify-center rounded-full bg-background border border-border">
                  <StatusIcon status={step.status} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{step.name}</p>
                    {step.duration && <span className="text-[10px] font-mono text-muted-foreground">{step.duration}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.description}</p>
                </div>
                {step.logs && (
                  <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform mt-1.5", open && "rotate-90")} />
                )}
              </button>
              {open && step.logs && (
                <div className="ml-9 mb-2 p-3 rounded-md bg-background border border-border animate-fade-in">
                  <pre className="text-[11px] font-mono text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {step.logs.join("\n")}
                  </pre>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
};
