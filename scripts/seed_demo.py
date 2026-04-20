import json
import os
import uuid
from pathlib import Path

def seed_demo():
    # Detect if we are in a container or local
    # We want to write to ./uploads so it's picked up by the Docker volume mapping
    upload_dir = "./uploads"

    os.makedirs(upload_dir, exist_ok=True)
    meta_file = Path(upload_dir) / "_datasets.json"
    
    # Generate a fixed stable ID for the demo if possible, or just a new one
    dataset_id = "demo-sales-123"
    filename = "sales.csv"
    source_path = Path("sales.csv")
    
    if not source_path.exists():
        print(f"Error: {source_path} not found in root.")
        return

    # Copy to upload dir with the ID as name
    dest_path = Path(upload_dir) / f"{dataset_id}.csv"
    content = source_path.read_bytes()
    dest_path.write_bytes(content)
    
    # Update meta
    if meta_file.exists():
        try:
            meta = json.loads(meta_file.read_text())
        except:
            meta = {}
    else:
        meta = {}
        
    meta[dataset_id] = {
        "dataset_id": dataset_id,
        "filename": filename,
        "path": str(dest_path),
        "ext": ".csv",
        "size_bytes": len(content),
        "created_at": "2026-04-19T00:00:00Z"
    }
    
    meta_file.write_text(json.dumps(meta, indent=2))
    print(f"Successfully seeded {filename} as {dataset_id}")
    print(f"Meta file updated: {meta_file}")

if __name__ == "__main__":
    seed_demo()
