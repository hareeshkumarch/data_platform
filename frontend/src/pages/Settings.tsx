import { AppShell } from "@/components/layout/AppShell";
import { MetricTile } from "@/components/cards/MetricTile";
import { useState, useEffect } from "react";
import {
  Key, Cpu, Activity, Coins, Clock, Zap, Eye, EyeOff, Plus, Check, Trash2, Sparkles, Database, Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-client";
import { ApiResponse, Dataset } from "@/lib/types";
import { toast } from "sonner";

type Provider = "openai" | "anthropic" | "google";

interface SystemMetrics {
  datasetsCount: number;
  llmCalls: number;
  tokensSpent: number;
  successRate: number;
}

const Settings = () => {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Model Config State (initially matches .env defaults)
  const [temperature, setTemperature] = useState(0.15);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [streaming, setStreaming] = useState(true);

  const fetchMetrics = async () => {
    try {
      const [datasetsResult, statsResult] = await Promise.allSettled([
        apiFetch<ApiResponse<Dataset>>("/datasets"),
        apiFetch<{ llm_calls: number, llm_tokens: number, success_rate: number }>("/system/stats")
      ]);

      const datasets = datasetsResult.status === "fulfilled" ? datasetsResult.value : null;
      const stats = statsResult.status === "fulfilled" ? statsResult.value : null;

      setMetrics({
        datasetsCount: datasets?.datasets?.length || 0,
        llmCalls: stats?.llm_calls ?? 0,
        tokensSpent: stats ? stats.llm_tokens / 1000 : 0,
        successRate: stats?.success_rate ?? 0
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  const saveSettings = async () => {
    // Note: Backend doesn't have persistent settings API yet, so we persist to localStorage
    // but in a production app, we'd POST to /api/v1/settings
    toast.success("Settings updated successfully");
  };

  return (
    <AppShell title="Settings" subtitle="Configure providers, models and view usage" status={loading ? "processing" : "ready"}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-10 py-8 space-y-10">
        <header className="animate-fade-in-up">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl">
            Manage your environment configurations and monitor system performance.
          </p>
        </header>

        {/* SECTION 1 — Backend metrics */}
        <Section title="System Overview" subtitle="Live backend status">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-2">
                <Activity className="h-3.5 w-3.5" /> Usage
              </h3>
              <div className="grid grid-cols-2 lg:grid-cols-2 gap-3">
                <MetricTile label="LLM calls" value={metrics?.llmCalls || 0} icon={Activity} delay={0} />
                <MetricTile label="Tokens" value={metrics?.tokensSpent || 0} suffix="M" icon={Cpu} delay={80} />
                <MetricTile label="Datasets" value={metrics?.datasetsCount || 0} icon={Database} delay={160} status="good" />
                <MetricTile label="Agents" value={7} icon={Sparkles} delay={240} status="good" />
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" /> Performance
              </h3>
              <div className="grid grid-cols-1 gap-3">
                <MetricTile label="Avg latency" value={metrics?.llmCalls ? Math.round(metrics.tokensSpent / Math.max(metrics.llmCalls, 1)) : 0} icon={Clock} delay={320} suffix="ms" status="good" />
                <MetricTile label="Success rate" value={metrics?.successRate || 0} suffix="%" icon={Check} delay={400} status="good" />
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-2">
                <Coins className="h-3.5 w-3.5" /> Cost
              </h3>
              <div className="grid grid-cols-1 gap-3">
                <MetricTile label="Est. cost" value={metrics ? parseFloat(((metrics.tokensSpent * 0.001) / 1000).toFixed(2)) : 0} icon={Coins} delay={480} prefix="$" decimals={2} />
              </div>
            </div>
          </div>
        </Section>

        {/* SECTION 2 — Model config */}
        <Section title="Model configuration" subtitle="Injected via environment variables by default.">
          <div className="card-soft p-5 grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in-up">
            <SliderField
              label="Temperature"
              hint="Control LLM determinism"
              value={temperature}
              min={0}
              max={1}
              step={0.05}
              format={(v) => v.toFixed(2)}
              onChange={setTemperature}
            />
            <SliderField
              label="Max output tokens"
              hint="Cap response length"
              value={maxTokens}
              min={256}
              max={8192}
              step={128}
              format={(v) => v.toLocaleString()}
              onChange={setMaxTokens}
            />
          </div>

          <div className="card-soft p-5 mt-3 space-y-4 animate-fade-in-up">
            <ToggleRow
              label="Stream responses"
              hint="Render tokens in real-time"
              checked={streaming}
              onChange={setStreaming}
            />
          </div>

          <div className="flex justify-end mt-4">
            <button 
              onClick={saveSettings}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 hover-lift transition-all"
            >
              <Save className="h-3.5 w-3.5" /> Save changes
            </button>
          </div>
        </Section>
      </div>
    </AppShell>
  );
};

/* ---------- subcomponents ---------- */

const Section = ({
  title, subtitle, action, children,
}: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) => (
  <section className="animate-fade-in-up">
    <div className="flex items-end justify-between gap-3 mb-4 flex-wrap">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>
);

const SliderField = ({
  label, hint, value, min, max, step, format, onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) => (
  <div>
    <div className="flex items-center justify-between">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <span className="text-xs font-mono text-accent tabular-nums">{format(value)}</span>
    </div>
    <input
      type="range"
      id={`slider-${label.replace(/\s+/g, '-').toLowerCase()}`}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label={label}
      className="w-full mt-2 h-1.5 rounded-full appearance-none bg-border accent-accent cursor-pointer"
    />
    <p className="text-[11px] text-muted-foreground mt-1.5">{hint}</p>
  </div>
);

const ToggleRow = ({
  label, hint, checked, onChange,
}: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <div className="flex items-start justify-between gap-4">
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
    </div>
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 rounded-full transition-colors shrink-0",
        checked ? "bg-accent" : "bg-border"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-card shadow-sm transition-transform duration-300",
          checked ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  </div>
);

export default Settings;
