from __future__ import annotations
import io
import json
from typing import Any, Dict, List

import pandas as pd

from backend.utils.logger import get_logger

logger = get_logger(__name__)


class ExportService:

    @staticmethod
    def to_csv(rows: List[Dict], columns: List[str] = None) -> bytes:
        df = pd.DataFrame(rows)
        if columns:
            df = df[[c for c in columns if c in df.columns]]
        buf = io.BytesIO()
        df.to_csv(buf, index=False)
        return buf.getvalue()

    @staticmethod
    def to_excel(rows: List[Dict], sheet_name: str = "Data") -> bytes:
        df = pd.DataFrame(rows)
        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name=sheet_name, index=False)
        return buf.getvalue()

    @staticmethod
    def to_json(data: Any) -> bytes:
        return json.dumps(data, indent=2, default=str).encode("utf-8")

    @staticmethod
    def insights_to_markdown(insights_data: Dict) -> bytes:
        lines = ["# Data Intelligence Report\n"]
        summary = insights_data.get("executive_summary", "")
        if summary:
            lines.append(f"## Executive Summary\n\n{summary}\n")
        lines.append("## Insights\n")
        for i, ins in enumerate(insights_data.get("insights", []), 1):
            lines.append(f"### {i}. {ins.get('title','')}")
            lines.append(f"**Category:** {ins.get('category','')} | **Confidence:** {ins.get('confidence',0):.0%} | **Priority:** {ins.get('priority','')}\n")
            lines.append(f"{ins.get('description','')}\n")
            actions = ins.get("action_items", [])
            if actions:
                lines.append("**Actions:**")
                for a in actions:
                    lines.append(f"- {a}")
            lines.append("")
        return "\n".join(lines).encode("utf-8")
