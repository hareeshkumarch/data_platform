import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart, Line,
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  ScatterChart, Scatter,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Treemap,
  FunnelChart, Funnel, LabelList,
  RadialBarChart, RadialBar,
  Sankey,
  ComposedChart, ReferenceLine,
  XAxis, YAxis, ZAxis,
  Tooltip, CartesianGrid, Legend,
} from "recharts";

export type ChartType =
  | "line" | "area" | "bar"
  | "pie" | "donut"
  | "scatter" | "bubble"
  | "radar"
  | "heatmap" | "histogram" | "boxplot"
  | "treemap" | "funnel"
  | "candlestick" | "gauge"
  | "sankey" | "waterfall" | "violin"
  | "table";

export interface ChartSpec {
  chart: ChartType;
  data: Record<string, unknown>[];
  xKey: string;
  series: { key: string; label: string; color?: string }[];
  height?: number;
  title?: string;
}

const palette = [
  "hsl(var(--accent))",
  "hsl(122 39% 55%)",
  "hsl(38 100% 65%)",
  "hsl(280 70% 70%)",
  "hsl(0 70% 60%)",
  "hsl(200 70% 55%)",
  "hsl(60 70% 55%)",
  "hsl(320 70% 55%)",
];

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
  color: "hsl(var(--foreground))",
  boxShadow: "var(--shadow-soft)",
};

const axisDefaults = {
  stroke: "hsl(var(--muted-foreground))",
  fontSize: 11,
  tickLine: false,
  axisLine: { stroke: "hsl(var(--border))" },
};

