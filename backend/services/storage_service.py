from __future__ import annotations

import asyncio
import hashlib
import json
import threading
import time
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

            checksum = hashlib.sha256(content).hexdigest()
            meta = self._load_meta()
            meta[dataset_id] = {
                "id": dataset_id,
                "dataset_id": dataset_id,
                "filename": filename,
                "path": str(path),
                "ext": ext,
                "size_bytes": len(content),
                "checksum_sha256": checksum,
                "created_at": time.time(),
                "last_accessed_at": time.time(),
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

    def touch_access(self, dataset_id: str) -> None:
        with self._lock:
            meta = self._load_meta()
            if dataset_id in meta:
                meta[dataset_id]["last_accessed_at"] = time.time()
                self._save_meta(meta)

    def list_stale_datasets(self, max_age_days: int = 90) -> List[Dict[str, Any]]:
        cutoff = time.time() - (max_age_days * 86400)
        stale = []
        with self._lock:
            meta = self._load_meta()
            for entry in meta.values():
                last = entry.get("last_accessed_at", entry.get("created_at", 0))
                if last < cutoff:
                    stale.append(entry)
        return stale

    def get_storage_stats(self) -> Dict[str, Any]:
        with self._lock:
            meta = self._load_meta()
            total_bytes = sum(e.get("size_bytes", 0) for e in meta.values())
            return {
                "total_datasets": len(meta),
                "total_bytes": total_bytes,
                "total_mb": round(total_bytes / 1024 / 1024, 2),
            }

    def validate_upload(
        self,
        content: bytes,
        filename: str,
        *,
        max_size_mb: int = 200,
        min_rows: int = 1,
        min_cols: int = 1,
        max_malformed_pct: float = 50.0,
    ) -> Dict[str, Any]:
        errors: List[str] = []
        warnings: List[str] = []
        stats: Dict[str, Any] = {"size_bytes": len(content), "filename": filename}

        size_mb = len(content) / (1024 * 1024)
        stats["size_mb"] = round(size_mb, 2)
        if size_mb > max_size_mb:
            errors.append(f"File exceeds {max_size_mb} MB limit ({size_mb:.1f} MB).")

        ext = Path(filename).suffix.lower()
        stats["extension"] = ext
        if ext not in {".csv", ".xlsx", ".xls", ".json", ".parquet"}:
            errors.append(
                f"Unsupported file type: {ext}. Accepted: csv, xlsx, xls, json, parquet."
            )
            return {
                "valid": False,
                "errors": errors,
                "warnings": warnings,
                "stats": stats,
            }

        try:
            import io

            loader = {
                ".csv": lambda: pd.read_csv(io.BytesIO(content), nrows=5000),
                ".xlsx": lambda: pd.read_excel(io.BytesIO(content), nrows=5000),
                ".xls": lambda: pd.read_excel(io.BytesIO(content), nrows=5000),
                ".json": lambda: pd.read_json(io.BytesIO(content)),
                ".parquet": lambda: pd.read_parquet(io.BytesIO(content)),
            }[ext]
            df = loader()
        except Exception as e:
            errors.append(f"Failed to parse file: {str(e)[:200]}")
            return {
                "valid": False,
                "errors": errors,
                "warnings": warnings,
                "stats": stats,
            }

        stats["rows"] = len(df)
        stats["cols"] = len(df.columns)
        stats["columns"] = list(df.columns[:50])

        if len(df) < min_rows:
            errors.append(f"Dataset has {len(df)} rows (minimum: {min_rows}).")
        if len(df.columns) < min_cols:
            errors.append(
                f"Dataset has {len(df.columns)} columns (minimum: {min_cols})."
            )

        null_pcts = df.isnull().mean(axis=1) * 100
        malformed_rows = int((null_pcts > 50).sum())
        malformed_pct = (malformed_rows / max(len(df), 1)) * 100
        stats["malformed_rows"] = malformed_rows
        stats["malformed_pct"] = round(malformed_pct, 1)

        if malformed_pct > max_malformed_pct:
            errors.append(
                f"{malformed_pct:.0f}% of rows are malformed (>{max_malformed_pct}% threshold). "
                "Check file encoding or column alignment."
            )
        elif malformed_pct > 10:
            warnings.append(f"{malformed_pct:.0f}% of rows have >50% missing values.")

        dupes = [c for c in df.columns if list(df.columns).count(c) > 1]
        if dupes:
            warnings.append(f"Duplicate column names detected: {list(set(dupes))[:5]}")

        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "stats": stats,
        }

    def purge_stale_datasets(self, max_age_days: int = 90) -> Dict[str, Any]:
        stale = self.list_stale_datasets(max_age_days=max_age_days)
        purged = []
        for entry in stale:
            did = entry.get("id") or entry.get("dataset_id")
            if did:
                self.delete_dataset(did)
                purged.append(
                    {
                        "id": did,
                        "filename": entry.get("filename"),
                        "last_accessed_at": entry.get("last_accessed_at"),
                    }
                )
                logger.info(
                    "Purged stale dataset",
                    dataset_id=did,
                    filename=entry.get("filename"),
                )
        return {"purged_count": len(purged), "purged": purged}

    def verify_checksum(self, dataset_id: str) -> Dict[str, Any]:
        with self._lock:
            meta = self._load_meta()
            entry = meta.get(dataset_id)
        if not entry:
            return {"valid": False, "error": "Dataset not found."}

        path = Path(entry.get("path", ""))
        if not path.exists():
            return {
                "valid": False,
                "error": "File missing from disk.",
                "metadata_exists": True,
            }

        current_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        stored_hash = entry.get("checksum_sha256", "")

        return {
            "valid": current_hash == stored_hash,
            "stored_checksum": stored_hash,
            "current_checksum": current_hash,
            "dataset_id": dataset_id,
        }
