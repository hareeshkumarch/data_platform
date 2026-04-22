import { ReactNode } from "react";
import { useCountUp } from "@/hooks/useCountUp";
import { cn } from "@/lib/utils";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

interface MetricTileProps {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  delta?: number;
  icon?: LucideIcon;
  delay?: number;
  hint?: string;
  children?: ReactNode;
  status?: "default" | "good" | "warning" | "critical";
}

export const MetricTile = ({
  label,
  value,
  prefix,
  suffix,
  decimals,
  delta,
  icon: Icon,
  delay = 0,
  hint,
  children,
  status = "default",
}: MetricTileProps) => {
  const display = useCountUp(value, { prefix, suffix, decimals });

  return (
    <div
      className="card-lift p-4 animate-fade-in-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        {Icon && (
          <div className={cn("h-6 w-6 rounded-md flex items-center justify-center", 
             status === "good" ? "bg-success/15 text-success" : 
             status === "warning" ? "bg-warning/15 text-warning" : 
             status === "critical" ? "bg-destructive/15 text-destructive" : 
             "bg-accent-soft text-accent"
          )}>
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-2xl font-semibold text-foreground font-mono tracking-tight tabular-nums">
          {display}
        </span>
        {typeof delta === "number" && Number.isFinite(delta) && (
          <span
            className={cn(
              "inline-flex items-center text-[11px] font-medium",
              delta >= 0 ? "text-success" : "text-destructive"
            )}
          >
            {delta >= 0 ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      {hint && <p className={cn("mt-1 text-[11px]", 
         status === "warning" ? "text-warning" : 
         status === "critical" ? "text-destructive" : 
         status === "good" ? "text-success" : 
         "text-muted-foreground"
      )}>{hint}</p>}
      {children}
    </div>
  );
};
