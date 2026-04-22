import { AppShell } from "@/components/layout/AppShell";
import { MetricTile } from "@/components/cards/MetricTile";
import { useEffect, useMemo, useState } from "react";
import {
  Activity, Check, Clock, Coins, Cpu, Database, Key, Save, Sparkles, Zap,
} from "lucide-react";

import { apiFetch } from "@/lib/api-client";
import { getLlmPreference, setLlmPreference } from "@/lib/query-api";
import { ApiResponse, Dataset } from "@/lib/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface SystemStats {
  llm_calls: number;
  llm_tokens: number;
  success_rate: number;
  avg_latency_ms: number;
}

interface LlmMetrics {
  calls_24h: number;
  tokens_in: number;
  tokens_out: number;
  avg_latency_ms: number;
  errors_24h: number;
  success_rate: number;
  key_source: "openai" | "anthropic" | "gemini" | "groq" | "none";
  active_provider: string;
  active_model: string;
}

interface ModelInfo {
  id: string;
  label: string;
  mode: string;
}

interface ProviderStatus {
  providers: string[];
  models: Record<string, ModelInfo[]>;
  default_provider: string;
  default_model: string;
  key_masked: string;
  key_configured: boolean;
}

interface SystemMetrics {
  datasetsCount: number;
  stats: SystemStats;
  llmMetrics: LlmMetrics | null;
}

