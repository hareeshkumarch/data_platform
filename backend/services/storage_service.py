from __future__ import annotations

import asyncio
import json
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from backend.config import settings
from backend.utils.logger import get_logger

logger = get_logger(__name__)


class StorageService:
    _META_FILE = Path(settings.UPLOAD_DIR) / "_datasets.json"

    def __init__(self):
        self._lock = threading.RLock()
        Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
        if not self._META_FILE.exists():
            self._META_FILE.write_text("{}")

    def _load_meta(self) -> Dict[str, Any]:
        with self._lock:
            try:
                return json.loads(self._META_FILE.read_text())
            except Exception:
                return {}

    def _save_meta(self, meta: Dict[str, Any]):
        with self._lock:
            self._META_FILE.write_text(json.dumps(meta, indent=2, default=str))

    def _store_file_sync(
        self, content: bytes, filename: str, dataset_id: Optional[str] = None
    ) -> Dict[str, Any]:
        dataset_id = dataset_id or str(uuid.uuid4())
        ext = Path(filename).suffix.lower() or ".csv"
        path = Path(settings.UPLOAD_DIR) / f"{dataset_id}{ext}"

        with self._lock:
            path.write_bytes(content)

            meta = self._load_meta()
            meta[dataset_id] = {
                "id": dataset_id,
                "dataset_id": dataset_id,
                "filename": filename,
                "path": str(path),
                "ext": ext,
                "size_bytes": len(content),
            }
            self._save_meta(meta)

        logger.info("File stored", dataset_id=dataset_id, size=len(content))
        return {
            "dataset_id": dataset_id,
            "local_path": str(path),
            "size_bytes": len(content),
        }

    async def store_file(
        self, content: bytes, filename: str, dataset_id: Optional[str] = None
    ) -> Dict[str, Any]:
        return await asyncio.to_thread(
            self._store_file_sync, content, filename, dataset_id
        )

    def get_file_path(self, dataset_id: str) -> Optional[Path]:
        with self._lock:
            meta = self._load_meta()
            entry = meta.get(dataset_id)
            if not entry:
                return None
            p = Path(entry["path"])
            return p if p.exists() else None

    def get_file_bytes(self, dataset_id: str) -> Optional[bytes]:
        path = self.get_file_path(dataset_id)
        return path.read_bytes() if path else None

    def _read_dataframe(self, path: Path) -> pd.DataFrame:
        suffix = path.suffix.lower()
        loader = {
            ".csv": pd.read_csv,
            ".xlsx": pd.read_excel,
            ".xls": pd.read_excel,
            ".json": pd.read_json,
            ".parquet": pd.read_parquet,
        }.get(suffix)
        if loader is None:
            raise ValueError(f"Unsupported file type: {suffix}")
        return loader(path)

    async def load_dataframe(self, dataset_id: str) -> pd.DataFrame:
        path = self.get_file_path(dataset_id)
        if not path:
            raise FileNotFoundError(f"Dataset file not found for id '{dataset_id}'.")
        return await asyncio.to_thread(self._read_dataframe, path)

    def load_dataframe_sync(self, dataset_id: str) -> pd.DataFrame:
        path = self.get_file_path(dataset_id)
        if not path:
            raise FileNotFoundError(f"Dataset file not found for id '{dataset_id}'.")
        return self._read_dataframe(path)

    def save_dataset_record(self, record: Dict[str, Any]):
        with self._lock:
            meta = self._load_meta()
            meta[record["dataset_id"]] = {
                **meta.get(record["dataset_id"], {}),
                **record,
            }
            self._save_meta(meta)

    def get_dataset_record(self, dataset_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            return self._load_meta().get(dataset_id)

    def list_datasets(self) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._load_meta().values())

    def delete_dataset(self, dataset_id: str):
        with self._lock:
            meta = self._load_meta()
            entry = meta.pop(dataset_id, None)
            if entry:
                p = Path(entry.get("path", ""))
                if p.exists():
                    p.unlink()
            self._save_meta(meta)
