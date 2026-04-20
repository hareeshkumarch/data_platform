# Data Intelligence Platform — Frontend Integration Guide

## Start the backend

```bash
cp .env.example .env
# Add GEMINI_API_KEY and/or GROQ_API_KEY
docker-compose up -d
```

API runs at `http://localhost:8000`
Interactive docs at `http://localhost:8000/docs`

---

## The complete workflow

```
1. Upload file        → POST /api/v1/upload-data
2. Poll task          → GET  /api/v1/task/{task_id}   (every 2s until status=success)
3. Process EDA        → POST /api/v1/process-data/{dataset_id}
4. Poll task          → GET  /api/v1/task/{task_id}
5. Generate insights  → POST /api/v1/generate-insights/{dataset_id}
6. Generate dashboard → POST /api/v1/dashboard/{dataset_id}
7. Query in NL        → POST /api/v1/query/{dataset_id}
8. Validate chart     → POST /api/v1/chart/validate
9. Render chart       → POST /api/v1/chart/generate
```

---

## Key endpoints for the frontend

### Upload
```
POST /api/v1/upload-data          multipart/form-data { file, dataset_name? }
POST /api/v1/upload-sql           { connection_string, query, dataset_name }
POST /api/v1/upload-api           { url, method, headers, dataset_name }
```

### Data
```
GET  /api/v1/schema/{id}          → column metadata, types, quality score
GET  /api/v1/datasets/{id}/preview?n=20 → first N rows + column list
GET  /api/v1/datasets             → list all uploaded datasets
DELETE /api/v1/datasets/{id}      → delete dataset
```

### Analysis
```
POST /api/v1/process-data/{id}    → { run_anomaly_detection, run_time_series, time_column }
GET  /api/v1/eda/{id}             → full EDA result (stats, correlations, anomalies)
```

### Advanced Analytics  (synchronous, instant)
```
POST /api/v1/analytics/{id}
Body: { "analysis_type": "<type>", "config": {} }

analysis_type options:
  kpis            → { date_col? }
  cohort          → { date_col, user_col, value_col }
  funnel          → { stage_col, value_col, stage_order? }
  group_aggregate → { group_cols, agg_col, agg_func, top_n }
  correlation     → { target_col }
  outlier_summary → {}
  profile         → {}
  trend           → { date_col, value_col }
  segment         → { segment_col, metric_cols? }
```

### Insights
```
POST /api/v1/generate-insights/{id}  → { llm_provider?, llm_model?, focus_columns? }
GET  /api/v1/insights/{id}           → { insights[], executive_summary }
```

### Natural Language Query
```
POST /api/v1/query/{id}
Body: { question, output_format: "table|chart|text", use_cache, llm_provider? }
Response: { result: { columns, rows }, suggested_chart, plan }
```

### Charts
```
POST /api/v1/chart/validate
Body: { dataset_id, chart_type }
Response: { is_valid, reason, suggested_alternative, required_columns, warnings }

POST /api/v1/chart/generate
Body: { dataset_id, chart_type?, title?, intent?, realtime? }
Response: { renderers: { echarts, chartjs }, data, chart_type, insight, warnings }

GET  /api/v1/chart/recommend/{id}    → list of valid chart types for this dataset
```

The `chart/generate` response includes three renderer configs simultaneously:
- `renderers.echarts`  → paste directly into Apache ECharts `setOption()`
- `renderers.chartjs`  → paste directly into Chart.js constructor

### Dashboard
```
POST /api/v1/dashboard/{id}   → triggers async generation
GET  /api/v1/dashboard/{id}   → { charts[], kpis[] }
```

### React Layout (LLM-generated)
```
POST /api/v1/react/dashboard-layout  → { dataset_id }
  → returns grid layout spec (x,y,w,h per widget)

POST /api/v1/react/component
  → { chart_type, title, data_structure? }
  → returns complete React TypeScript component code

GET  /api/v1/react/api-integration
  → returns endpoint list, recharts map, default colors, polling interval
```

### Data Pipeline (pre-process before charting)
```
GET  /api/v1/processors            → list all available processors

POST /api/v1/pipeline/process/{id}
Body: {
  "steps": [
    { "processor": "deduplicate", "config": {} },
    { "processor": "impute", "config": { "strategy": "median" } },
    { "processor": "normalize", "config": { "method": "minmax" } },
    { "processor": "filter_rows", "config": { "conditions": [{ "column": "age", "operator": "gt", "value": 18 }] } }
  ]
}
```

### Export
```
GET /api/v1/export/{id}/csv
GET /api/v1/export/{id}/excel
GET /api/v1/export/{id}/insights/markdown
```

### Report + Full Pipeline
```
POST /api/v1/report/{id}    → { title, sections[], llm_provider? }
POST /api/v1/pipeline/{id}  → runs full: ingest→EDA→features→insights+charts→report
```

### System
```
GET  /api/v1/health            → { status, redis }
GET  /api/v1/models            → { providers[], models: { gemini: [], groq: [] } }
GET  /api/v1/chart-types       → list all 19 supported chart types
GET  /api/v1/task/{task_id}    → { status, progress, result?, error? }
DELETE /api/v1/cache/{id}      → invalidate all cache for dataset
```

---

## Task polling pattern

```javascript
async function pollTask(taskId, onProgress, onComplete, onError) {
  const interval = setInterval(async () => {
    const res = await fetch(`/api/v1/task/${taskId}`);
    const data = await res.json();
    if (data.status === "success") {
      clearInterval(interval);
      onComplete(data.result);
    } else if (data.status === "failure") {
      clearInterval(interval);
      onError(data.error);
    } else {
      onProgress(data.progress || 0);
    }
  }, 2000);
  return () => clearInterval(interval);
}
```

## Chart rendering pattern

```javascript
// 1. Validate first (optional but recommended for user-requested charts)
const validation = await fetch("/api/v1/chart/validate", {
  method: "POST",
  body: JSON.stringify({ dataset_id, chart_type: "radar" })
}).then(r => r.json());

if (!validation.is_valid) {
  console.log("Reason:", validation.reason);
  console.log("Try instead:", validation.suggested_alternative);
}

// 2. Generate (auto-falls back if type is invalid)
const config = await fetch("/api/v1/chart/generate", {
  method: "POST",
  body: JSON.stringify({ dataset_id, chart_type: "radar", intent: "comparison" })
}).then(r => r.json());

// 3. Render with ECharts
myChart.setOption(config.renderers.echarts);

// Or Chart.js
new Chart(ctx, config.renderers.chartjs);
```

---

## Compare two datasets
```
POST /api/v1/compare
Body: { dataset_id_a, dataset_id_b, metric_col, group_col? }
```
