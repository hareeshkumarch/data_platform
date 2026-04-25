from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from backend.services.sql_service import SQLWarehouse

conversations_router = APIRouter(prefix="/conversations", tags=["conversations"])


class ConversationMessage(BaseModel):
    id: str
    role: str
    content: str
    mode: str = "chat"
    streaming: bool = False
    pipeline: Optional[List[Dict[str, Any]]] = None
    datasetId: Optional[str] = None


class ConversationBody(BaseModel):
    id: str
    title: str
    mode: str = "chat"
    messages: List[ConversationMessage] = Field(default_factory=list)


def _require_engine():
    warehouse = SQLWarehouse.get()
    if not warehouse.enabled or warehouse.engine is None:
        raise HTTPException(503, "Conversation persistence requires PostgreSQL.")
    return warehouse.engine


@conversations_router.get("")
async def list_conversations() -> Dict[str, Any]:
    engine = _require_engine()
    with engine.connect() as conn:
        rows = (
            conn.execute(
                text(
                    "SELECT id, title, mode, updated_at, messages_json FROM conversations ORDER BY updated_at DESC LIMIT 200"
                )
            )
            .mappings()
            .all()
        )
    return {
        "conversations": [
            {
                "id": r["id"],
                "title": r["title"],
                "mode": r["mode"],
                "updatedAt": int(r["updated_at"].timestamp() * 1000)
                if r["updated_at"]
                else 0,
                "messages": r["messages_json"] or [],
            }
            for r in rows
        ],
    }


@conversations_router.get("/{conversation_id}")
async def get_conversation(conversation_id: str) -> Dict[str, Any]:
    engine = _require_engine()
    with engine.connect() as conn:
        row = (
            conn.execute(
                text(
                    "SELECT id, title, mode, updated_at, messages_json FROM conversations WHERE id = :id"
                ),
                {"id": conversation_id},
            )
            .mappings()
            .first()
        )
    if not row:
        raise HTTPException(404, "Conversation not found.")
    return {
        "id": row["id"],
        "title": row["title"],
        "mode": row["mode"],
        "updatedAt": int(row["updated_at"].timestamp() * 1000)
        if row["updated_at"]
        else 0,
        "messages": row["messages_json"] or [],
    }


@conversations_router.post("")
async def upsert_conversation(body: ConversationBody) -> Dict[str, Any]:
    engine = _require_engine()
    now = datetime.now(timezone.utc)
    messages = [m.model_dump() for m in body.messages]
    with engine.begin() as conn:
        conn.execute(
            text(),
            {
                "id": body.id,
                "title": body.title,
                "mode": body.mode,
                "updated_at": now,
                "messages_json": _to_json(messages),
            },
        )
    return {"id": body.id, "updatedAt": int(now.timestamp() * 1000)}


@conversations_router.delete("/{conversation_id}")
async def delete_conversation(conversation_id: str) -> Dict[str, Any]:
    engine = _require_engine()
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM conversations WHERE id = :id"), {"id": conversation_id}
        )

    try:
        from backend.services.cache_service import get_cache

        cache = get_cache()
        await cache.delete(f"memory:{conversation_id}")
    except Exception:
        pass
    return {"id": conversation_id, "deleted": True}


@conversations_router.post("/{conversation_id}/reset-context")
async def reset_conversation_context(conversation_id: str) -> Dict[str, Any]:
    try:
        from backend.services.cache_service import get_cache

        cache = get_cache()
        memory_key = f"memory:{conversation_id}"
        await cache.delete(memory_key)
    except Exception:
        pass
    return {"id": conversation_id, "context_reset": True}


def _to_json(value: Any) -> str:
    import json

    return json.dumps(value, default=str)
