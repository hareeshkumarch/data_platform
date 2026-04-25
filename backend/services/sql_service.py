from __future__ import annotations

import csv
import io
import random
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import (
    Column,
    DateTime,
    Integer,
    JSON,
    MetaData,
    String,
    Table,
    create_engine,
    text,
)
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from backend.config import settings
from backend.utils.logger import get_logger

logger = get_logger(__name__)

_READ_ONLY_PREFIXES = ("select", "with", "show", "explain")
_DANGEROUS_KEYWORDS = frozenset(
    {
        "insert",
        "update",
        "delete",
        "drop",
        "alter",
        "truncate",
        "grant",
        "revoke",
        "create",
        "merge",
        "call",
        "do",
        "copy",
        "vacuum",
        "reindex",
        "cluster",
        "lock",
    }
)
_NO_LIMIT_PREFIXES = ("show", "explain")


def _extract_sql_tokens(sql: str) -> list[str]:
    without_block = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    without_line = re.sub(r"--[^\n]*", " ", without_block)

    without_strings = re.sub(r"'(?:''|[^'])*'", " 'str' ", without_line)
    without_strings = re.sub(r'"(?:""|[^"])*"', ' "id" ', without_strings)
    return [t.lower() for t in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", without_strings)]


class SQLWarehouse:
    _instance: "SQLWarehouse | None" = None
    _metadata = MetaData()

    datasets = Table(
        "datasets",
        _metadata,
        Column("id", String(128), primary_key=True),
        Column("name", String(256), nullable=False),
        Column("filename", String(512), nullable=True),
        Column("source_type", String(32), nullable=False),
        Column("size_bytes", Integer, default=0),
        Column("row_count", Integer, default=0),
        Column("col_count", Integer, default=0),
        Column("schema_json", JSON, nullable=True),
        Column("created_at", DateTime, nullable=True),
    )

    conversations = Table(
        "conversations",
        _metadata,
        Column("id", String(128), primary_key=True),
        Column("title", String(256), nullable=False),
        Column("mode", String(32), nullable=False),
        Column("updated_at", DateTime, nullable=False),
        Column("messages_json", JSON, nullable=False),
    )

    @classmethod
    def get(cls) -> "SQLWarehouse":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self) -> None:
        self.enabled = False
        self.engine: Optional[Engine] = None
        try:
            self.engine = create_engine(
                settings.DATABASE_URL, pool_pre_ping=True, future=True
            )
            with self.engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            self.enabled = True
            logger.info(
                "SQL warehouse connected", url=settings.DATABASE_URL.split("@")[-1]
            )
        except Exception as exc:
            logger.warning(
                "SQL warehouse unavailable — SQL executor disabled", error=str(exc)
            )
            self.engine = None

    def bootstrap(self) -> None:
        if not self.enabled or self.engine is None:
            return
        self._metadata.create_all(self.engine)
        self._seed_sales_performance()

    def _seed_sales_performance(self) -> None:
        assert self.engine is not None
        with self.engine.begin() as conn:
            conn.execute(text())
            count = (
                conn.execute(text("SELECT COUNT(*) FROM sales_performance")).scalar()
                or 0
            )
            if count > 0:
                return
            rows = _generate_sales_rows()
            conn.execute(
                text(
                    "INSERT INTO sales_performance (region, product, segment, month, revenue, cost, customers) "
                    "VALUES (:region, :product, :segment, :month, :revenue, :cost, :customers)"
                ),
                rows,
            )
            logger.info("Seeded sales_performance", rows=len(rows))

    def execute(self, query: str, limit: int = 500) -> Dict[str, Any]:
        if not self.enabled or self.engine is None:
            raise RuntimeError("SQL warehouse is not configured on this deployment.")
        stripped = query.strip().rstrip(";")
        if not stripped:
            raise ValueError("Empty query.")
        if ";" in stripped:
            raise ValueError("Multiple statements are not permitted.")

        lower = stripped.lower()
        if not any(lower.startswith(p) for p in _READ_ONLY_PREFIXES):
            raise ValueError("Only SELECT/WITH/SHOW/EXPLAIN statements are permitted.")

        tokens = _extract_sql_tokens(stripped)
        offending = _DANGEROUS_KEYWORDS.intersection(tokens)
        if offending:
            raise ValueError(
                f"Query contains disallowed keyword(s): {', '.join(sorted(offending))}"
            )

        skip_limit = any(lower.startswith(p) for p in _NO_LIMIT_PREFIXES)
        has_limit = bool(re.search(r"\blimit\b", lower))
        effective = (
            stripped
            if skip_limit or has_limit
            else f"{stripped} LIMIT {max(1, min(limit, 5000))}"
        )
        with self.engine.connect() as conn:
            result = conn.execute(text(effective))
            columns = list(result.keys())
            rows = [
                dict(zip(columns, map(_jsonable, row)))
                for row in result.fetchmany(limit)
            ]
        return {"columns": columns, "rows": rows, "row_count": len(rows)}

    def list_tables(self) -> List[Dict[str, Any]]:
        if not self.enabled or self.engine is None:
            return []
        with self.engine.connect() as conn:
            rows = conn.execute(text()).fetchall()
        return [{"name": r[0], "columns": int(r[1] or 0)} for r in rows]

    def describe_table(self, table_name: str) -> Dict[str, Any]:
        if not self.enabled or self.engine is None:
            raise RuntimeError("SQL warehouse is not configured on this deployment.")
        safe = "".join(c for c in table_name if c.isalnum() or c == "_")
        if safe != table_name:
            raise ValueError("Invalid table name.")
        with self.engine.connect() as conn:
            cols = conn.execute(
                text(),
                {"t": safe},
            ).fetchall()
            count = conn.execute(text(f"SELECT COUNT(*) FROM {safe}")).scalar() or 0
        return {
            "table": safe,
            "row_count": int(count),
            "columns": [
                {"name": c[0], "type": c[1], "nullable": c[2] == "YES"} for c in cols
            ],
        }

    def upsert_dataset_record(self, record: Dict[str, Any]) -> None:
        if not self.enabled or self.engine is None:
            return
        values = {
            "id": record["id"],
            "name": record.get("name") or record.get("filename") or record["id"],
            "filename": record.get("filename"),
            "source_type": record.get("source_type", "file"),
            "size_bytes": int(record.get("size_bytes", 0) or 0),
            "row_count": int(record.get("row_count", 0) or 0),
            "col_count": int(record.get("col_count", 0) or 0),
            "schema_json": record.get("schema_json"),
            "created_at": record.get("created_at"),
        }
        try:
            try:
                from sqlalchemy.dialects.postgresql import insert as pg_insert

                stmt = pg_insert(self.datasets).values(**values)
                stmt = stmt.on_conflict_do_update(
                    index_elements=[self.datasets.c.id],
                    set_={k: v for k, v in values.items() if k != "id"},
                )
                with self.engine.begin() as conn:
                    conn.execute(stmt)
            except Exception:
                with self.engine.begin() as conn:
                    conn.execute(
                        text("DELETE FROM datasets WHERE id = :id"),
                        {"id": values["id"]},
                    )
                    conn.execute(self.datasets.insert(), values)
        except SQLAlchemyError as exc:
            logger.warning("dataset upsert failed", error=str(exc))


