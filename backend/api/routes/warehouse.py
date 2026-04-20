"""Warehouse (SQL executor) endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.services.sql_service import SQLWarehouse

warehouse_router = APIRouter(prefix="/warehouse", tags=["warehouse"])


class SqlQueryRequest(BaseModel):
    sql: str = Field(..., description="Read-only SQL query (SELECT/WITH only).")
    limit: int = Field(500, ge=1, le=5000)


@warehouse_router.get("/tables")
async def list_tables():
    tables = SQLWarehouse.get().list_tables()
    return {"tables": tables, "enabled": SQLWarehouse.get().enabled}


@warehouse_router.get("/tables/{name}")
async def describe_table(name: str):
    try:
        return SQLWarehouse.get().describe_table(name)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(400, str(exc))


@warehouse_router.post("/query")
async def run_query(body: SqlQueryRequest):
    try:
        return SQLWarehouse.get().execute(body.sql, body.limit)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:  # pragma: no cover - surfaces DB errors to the UI
        raise HTTPException(500, f"Query failed: {exc}")
