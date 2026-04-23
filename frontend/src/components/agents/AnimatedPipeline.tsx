import { motion, AnimatePresence } from "framer-motion";
import {
  Database, BrainCircuit, Sparkles, ChartSpline, ShieldCheck,
  CheckCircle2, Loader2, Clock, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineStage, StageStatus } from "@/lib/query-api";

interface AnimatedPipelineProps {
  stages: PipelineStage[];
  className?: string;
  compact?: boolean;
}

const STAGE_ICONS: Record<string, typeof Database> = {
  ingestion: Database,
  understanding: BrainCircuit,
  feature: Sparkles,
  insight: Zap,
  visualization: ChartSpline,
  report: ShieldCheck,
  evaluator: CheckCircle2,
};

const STATUS_CONFIG: Record<StageStatus, { color: string; bg: string; border: string; pulse: boolean }> = {
  pending: { color: "text-muted-foreground/50", bg: "bg-surface", border: "border-border/30", pulse: false },
  running: { color: "text-accent", bg: "bg-accent/10", border: "border-accent/40", pulse: true },
  done: { color: "text-success", bg: "bg-success/10", border: "border-success/30", pulse: false },
};

export const AnimatedPipeline = ({ stages, className, compact = false }: AnimatedPipelineProps) => {
  const activeIndex = stages.findIndex(s => s.status === "running");
  const doneCount = stages.filter(s => s.status === "done").length;
  const progress = stages.length > 0 ? (doneCount / stages.length) * 100 : 0;

  return (
    <div className={cn("relative", className)}>
      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Pipeline Progress
          </span>
          <span className="text-[11px] font-mono text-accent font-semibold">
            {doneCount}/{stages.length} agents
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-surface overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-accent via-accent to-success"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Pipeline stages */}
      <div className={cn("space-y-1", compact && "space-y-0.5")}>
        <AnimatePresence mode="popLayout">
          {stages.map((stage, i) => {
            const Icon = STAGE_ICONS[stage.id] || Database;
            const config = STATUS_CONFIG[stage.status];
            const isActive = stage.status === "running";
            const isDone = stage.status === "done";

            return (
              <motion.div
                key={stage.id}
                initial={{ opacity: 0, x: -20, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ delay: i * 0.08, duration: 0.4, ease: "easeOut" }}
                className="relative"
              >
                {/* Connector line */}
                {i > 0 && (
                  <div className="absolute -top-1 left-[18px] w-px h-2">
                    <motion.div
                      className={cn("w-full h-full", isDone ? "bg-success/40" : isActive ? "bg-accent/40" : "bg-border/30")}
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ delay: i * 0.08 + 0.1, duration: 0.3 }}
                    />
                  </div>
                )}

                <div
                  className={cn(
                    "flex items-center gap-3 p-2.5 rounded-lg border transition-all duration-300",
                    config.bg, config.border,
                    isActive && "shadow-[0_0_12px_rgba(var(--accent-rgb),0.15)]",
                    compact && "p-2",
                  )}
                >
                  {/* Icon with animation */}
                  <div className={cn("relative shrink-0 h-9 w-9 rounded-lg flex items-center justify-center", config.bg)}>
                    {isActive && (
                      <motion.div
                        className="absolute inset-0 rounded-lg border-2 border-accent/30"
                        animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0, 0.5] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                      />
                    )}
                    {isActive ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      >
                        <Loader2 className="h-4 w-4 text-accent" />
                      </motion.div>
                    ) : isDone ? (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", stiffness: 300, damping: 15 }}
                      >
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      </motion.div>
                    ) : (
                      <Icon className={cn("h-4 w-4", config.color)} />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-[13px] font-medium", isDone ? "text-foreground" : isActive ? "text-accent" : "text-muted-foreground")}>
                        {stage.name}
                      </span>
                      {isActive && (
                        <motion.span
                          className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-mono font-semibold"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                        >
                          ACTIVE
                        </motion.span>
                      )}
                    </div>
                    <AnimatePresence mode="wait">
                      <motion.p
                        key={stage.status}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.2 }}
                        className="text-[11px] text-muted-foreground truncate mt-0.5"
                      >
                        {isDone ? (stage.detail || "Complete") : (stage.log || "Waiting...")}
                      </motion.p>
                    </AnimatePresence>
                  </div>

                  {/* Status indicator */}
                  <div className="shrink-0">
                    {isDone && (
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: "auto" }}
                        className="text-[10px] font-mono text-success bg-success/10 px-1.5 py-0.5 rounded"
                      >
                        DONE
                      </motion.div>
                    )}
                    {stage.status === "pending" && (
                      <Clock className="h-3 w-3 text-muted-foreground/30" />
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Animated particles for active state */}
      {activeIndex >= 0 && (
        <motion.div
          className="absolute -right-1 top-0 bottom-0 w-0.5 overflow-hidden pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="absolute w-0.5 h-3 rounded-full bg-accent/40"
              animate={{
                y: ["0%", "100%"],
                opacity: [0, 1, 0],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                delay: i * 0.6,
                ease: "linear",
              }}
            />
          ))}
        </motion.div>
      )}
    </div>
  );
};

export default AnimatedPipeline;