/** Settings page — provider switcher, LLM telemetry and runtime preferences. */
const Settings = () => {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const pref = useMemo(() => getLlmPreference(), []);
  const [provider, setProvider] = useState<string>(pref.provider ?? "openai");
  const [model, setModel] = useState<string>(pref.model ?? "gpt-5.2");
  const [temperature, setTemperature] = useState(0.15);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [streaming, setStreaming] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [datasets, stats, providerStatus, llmMetrics] = await Promise.allSettled([
          apiFetch<ApiResponse<Dataset>>("/datasets"),
          apiFetch<SystemStats>("/system/stats"),
          apiFetch<ProviderStatus>("/settings/providers"),
          apiFetch<LlmMetrics>("/metrics/llm"),
        ]);
        setMetrics({
          datasetsCount: datasets.status === "fulfilled" ? datasets.value.datasets?.length ?? 0 : 0,
          stats: stats.status === "fulfilled" ? stats.value : { llm_calls: 0, llm_tokens: 0, success_rate: 100, avg_latency_ms: 0 },
          llmMetrics: llmMetrics.status === "fulfilled" ? llmMetrics.value : null,
        });
        if (providerStatus.status === "fulfilled") {
          setProviders(providerStatus.value);
          if (!pref.provider) setProvider(providerStatus.value.default_provider);
          if (!pref.model) setModel(providerStatus.value.default_model);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [pref.provider, pref.model]);

  const currentModels = useMemo(() => providers?.models?.[provider] ?? [], [provider, providers]);

  const saveSettings = async () => {
    setLlmPreference({ provider, model });
    try {
      await apiFetch("/settings", {
        method: "POST",
        body: JSON.stringify({ provider, model, temperature, max_tokens: maxTokens }),
      });
      toast.success(`Settings saved — using ${provider} · ${model}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save settings";
      toast.error(msg);
    }
  };

  const tokensInThousands = Number(metrics?.stats?.llm_tokens) || 0 ? (Number(metrics?.stats?.llm_tokens) || 0) / 1000 : 0;

  return (
    <AppShell title="Settings" subtitle="Configure providers, models and view usage" status={loading ? "processing" : "ready"}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-10 py-8 space-y-10" data-testid="settings-root">
        <header className="animate-fade-in-up">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl">
            Switch providers, tune generation, and inspect live LLM telemetry. Keys stay on the server.
          </p>
        </header>

        <Section title="System Overview" subtitle="Live backend signals">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-2">
                <Activity className="h-3.5 w-3.5" /> Usage
              </h3>
              <div className="grid grid-cols-2 lg:grid-cols-2 gap-3">
                <MetricTile label="LLM calls" value={metrics?.stats.llm_calls ?? 0} icon={Activity} delay={0} data-testid="metric-calls" />
                <MetricTile label="Tokens" value={Math.round(tokensInThousands)} suffix="K" icon={Cpu} delay={80} />
                <MetricTile label="Datasets" value={metrics?.datasetsCount ?? 0} icon={Database} delay={160} status="good" />
                <MetricTile label="Agents" value={7} icon={Sparkles} delay={240} status="good" />
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" /> Performance
              </h3>
              <div className="grid grid-cols-1 gap-3">
                <MetricTile label="Avg latency" value={metrics?.stats.avg_latency_ms ?? 0} icon={Clock} delay={320} suffix="ms" status="good" />
                <MetricTile label="Success rate" value={metrics?.stats.success_rate ?? 100} suffix="%" icon={Check} delay={400} status="good" />
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-2">
                <Coins className="h-3.5 w-3.5" /> Cost
              </h3>
              <div className="grid grid-cols-1 gap-3">
                <MetricTile label="Est. cost" value={parseFloat(((tokensInThousands * 0.002)).toFixed(2))} icon={Coins} delay={480} prefix="$" decimals={2} />
                <MetricTile label="Errors" value={metrics?.stats.success_rate && metrics.stats.success_rate < 100 ? Math.round((100 - metrics.stats.success_rate) / 100 * (metrics.stats.llm_calls || 0)) : 0} icon={Zap} delay={560} />
              </div>
            </div>
          </div>
        </Section>

        <Section title="Provider & Model" subtitle="Switch LLM providers instantly. Keys live on the server.">
          <div className="card-soft p-5 space-y-6 animate-fade-in-up">
            <ProviderCreditsBadge
              keySource={metrics?.llmMetrics?.key_source ?? "none"}
              keyMasked={providers?.key_masked}
              activeProvider={metrics?.llmMetrics?.active_provider ?? provider}
              activeModel={metrics?.llmMetrics?.active_model ?? model}
              calls={metrics?.llmMetrics?.calls_24h ?? 0}
              tokens={metrics?.llmMetrics ? (Number(metrics.llmMetrics.tokens_in) || 0) + (Number(metrics.llmMetrics.tokens_out) || 0) : 0}
              successRate={typeof metrics?.llmMetrics?.success_rate === "number" ? metrics.llmMetrics.success_rate : parseFloat(String(metrics?.llmMetrics?.success_rate)) || 100}
              avgLatencyMs={metrics?.llmMetrics?.avg_latency_ms ?? 0}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Provider</label>
                <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-surface border border-border w-full flex-wrap" role="tablist">
                  {(providers?.providers ?? ["openai", "anthropic", "gemini"]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="tab"
                      data-testid={`provider-${p}`}
                      aria-selected={provider === p}
                      onClick={() => {
                        setProvider(p);
                        const first = providers?.models?.[p]?.[0]?.id;
                        if (first) setModel(first);
                      }}
                      className={cn(
                        "relative flex-1 min-w-[90px] inline-flex items-center justify-center gap-2 h-8 px-3 rounded-lg text-[13px] font-medium transition-colors",
                        provider === p ? "bg-accent text-accent-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="capitalize">{p}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="model-select" className="text-sm font-medium text-foreground mb-2 block">Model</label>
                <select
                  id="model-select"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  data-testid="model-select"
                  className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                >
                  {currentModels.length === 0 ? (
                    <option value={model}>{model}</option>
                  ) : (
                    currentModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} · {m.mode}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Generation" subtitle="Client-side defaults applied to every request.">
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
              testId="temperature-slider"
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
              testId="maxtokens-slider"
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
              data-testid="save-settings-btn"
              className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 hover-lift transition-all"
            >
              <Save className="h-3.5 w-3.5" /> Save changes
            </button>
          </div>
        </Section>

        <Section title="Data & Storage" subtitle="Manage your platform's data footprint.">
          <div className="card-soft p-5 animate-fade-in-up border-destructive/20">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Database className="h-4 w-4 text-destructive" /> Clear System Data
                </h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-md">
                  Permanently delete all uploaded datasets, vector stores, Redis cache, and conversation history. This action cannot be undone.
                </p>
              </div>
              <button 
                onClick={async () => {
                  if (!window.confirm("Are you sure? This will permanently wipe all datasets, cache, and history.")) return;
                  try {
                    await apiFetch("/system/clear", { method: "DELETE" });
                    toast.success("System wiped clean.");
                    setTimeout(() => window.location.reload(), 1500);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Failed to clear system");
                  }
                }}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-destructive/10 text-destructive text-sm font-medium hover:bg-destructive hover:text-destructive-foreground transition-all"
              >
                Clear Database & Cache
              </button>
            </div>
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
  label, hint, value, min, max, step, format, onChange, testId,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  testId?: string;
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
      data-testid={testId}
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

/** Credits / key-source badge rendered at the top of the provider card. */
const ProviderCreditsBadge = ({
  keySource, keyMasked, activeProvider, activeModel, calls, tokens, successRate, avgLatencyMs,
}: {
  keySource: "openai" | "anthropic" | "gemini" | "groq" | "none";
  keyMasked?: string;
  activeProvider: string;
  activeModel: string;
  calls: number;
  tokens: number;
  successRate: number;
  avgLatencyMs: number;
}) => {
  const sourceMeta: Record<typeof keySource, { label: string; hint: string; tone: "accent" | "success" | "warning" | "destructive" }> = {
    openai: {
      label: "Direct · OpenAI",
      hint: "Using your OPENAI_API_KEY — billed against your OpenAI account.",
      tone: "success",
    },
    anthropic: {
      label: "Direct · Anthropic",
      hint: "Using your ANTHROPIC_API_KEY — billed against your Anthropic account.",
      tone: "success",
    },
    gemini: {
      label: "Direct · Gemini",
      hint: "Using your GEMINI_API_KEY — billed against your Google AI account.",
      tone: "success",
    },
    groq: {
      label: "Direct · Groq",
      hint: "Using your GROQ_API_KEY — free-tier + paid tiers at console.groq.com.",
      tone: "success",
    },
    none: {
      label: "No key configured",
      hint: "Set OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY / GROQ_API_KEY in backend/.env.",
      tone: "destructive",
    },
  };

  const meta = sourceMeta[keySource];
  const toneBg: Record<typeof meta.tone, string> = {
    accent: "bg-accent-soft text-accent border-accent/20",
    success: "bg-success/10 text-success border-success/20",
    warning: "bg-warning/10 text-warning border-warning/20",
    destructive: "bg-destructive/10 text-destructive border-destructive/20",
  };

  return (
    <div data-testid="provider-credits-badge" className="rounded-xl border border-border bg-gradient-to-br from-card to-surface/50 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-md border", toneBg[meta.tone])}>
            <Key className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground">{meta.label}</span>
              <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-mono uppercase tracking-wider border", toneBg[meta.tone])}>
                {keySource}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-md">{meta.hint}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Active model</p>
          <p className="text-xs font-mono font-semibold text-foreground" data-testid="active-model-label">
            {activeProvider} / {activeModel}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="Calls" value={Number.isFinite(calls) ? calls.toLocaleString() : "0"} />
        <MiniStat label="Tokens" value={Number.isFinite(tokens) && tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : String(Number.isFinite(tokens) ? tokens : 0)} />
        <MiniStat label="Success" value={`${Number.isFinite(successRate) ? successRate.toFixed(1) : "100.0"}%`} tone={Number.isFinite(successRate) && successRate >= 99 ? "good" : Number.isFinite(successRate) && successRate >= 95 ? "warning" : "danger"} />
        <MiniStat label="Avg latency" value={`${Number.isFinite(avgLatencyMs) ? Math.round(avgLatencyMs) : 0} ms`} />
      </div>

      {keyMasked && (
        <p className="mt-3 pt-3 border-t border-border/60 text-[11px] text-muted-foreground font-mono truncate">
          key · {keyMasked}
        </p>
      )}
    </div>
  );
};

const MiniStat = ({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "good" | "warning" | "danger" }) => {
  const toneCls = {
    default: "text-foreground",
    good: "text-success",
    warning: "text-warning",
    danger: "text-destructive",
  }[tone];
  return (
    <div className="rounded-md bg-card/70 border border-border/60 px-3 py-2">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={cn("text-sm font-semibold tabular-nums mt-0.5", toneCls)}>{value}</p>
    </div>
  );
};

export default Settings;
