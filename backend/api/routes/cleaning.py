from __future__ import annotations

import io
import json
from datetime import datetime
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.api.routes.endpoints import _get_df_and_schema, get_cache, get_storage
from backend.services.cache_service import CacheService
from backend.services.smart_cleaning import apply_cleaning, suggest_cleaning
from backend.services.storage_service import StorageService
from backend.utils.data_utils import sanitize_rows
from backend.utils.logger import get_logger

logger = get_logger(__name__)

cleaning_router = APIRouter(prefix="/cleaning", tags=["cleaning"])


class CleaningOperation(BaseModel):
    id: Optional[str] = None
    op: str
    column: Optional[str] = None
    params: Dict[str, Any] = {}


class CleaningRequest(BaseModel):
    operations: List[CleaningOperation]


class ApplyRequest(CleaningRequest):
    save_as: Optional[str] = None


@cleaning_router.post("/suggest/{dataset_id}")
async def cleaning_suggest(dataset_id: str, cache: CacheService = Depends(get_cache)):
    df, schema = await _get_df_and_schema(dataset_id, cache)
    result = suggest_cleaning(df, schema.get("columns", []))
    result["dataset_id"] = dataset_id
    result["row_count"] = int(len(df))
    result["col_count"] = int(len(df.columns))
    return result


def _rows_preview(df: pd.DataFrame, n: int = 50) -> Dict[str, Any]:
    head = df.head(n)
    return {
        "columns": list(head.columns),
        "rows": sanitize_rows(head.to_dict("records")),
    }


@cleaning_router.post("/preview/{dataset_id}")
async def cleaning_preview(
    dataset_id: str,
    body: CleaningRequest,
    cache: CacheService = Depends(get_cache),
):
    df, schema = await _get_df_and_schema(dataset_id, cache)
    original_rows = len(df)
    original_cols = list(df.columns)

    cleaned, report = apply_cleaning(df, [op.model_dump() for op in body.operations])

    null_deltas = []
    before_null = df.isna().mean() * 100
    after_null = cleaned.isna().mean() * 100
    for col in cleaned.columns:
        before = float(before_null.get(col, 0.0))
        after = float(after_null.get(col, 0.0))
        if abs(before - after) > 0.01:
            null_deltas.append(
                {
                    "column": col,
                    "before_null_pct": round(before, 2),
                    "after_null_pct": round(after, 2),
                    "delta_pct": round(before - after, 2),
                }
            )

    report.update(
        {
            "dataset_id": dataset_id,
            "columns_before": original_cols,
            "columns_after": list(cleaned.columns),
            "columns_dropped": [c for c in original_cols if c not in cleaned.columns],
            "columns_added": [c for c in cleaned.columns if c not in original_cols],
            "rows_before": original_rows,
            "rows_after": len(cleaned),
            "preview": _rows_preview(cleaned, 50),
            "null_pct_changes": null_deltas,
        }
    )
    return report


@cleaning_router.post("/apply/{dataset_id}")
async def cleaning_apply(
    dataset_id: str,
    body: ApplyRequest,
    cache: CacheService = Depends(get_cache),
    storage: StorageService = Depends(get_storage),
):
    df, schema = await _get_df_and_schema(dataset_id, cache)
    cleaned, report = apply_cleaning(df, [op.model_dump() for op in body.operations])

    source_name = schema.get("name") or dataset_id
    base_name = body.save_as or f"{source_name} (cleaned)"
    filename = f"{base_name}.csv"
    buf = io.StringIO()
    cleaned.to_csv(buf, index=False)
    payload = buf.getvalue().encode("utf-8")

    ref = await storage.store_file(payload, filename)
    new_id = ref["dataset_id"]

    cols: List[Dict[str, Any]] = []
    for c in cleaned.columns:
        dtype = str(cleaned[c].dtype)
        if "int" in dtype or "float" in dtype:
            inferred = "numeric"
        elif "datetime" in dtype:
            inferred = "datetime"
        elif "bool" in dtype:
            inferred = "boolean"
        else:
            inferred = "categorical"
        cols.append(
            {
                "name": c,
                "dtype": dtype,
                "inferred_type": inferred,
                "null_pct": round(float(cleaned[c].isnull().mean() * 100), 2),
                "unique_count": int(cleaned[c].nunique()),
            }
        )
    new_schema = {
        "dataset_id": new_id,
        "name": base_name,
        "row_count": int(len(cleaned)),
        "col_count": int(len(cleaned.columns)),
        "columns": cols,
        "source_dataset_id": dataset_id,
        "created_at": datetime.utcnow().isoformat(),
    }
    await cache.set_schema(new_id, new_schema)
    await cache.set_sample(new_id, sanitize_rows(cleaned.head(5000).to_dict("records")))

    try:
        from backend.services.sql_service import SQLWarehouse

        SQLWarehouse.get().upsert_dataset_record(
            {
                "id": new_id,
                "name": base_name,
                "filename": filename,
                "source_type": "cleaned",
                "size_bytes": len(payload),
                "row_count": len(cleaned),
                "col_count": len(cleaned.columns),
                "schema_json": json.dumps(new_schema, default=str),
                "created_at": datetime.utcnow(),
            }
        )
    except Exception as exc:
        logger.warning("cleaned dataset registry insert failed", error=str(exc))

    return {
        "dataset_id": new_id,
        "source_dataset_id": dataset_id,
        "filename": filename,
        "name": base_name,
        "rows": len(cleaned),
        "cols": len(cleaned.columns),
        "report": report,
    }
