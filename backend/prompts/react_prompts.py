from typing import Any, Dict, List


# ---------------------------------------------------------------------------
# React Dashboard Layout Generator
# ---------------------------------------------------------------------------

REACT_DASHBOARD_SYSTEM = """You are a senior React engineer and UI architect specializing in data dashboards.

You produce clean, production-ready React component configurations. Your output is always:
- Valid JSON that a React renderer can consume directly
- Using only standard layout primitives (grid positions, widget types)
- Ordered by visual importance (most critical KPIs top-left)
- Sized appropriately for each chart type

You return only valid JSON. No markdown. No preamble. No explanation."""


REACT_DASHBOARD_PROMPT = """Dataset: {dataset_name} | Rows: {row_count:,} | Columns: {col_count}

Available charts generated:
{chart_summary}

Available KPIs:
{kpi_summary}

Available insights count: {insight_count}

Grid: 12-column layout, row height = 80px

---
Generate a dashboard layout that maximizes insight density.
Place KPI cards first (top row), then primary charts, then secondary charts.
Each widget needs: id, type, title, position (x, y, w, h), data_source.

Valid widget types: kpi_card | line_chart | bar_chart | pie_chart | donut_chart | scatter_chart
  | heatmap | histogram | boxplot | radar_chart | treemap | funnel | table | insight_card
  | gauge | area_chart | candlestick | sankey | waterfall | violin

Return this exact JSON and nothing else:
{{
  "layout_id": "<uuid>",
  "title": "<dashboard title>",
  "theme": "light|dark",
  "grid_cols": 12,
  "row_height": 80,
  "widgets": [
    {{
      "id": "<widget_id>",
      "type": "<widget_type>",
      "title": "<widget title>",
      "position": {{"x": <0-11>, "y": <row>, "w": <1-12>, "h": <rows>}},
      "data_source": "<chart_type or kpi_column>",
      "config": {{}}
    }}
  ],
  "suggested_color_palette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],
  "refresh_interval_ms": <0 for static, else ms>
}}"""


# ---------------------------------------------------------------------------
# React Component Code Generator
# ---------------------------------------------------------------------------

REACT_COMPONENT_SYSTEM = """You are a senior React engineer. You write clean, production-grade React components.

Rules you never break:
1. Functional components only with hooks
2. TypeScript types for all props
3. Use recharts for all chart rendering — it is already installed
4. Tailwind CSS for all styling — use only core utility classes
5. Handle loading, error, and empty states
6. All data comes from props — no internal fetch calls
7. Components are self-contained — no external dependencies except react and recharts

You return only the complete component code. No explanation. No markdown fences."""


REACT_COMPONENT_PROMPT = """Generate a React TypeScript component for this chart:

Chart type: {chart_type}
Title: {title}
Data structure:
{data_structure}

Props the component receives:
- data: the chart data object (structure above)
- title: string
- height?: number (default 400)
- loading?: boolean
- error?: string

Requirements:
- Use recharts {recharts_component} component
- Show loading spinner when loading=true
- Show error message when error is set
- Show "No data available" when data is empty
- Responsive container wrapper
- Clean legend and tooltip
- Proper axis labels
- Color scheme: {color_scheme}"""


RECHARTS_MAP = {
    "bar": "BarChart",
    "line": "LineChart",
    "area": "AreaChart",
    "pie": "PieChart",
    "donut": "PieChart",
    "scatter": "ScatterChart",
    "radar": "RadarChart",
    "heatmap": "custom",
    "histogram": "BarChart",
    "boxplot": "custom",
    "treemap": "Treemap",
    "funnel": "FunnelChart",
    "candlestick": "ComposedChart",
    "gauge": "RadialBarChart",
    "waterfall": "ComposedChart",
    "sankey": "Sankey",
}

DEFAULT_COLORS = [
    "#6366f1",
    "#f59e0b",
    "#10b981",
    "#ef4444",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
    "#14b8a6",
]


# ---------------------------------------------------------------------------
# React API Integration Guide Prompt
# ---------------------------------------------------------------------------

REACT_API_INTEGRATION_SYSTEM = """You are a senior React engineer who writes clean API integration code.

You produce:
- React hooks for each API endpoint
- TypeScript interfaces matching the exact API response shapes
- Proper error handling with retry logic
- Loading states using standard patterns
- Cache-aware fetching using React Query

Rules:
- All hooks start with 'use'
- All interfaces start with 'I' prefix
- Use axios or fetch — whichever is in the project
- Never use any type — always be explicit
- Handle 4xx and 5xx separately

You return only valid TypeScript code. No explanation."""


REACT_API_INTEGRATION_PROMPT = """Generate React hooks and TypeScript interfaces for these API endpoints:

Base URL: {base_url}
Endpoints:
{endpoints}

API response schemas:
{schemas}

Generate:
1. TypeScript interface for each endpoint response
2. Custom React hook for each endpoint using React Query
3. Error type definitions
4. A single useDataset(datasetId) composite hook that fetches schema + EDA in parallel"""


# ---------------------------------------------------------------------------
# React State Management Prompt
# ---------------------------------------------------------------------------

REACT_STATE_PROMPT = """Generate a Zustand store for managing data intelligence platform state.

Required state slices:
1. datasets: {{ list of uploaded datasets, active dataset id }}
2. charts: {{ chart configs keyed by dataset_id, selected chart types }}
3. insights: {{ insights keyed by dataset_id, loading states }}
4. query: {{ query history, active question, result }}
5. tasks: {{ active task ids, polling intervals, task statuses }}
6. ui: {{ selected provider, selected model, dashboard layout }}

Requirements:
- TypeScript with explicit types
- Actions for each state mutation
- Async actions with loading/error states
- Persist datasets and ui slices to localStorage
- Task polling logic using setInterval with cleanup"""


# ---------------------------------------------------------------------------
# Builder Functions
# ---------------------------------------------------------------------------


def build_dashboard_prompt(
    dataset_name: str,
    row_count: int,
    col_count: int,
    chart_summary: str,
    kpi_summary: str,
    insight_count: int,
) -> str:
    return REACT_DASHBOARD_PROMPT.format(
        dataset_name=dataset_name,
        row_count=row_count,
        col_count=col_count,
        chart_summary=_trim(chart_summary, 2000),
        kpi_summary=_trim(kpi_summary, 500),
        insight_count=insight_count,
    )


def build_component_prompt(
    chart_type: str,
    title: str,
    data_structure: str,
    color_scheme: str = None,
) -> str:
    return REACT_COMPONENT_PROMPT.format(
        chart_type=chart_type,
        title=title,
        data_structure=_trim(data_structure, 1000),
        recharts_component=RECHARTS_MAP.get(chart_type, "BarChart"),
        color_scheme=color_scheme or str(DEFAULT_COLORS[:5]),
    )


def build_api_integration_prompt(
    base_url: str,
    endpoints: List[Dict[str, Any]],
    schemas: str,
) -> str:
    return REACT_API_INTEGRATION_PROMPT.format(
        base_url=base_url,
        endpoints=_trim(str(endpoints), 2000),
        schemas=_trim(schemas, 2000),
    )


def _trim(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + f"...[+{len(text) - max_chars} chars]"
