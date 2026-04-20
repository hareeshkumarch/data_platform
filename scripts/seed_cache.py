import json
import os
import asyncio
import pandas as pd
import redis.asyncio as aioredis
from pathlib import Path

# Add project root to path so we can import backend utilities
import sys
sys.path.append(os.getcwd())

from backend.utils.data_utils import infer_schema, sanitize_rows, compute_quality_score

async def seed_cache():
    dataset_id = "demo-sales-123"
    filename = "sales.csv"
    
    source_path = Path(filename)
    if not source_path.exists():
        print(f"Error: {source_path} not found.")
        return

    print(f"Reading {filename}...")
    df = pd.read_csv(source_path)
    
    print("Generating metadata...")
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

    # Connect to Redis (localhost since it's mapped)
    # The default REDIS_URL from settings might be 'redis' (container name)
    # We force localhost for this script.
    redis_url = "redis://localhost:6379/0"
    print(f"Connecting to Redis at {redis_url}...")
    
    try:
        r = aioredis.from_url(redis_url, decode_responses=True)
        
        print(f"Setting schema for {dataset_id}...")
        await r.setex(f"schema:{dataset_id}", 86400, json.dumps(schema, default=str))
        
        print(f"Setting sample for {dataset_id}...")
        await r.setex(f"sample:{dataset_id}", 86400, json.dumps(sample_rows, default=str))
        
        print("Cache seeding completed successfully.")
        await r.aclose()
    except Exception as e:
        print(f"Error seeding cache: {e}")

if __name__ == "__main__":
    asyncio.run(seed_cache())