def _generate_sales_rows(count: int = 260) -> List[Dict[str, Any]]:
    random.seed(7)
    regions = ["North", "South", "East", "West"]
    products = ["Aurora", "Nebula", "Pulsar", "Quasar"]
    segments = ["Enterprise", "SMB", "Startup"]
    start = date(2024, 1, 1)
    rows: List[Dict[str, Any]] = []
    for i in range(count):
        month = start + timedelta(days=(i % 12) * 30)
        revenue = round(random.uniform(18_000, 125_000), 2)
        cost = round(revenue * random.uniform(0.35, 0.72), 2)
        rows.append(
            {
                "region": random.choice(regions),
                "product": random.choice(products),
                "segment": random.choice(segments),
                "month": month,
                "revenue": revenue,
                "cost": cost,
                "customers": random.randint(40, 480),
            }
        )
    return rows


def _jsonable(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", errors="ignore")
    try:
        import decimal

        if isinstance(value, decimal.Decimal):
            return float(value)
    except Exception:
        pass
    return value


def export_table_as_csv(table: str) -> bytes:
    warehouse = SQLWarehouse.get()
    if not warehouse.enabled or warehouse.engine is None:
        raise RuntimeError("SQL warehouse is not configured.")
    safe = "".join(c for c in table if c.isalnum() or c == "_")
    with warehouse.engine.connect() as conn:
        result = conn.execute(text(f"SELECT * FROM {safe}"))
        columns = list(result.keys())
        rows = result.fetchall()
    buf = io.StringIO()
    writer = csv.writer(buf)
    if columns:
        writer.writerow(columns)
    for row in rows:
        writer.writerow([_jsonable(v) for v in row])
    return buf.getvalue().encode("utf-8")


def ensure_sample_csv_on_disk() -> Path:
    target = Path(settings.UPLOAD_DIR) / "_demo_sales.csv"
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.stat().st_size > 0:
        return target
    target.write_bytes(export_table_as_csv("sales_performance"))
    return target
