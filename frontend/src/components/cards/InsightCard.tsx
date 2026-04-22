import { useState, ReactNode } from "react";
import { ChevronDown, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

export interface Metric {
  label: string;
  value: string;
  delta?: number;
}

interface InsightCardProps {
  title: string;
  explanation: string;
  confidence: number; // 0-100
  metrics?: Metric[];
  tag?: string;
  defaultOpen?: boolean;
  children?: ReactNode;
  delay?: number;
}

export const InsightCard = ({
  title,
  explanation,
  confidence,
  metrics,
  tag,
  defaultOpen = false,
  children,
  delay = 0,
}: InsightCardProps) => {
  const [open, setOpen] = useState(defaultOpen);

  const confColor =
    confidence >= 80 ? "text-success" : confidence >= 60 ? "text-accent" : "text-warning";
  const confBg =
    confidence >= 80 ? "bg-success" : confidence >= 60 ? "bg-accent" : "bg-warning";

  return (
    <article
      className="card-soft p-5 transition-all duration-300 hover:border-accent/30 animate-fade-in-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <header className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1 min-w-0">
          {tag && (
            <span className="inline-block text-[10px] uppercase tracking-[0.14em] text-accent font-medium mb-2">
              {tag}
            </span>
          )}
          <h3 className="text-base font-semibold text-foreground leading-snug">{title}</h3>
        </div>

        {/* Confidence ring */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right">
            <div className={cn("text-xs font-mono font-medium", confColor)}>{confidence}%</div>
            <div className="text-[10px] text-muted-foreground -mt-0.5">confidence</div>
          </div>
          <div className="relative h-8 w-8">
            <svg className="h-8 w-8 -rotate-90" viewBox="0 0 32 32">
              <circle cx="16" cy="16" r="13" stroke="hsl(var(--border))" strokeWidth="2.5" fill="none" />
              <circle
                cx="16" cy="16" r="13"
                stroke="currentColor"
                strokeWidth="2.5"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${(confidence / 100) * 81.68} 81.68`}
                className={confColor}
              />
            </svg>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 pt-4 border-t border-border space-y-5">
              <p className="text-sm text-foreground leading-relaxed font-medium">{explanation}</p>

              {metrics && metrics.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {metrics.map((m) => (
                    <div key={m.label} className="rounded-md bg-surface border border-border px-3 py-2.5">
                      <p className="text-[11px] text-muted-foreground">{m.label}</p>
                      <div className="flex items-baseline gap-1.5 mt-0.5">
                        <span className="text-sm font-semibold text-foreground font-mono">{m.value}</span>
                        {typeof m.delta === "number" && (
                          <span
                            className={cn(
                              "inline-flex items-center text-[10px] font-medium",
                              m.delta >= 0 ? "text-success" : "text-destructive"
                            )}
                          >
                            {m.delta >= 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                            {Math.abs(m.delta)}%
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setOpen(!open)}
        className="mt-4 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-accent hover:text-accent border border-transparent hover:border-accent/20 transition-all w-full py-2 rounded-md bg-surface/50 hover:bg-accent-soft uppercase tracking-wider"
      >
        {open ? "Hide detailed analysis" : "Expand for deeper analysis"}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
    </article>
  );
};