export const DynamicChart = ({ spec }: { spec: ChartSpec }) => {
  const { chart, data, xKey, series, height = 240, title } = spec;

  // Guard empty data
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        No data available to chart
      </div>
    );
  }

  const Title = title ? (
    <h4 className="text-xs uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-2">{title}</h4>
  ) : null;

  /* ─────── PIE / DONUT ─────── */
  if (chart === "pie" || chart === "donut") {
    const pieKey = series[0]?.key || Object.keys(data[0]).find((k) => k !== xKey) || "value";
    return (
      <div>
        {Title}
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={data}
              dataKey={pieKey}
              nameKey={xKey}
              cx="50%"
              cy="50%"
              innerRadius={chart === "donut" ? height * 0.2 : 0}
              outerRadius={height * 0.35}
              paddingAngle={2}
              animationDuration={800}
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={palette[i % palette.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  /* ─────── SCATTER ─────── */
  if (chart === "scatter") {
    return (
      <div>
        {Title}
        <ResponsiveContainer width="100%" height={height}>
          <ScatterChart margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} {...axisDefaults} name={xKey} />
            <YAxis {...axisDefaults} width={40} dataKey={series[0]?.key} name={series[0]?.label} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: "3 3" }} />
            {series.map((s, i) => (
              <Scatter key={s.key} name={s.label} data={data} fill={s.color || palette[i % palette.length]} animationDuration={800} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  }

  /* ─────── BUBBLE (scatter + Z axis) ─────── */
  if (chart === "bubble") {
    const zKey = series[2]?.key || series[1]?.key || "z";
    return (
      <div>
        {Title}
        <ResponsiveContainer width="100%" height={height}>
          <ScatterChart margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} {...axisDefaults} name={xKey} />
            <YAxis {...axisDefaults} width={40} dataKey={series[0]?.key} />
            <ZAxis dataKey={zKey} range={[20, 400]} />
            <Tooltip contentStyle={tooltipStyle} />
            <Scatter name={series[0]?.label || "Data"} data={data} fill={palette[0]} animationDuration={800} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  }

  /* ─────── RADAR ─────── */
  if (chart === "radar") {
    return (
      <div>
        {Title}
        <ResponsiveContainer width="100%" height={height}>
          <RadarChart data={data} cx="50%" cy="50%" outerRadius={height * 0.35}>
            <PolarGrid stroke="hsl(var(--border))" />
            <PolarAngleAxis dataKey={xKey} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <PolarRadiusAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            {series.map((s, i) => (
              <Radar key={s.key} name={s.label} dataKey={s.key} stroke={s.color || palette[i % palette.length]} fill={s.color || palette[i % palette.length]} fillOpacity={0.2} animationDuration={800} />
            ))}
            <Tooltip contentStyle={tooltipStyle} />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />}
          </RadarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  /* ─────── HISTOGRAM (BarChart, no gap) ─────── */
  if (chart === "histogram") {
    const histKey = series[0]?.key || Object.keys(data[0]).find((k) => k !== xKey) || "value";
    return (
      <div>
        {Title}
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }} barGap={0} barCategoryGap={0}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} {...axisDefaults} />
            <YAxis {...axisDefaults} width={40} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey={histKey} name={series[0]?.label || "Frequency"} fill={palette[0]} radius={[2, 2, 0, 0]} animationDuration={800} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  /* ─────── HEATMAP (table of colored cells) ─────── */
  if (chart === "heatmap") {
    const numCols = Object.keys(data[0] || {}).filter((k) => k !== xKey);
    return (
      <div>
        {Title}
        <div className="overflow-auto" style={{ maxHeight: height }}>
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr>
                <th className="p-1.5 text-left text-muted-foreground sticky left-0 bg-background">{xKey}</th>
                {numCols.map((c) => (
                  <th key={c} className="p-1.5 text-center text-muted-foreground">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, ri) => (
                <tr key={ri}>
                  <td className="p-1.5 font-medium sticky left-0 bg-background">{String(row[xKey] || "")}</td>
                  {numCols.map((c) => {
                    const val = Number(row[c]) || 0;
                    const intensity = Math.min(Math.abs(val), 1);
                    const bg = val >= 0
                      ? `rgba(99, 102, 241, ${intensity * 0.6})`
                      : `rgba(239, 68, 68, ${intensity * 0.6})`;
                    return (
                      <td key={c} className="p-1.5 text-center font-mono tabular-nums" style={{ backgroundColor: bg }}>
                        {typeof val === "number" ? val.toFixed(2) : val}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /* ─────── BOXPLOT (custom via bar + whisker) ─────── */
  if (chart === "boxplot") {
    return (
      <div>
        {Title}
        <div className="overflow-auto space-y-2 p-2" style={{ maxHeight: height }}>
          {data.map((d: any, i: number) => {
            const name = d.name || d[xKey] || `Group ${i + 1}`;
            const q1 = d.q1 ?? 0, median = d.median ?? 0, q3 = d.q3 ?? 0, min = d.min ?? 0, max = d.max ?? 0;
            const range = max - min || 1;
            return (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className="w-20 truncate text-muted-foreground font-medium">{name}</span>
                <div className="flex-1 h-6 relative bg-surface rounded border border-border">
                  <div className="absolute top-1 bottom-1 bg-accent/20 rounded" style={{ left: `${((q1 - min) / range) * 100}%`, width: `${((q3 - q1) / range) * 100}%` }} />
                  <div className="absolute top-0 bottom-0 w-0.5 bg-accent" style={{ left: `${((median - min) / range) * 100}%` }} />
                </div>
                <span className="w-16 text-right text-muted-foreground font-mono tabular-nums">{median.toFixed(1)}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ─────── TREEMAP ─────── */
  if (chart === "treemap") {
    const valueKey = series[0]?.key || Object.keys(data[0]).find((k) => k !== xKey && k !== "name") || "value";
    const treemapData = data.map((d: any) => ({ name: d[xKey] || d.name || "", size: d[valueKey] || d.value || 0 }));
    return (
      <div>
        {Title}
        <ResponsiveContainer width="100%" height={height}>
          <Treemap
            data={treemapData}
            dataKey="size"
            nameKey="name"
            stroke="hsl(var(--border))"
            animationDuration={800}
            fill={palette[0]}
          >
            <Tooltip contentStyle={tooltipStyle} />
          </Treemap>
        </ResponsiveContainer>
      </div>
    );
  }

  /* ─────── FUNNEL ─────── */
  if (chart === "funnel") {
    const funnelKey = series[0]?.key || Object.keys(data[0]).find((k) => k !== xKey && k !== "name") || "value";
    const funnelData = data.map((d: any, i: number) => ({
      name: d[xKey] || d.name || `Stage ${i + 1}`,
      value: d[funnelKey] || d.value || 0,
      fill: palette[i % palette.length],
    }));
    return (
      <div>
        {Title}
        <ResponsiveContainer width="100%" height={height}>
          <FunnelChart>
            <Tooltip contentStyle={tooltipStyle} />
            <Funnel dataKey="value" data={funnelData} animationDuration={800}>
              <LabelList position="right" fill="hsl(var(--foreground))" fontSize={11} />
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </div>
    );
  }

  /* ─────── GAUGE (RadialBar) ─────── */
  if (chart === "gauge") {
    const gaugeVal = Number(data[0]?.[series[0]?.key] || data[0]?.value || 0);
    const gaugeMax = Number(data[0]?.max || 100);
    const pct = Math.round((gaugeVal / gaugeMax) * 100);
    return (
      <div>
        {Title}
        <ResponsiveContainer width="100%" height={height}>
          <RadialBarChart
            cx="50%" cy="50%"
            innerRadius="60%" outerRadius="90%"
            startAngle={180} endAngle={0}
            data={[{ name: "value", value: pct, fill: palette[0] }]}
          >
            <RadialBar dataKey="value" cornerRadius={8} animationDuration={800} />
            <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill="hsl(var(--foreground))" fontSize={24} fontWeight={700}>
              {gaugeVal.toFixed(1)}
            </text>
            <text x="50%" y="62%" textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={11}>
              of {gaugeMax}
            </text>
          </RadialBarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  /* ─────── SANKEY ─────── */
  if (chart === "sankey") {
    // Recharts Sankey expects { nodes: [{name}], links: [{source, target, value}] }
    const nodes: any[] = (data as any).nodes || [];
    const links: any[] = (data as any).links || [];
    if (nodes.length > 0 && links.length > 0) {
      return (
        <div>
          {Title}
          <ResponsiveContainer width="100%" height={height}>
            <Sankey data={{ nodes, links }} node={{ fill: palette[0], stroke: "hsl(var(--border))" }} link={{ stroke: "hsl(var(--accent))", strokeOpacity: 0.3 }} margin={{ top: 10, right: 20, left: 20, bottom: 10 }}>
              <Tooltip contentStyle={tooltipStyle} />
            </Sankey>
          </ResponsiveContainer>
        </div>
      );
    }
    // Fallback: treat as regular bar data
    return <DynamicChart spec={{ ...spec, chart: "bar" }} />;
  }

  /* ─────── WATERFALL (ComposedChart with reference) ─────── */
  if (chart === "waterfall") {
    const wfKey = series[0]?.key || Object.keys(data[0]).find((k) => k !== xKey) || "value";
    let running = 0;
    const wfData = data.map((d: any) => {
      const val = Number(d[wfKey]) || 0;
      const start = running;
      running += val;
      return { ...d, _start: start, _end: running, _val: val };
    });
    return (
      <div>
        {Title}
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={wfData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} {...axisDefaults} />
            <YAxis {...axisDefaults} width={40} />
            <Tooltip contentStyle={tooltipStyle} />
            <ReferenceLine y={0} stroke="hsl(var(--border))" />
            <Bar dataKey="_end" stackId="wf" fill="transparent" />
            <Bar dataKey="_val" stackId="wf" fill={palette[0]} radius={[3, 3, 0, 0]} animationDuration={800}>
              {wfData.map((d: any, i: number) => (
                <Cell key={i} fill={d._val >= 0 ? palette[0] : palette[4]} />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  /* ─────── CANDLESTICK (ComposedChart OHLC bars) ─────── */
  if (chart === "candlestick") {
    return (
      <div>
        {Title}
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} {...axisDefaults} />
            <YAxis {...axisDefaults} width={50} domain={["auto", "auto"]} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey={series[0]?.key || "close"} fill={palette[0]} radius={[2, 2, 0, 0]} animationDuration={800} />
            {series.slice(1).map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} stroke={palette[(i + 1) % palette.length]} dot={false} strokeWidth={1} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  /* ─────── VIOLIN (density as area) ─────── */
  if (chart === "violin") {
    // Expects data[].density = [{x, y}]
    const violinSeries = (data as any[]).filter((d) => d.density);
    if (violinSeries.length > 0) {
      return (
        <div>
          {Title}
          <div className="space-y-3" style={{ maxHeight: height, overflow: "auto" }}>
            {violinSeries.map((v: any, vi: number) => (
              <div key={vi}>
                <p className="text-[11px] text-muted-foreground font-medium mb-1">{v.name}</p>
                <ResponsiveContainer width="100%" height={80}>
                  <AreaChart data={v.density} margin={{ top: 2, right: 4, left: 4, bottom: 2 }}>
                    <Area type="monotone" dataKey="y" stroke={palette[vi % palette.length]} fill={palette[vi % palette.length]} fillOpacity={0.2} strokeWidth={1.5} />
                    <XAxis dataKey="x" hide />
                    <Tooltip contentStyle={tooltipStyle} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
        </div>
      );
    }
    // Fallback to histogram
    return <DynamicChart spec={{ ...spec, chart: "histogram" }} />;
  }

  /* ─────── TABLE ─────── */
  if (chart === "table") {
    const cols = Object.keys(data[0] || {});
    return (
      <div>
        {Title}
        <div className="overflow-auto rounded-lg border border-border" style={{ maxHeight: height }}>
          <table className="w-full text-[11px] border-collapse">
            <thead className="sticky top-0 bg-surface">
              <tr>
                {cols.map((c) => (
                  <th key={c} className="p-2 text-left font-semibold text-muted-foreground border-b border-border whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 100).map((row, ri) => (
                <tr key={ri} className="hover:bg-surface/50 transition-colors">
                  {cols.map((c) => (
                    <td key={c} className="p-2 text-foreground border-b border-border/50 whitespace-nowrap max-w-[200px] truncate">{String(row[c] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {data.length > 100 && (
            <p className="text-[10px] text-muted-foreground text-center py-1.5">Showing 100 of {data.length} rows</p>
          )}
        </div>
      </div>
    );
  }

  /* ─────── STANDARD: Line / Area / Bar ─────── */
  const renderSeries = () =>
    series.map((s, i) => {
      const color = s.color || palette[i % palette.length];
      if (chart === "line") {
        return <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} animationDuration={800} />;
      }
      if (chart === "area") {
        return <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color} fill={color} fillOpacity={0.15} strokeWidth={2} animationDuration={800} />;
      }
      return <Bar key={s.key} dataKey={s.key} name={s.label} fill={color} radius={[4, 4, 0, 0]} animationDuration={800} />;
    });

  const ChartComp = chart === "line" ? LineChart : chart === "area" ? AreaChart : BarChart;

  return (
    <div>
      {Title}
      <ResponsiveContainer width="100%" height={height}>
        <ChartComp data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey={xKey} {...axisDefaults} />
          <YAxis {...axisDefaults} width={40} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "hsl(var(--accent))", strokeOpacity: 0.2, strokeWidth: 1 }} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }} iconType="circle" iconSize={8} />}
          {renderSeries()}
        </ChartComp>
      </ResponsiveContainer>
    </div>
  );
};
