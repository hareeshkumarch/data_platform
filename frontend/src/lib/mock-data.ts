import type { ChartSpec } from "@/components/charts/DynamicChart";
import type { AgentStep } from "@/components/agents/AgentTimeline";

export const revenueTrend: ChartSpec = {
  chart: "area",
  xKey: "month",
  series: [
    { key: "revenue", label: "Revenue" },
    { key: "forecast", label: "Forecast" },
  ],
  data: [
    { month: "Jul", revenue: 142, forecast: 138 },
    { month: "Aug", revenue: 168, forecast: 158 },
    { month: "Sep", revenue: 192, forecast: 178 },
    { month: "Oct", revenue: 210, forecast: 198 },
    { month: "Nov", revenue: 245, forecast: 220 },
    { month: "Dec", revenue: 287, forecast: 245 },
  ],
};

export const segmentBreakdown: ChartSpec = {
  chart: "bar",
  xKey: "segment",
  series: [{ key: "value", label: "Customers" }],
  data: [
    { segment: "Enterprise", value: 1240 },
    { segment: "Mid-market", value: 2890 },
    { segment: "SMB", value: 4520 },
    { segment: "Self-serve", value: 8910 },
  ],
};

export const churnTrend: ChartSpec = {
  chart: "line",
  xKey: "week",
  series: [
    { key: "actual", label: "Actual churn %" },
    { key: "baseline", label: "Baseline" },
  ],
  data: Array.from({ length: 12 }).map((_, i) => ({
    week: `W${i + 1}`,
    actual: +(2.1 + Math.sin(i / 2) * 0.6 + Math.random() * 0.3).toFixed(2),
    baseline: 2.4,
  })),
};

export const sampleAgents: AgentStep[] = [
  {
    id: "ingestion",
    name: "Ingestion Agent",
    description: "Successfully processed source data and validated schema",
    status: "completed",
    duration: "0.8s",
    logs: [
      "✓ Connected to source",
      "✓ Validated record integrity",
      "→ Passing to Understanding Agent",
    ],
  },
  {
    id: "understanding",
    name: "Understanding Agent",
    description: "Generated EDA profile and inferred statistical distributions",
    status: "completed",
    duration: "1.4s",
    logs: [
      "✓ Computed summary statistics",
      "✓ Detected core correlations",
      "→ Passing to Insight Agent",
    ],
  },
  {
    id: "insight",
    name: "Insight Agent",
    description: "Synthesized 3 key narratives and 1 anomaly",
    status: "running",
    duration: "2.1s",
    logs: [
      "Scanning for trend resets…",
      "✓ Identified revenue acceleration signal",
    ],
  },
  {
    id: "report",
    name: "Report Agent",
    description: "Will compile findings into a final summary",
    status: "pending",
  },
];
