import json
import os
import asyncio
import pandas as pd
import redis.asyncio as aioredis
from pathlib import Path
import numpy as np

# Add project root to path
import sys
sys.path.append(os.getcwd())

from backend.utils.data_utils import (
    infer_schema, sanitize_rows, compute_quality_score, 
    compute_summary_stats, compute_correlation
)

async def seed_full():
    dataset_id = "demo-sales-123"
    filename = "sales.csv"
    
    source_path = Path(filename)
    if not source_path.exists():
        print(f"Error: {source_path} not found.")
        return

    df = pd.read_csv(source_path)
    schema_cols = infer_schema(df)
    quality = compute_quality_score(df)
    sample_rows = sanitize_rows(df.head(100).to_dict("records"))
    
    schema = {
        "dataset_id": dataset_id,
        "name": filename,
        "source_type": "csv",
        "row_count": len(df),
        "sampled_row_count": len(df),
        "was_sampled": False,
        "col_count": len(df.columns),
        "columns": schema_cols,
        "size_bytes": source_path.stat().st_size,
        "quality_score": quality,
    }

    # EDA
    stats = compute_summary_stats(df)
    corr = compute_correlation(df)
    eda = {
        "dataset_id": dataset_id,
        "summary_stats": stats,
        "correlation_matrix": corr,
        "quality_score": float(quality),
        "correlation_highlights": "High correlation between 'Sales' and 'Profit'.",
        "anomalies": [],
        "warnings": [],
    }

    # Mock Insights
    insights = {
        "dataset_id": dataset_id,
        "insights": [
            {
                "id": "ins-1",
                "title": "Strong Growth in North America",
                "description": "Sales in the North American region have grown by 15% month-over-month, driven by tech product categories.",
                "category": "Growth",
                "priority": 1,
                "confidence": 0.92,
                "impact": "High",
                "related_columns": ["Region", "Sales"]
            },
            {
                "id": "ins-2",
                "title": "Profit Margin Optimization Opportunity",
                "description": "The 'Supplies' category shows healthy sales volume but below-average margins. Consider price adjustments.",
                "category": "Efficiency",
                "priority": 2,
                "confidence": 0.85,
                "impact": "Medium",
                "related_columns": ["Category", "Profit", "Sales"]
            }
        ],
        "executive_summary": "Overall sales metrics are strong with a 8.5% net margin. Regional variance is low except for outliers in specific tech segments."
    }

    # Mock Charts
    charts = {
        "dataset_id": dataset_id,
        "charts": [
            {
                "id": "chart-1",
                "type": "bar",
                "title": "Sales by Category",
                "config": {
                    "data": [
                        {"category": "Technology", "sales": 125000},
                        {"category": "Furniture", "sales": 84000},
                        {"category": "Office Supplies", "sales": 42000}
                    ],
                    "xAxis": "category",
                    "yAxis": "sales"
                }
            },
            {
                "id": "chart-2",
                "type": "line",
                "title": "Monthly Revenue Trend",
                "config": {
                    "data": [
                        {"month": "Jan", "revenue": 21000},
                        {"month": "Feb", "revenue": 24500},
                        {"month": "Mar", "revenue": 28000},
                        {"month": "Apr", "revenue": 31000}
                    ],
                    "xAxis": "month",
                    "yAxis": "revenue"
                }
            }
        ],
        "kpis": [
            {"column": "Sales", "sum": df["Sales"].sum(), "mean": df["Sales"].mean()},
            {"column": "Profit", "sum": df["Profit"].sum(), "mean": df["Profit"].mean()}
        ]
    }

    redis_url = "redis://localhost:6379/0"
    print(f"Connecting to Redis at {redis_url}...")
    
    try:
        r = aioredis.from_url(redis_url, decode_responses=True)
        await r.setex(f"schema:{dataset_id}", 86400, json.dumps(schema, default=str))
        await r.setex(f"sample:{dataset_id}", 86400, json.dumps(sample_rows, default=str))
        await r.setex(f"eda:{dataset_id}", 86400, json.dumps(eda, default=str))
        await r.setex(f"insights:{dataset_id}", 86400, json.dumps(insights, default=str))
        await r.setex(f"charts:{dataset_id}", 86400, json.dumps(charts, default=str))
        
        print("Full seeding completed successfully.")
        await r.aclose()
    except Exception as e:
        print(f"Error seeding cache: {e}")

if __name__ == "__main__":
    asyncio.run(seed_full())
