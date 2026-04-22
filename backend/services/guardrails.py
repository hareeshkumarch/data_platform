from __future__ import annotations
import re
from typing import Any, Dict, Tuple

from backend.utils.logger import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# SQL / Code Injection Patterns
# ---------------------------------------------------------------------------
_DANGEROUS_SQL = re.compile(
    r"\b(DROP|DELETE|TRUNCATE|ALTER|INSERT|UPDATE|EXEC|EXECUTE|GRANT|REVOKE|SHUTDOWN|xp_|sp_)\b",
    re.IGNORECASE,
)
_DANGEROUS_CODE = re.compile(
    r"(import\s+os|import\s+sys|import\s+subprocess|__import__|eval\s*\(|exec\s*\("
    r"|open\s*\(|__builtins__|shutil|socket|requests\.get|urllib)",
    re.IGNORECASE,
)
_PROMPT_INJECTION = re.compile(
    r"(ignore\s+(previous|prior|above|all)\s+instructions?|"
    r"forget\s+(everything|your|all)|"
    r"you\s+are\s+now|new\s+persona|act\s+as\s+if|"
    r"disregard\s+(your|all)|system\s*:\s*you)",
    re.IGNORECASE,
)
_MAX_QUESTION_LEN = 1000
_MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # 500 MB
_ALLOWED_EXTENSIONS = {"csv", "json", "parquet", "xlsx", "xls"}
_ALLOWED_MIME = {
    "text/csv",
    "application/json",
    "application/octet-stream",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


# ---------------------------------------------------------------------------
# Input Guardrails
# ---------------------------------------------------------------------------


class InputGuardrails:
    @staticmethod
    def validate_question(question: str) -> Tuple[bool, str]:
        if not question or not question.strip():
            return False, "Question cannot be empty."
        if len(question) > _MAX_QUESTION_LEN:
            return False, f"Question exceeds {_MAX_QUESTION_LEN} character limit."
        if _PROMPT_INJECTION.search(question):
            logger.warning("Prompt injection attempt detected", question=question[:100])
            return False, "Question contains disallowed patterns."
        return True, ""

    @staticmethod
    def validate_file_upload(
        filename: str, size_bytes: int, content_type: str = ""
    ) -> Tuple[bool, str]:
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if ext not in _ALLOWED_EXTENSIONS:
            return (
                False,
                f"File type '.{ext}' not supported. Allowed: {', '.join(_ALLOWED_EXTENSIONS)}",
            )
        if size_bytes > _MAX_UPLOAD_BYTES:
            return (
                False,
                f"File size {size_bytes / 1024 / 1024:.1f}MB exceeds 500MB limit.",
            )
        if content_type and not any(ct in content_type for ct in _ALLOWED_MIME):
            logger.warning("Unexpected MIME type", mime=content_type, file=filename)
        return True, ""

    @staticmethod
    def validate_sql_query(query: str) -> Tuple[bool, str]:
        if _DANGEROUS_SQL.search(query):
            return (
                False,
                "SQL query contains disallowed statements (DROP, DELETE, ALTER, etc.).",
            )
        if len(query) > 5000:
            return False, "SQL query exceeds 5000 character limit."
        return True, ""

    @staticmethod
    def validate_connection_string(conn_str: str) -> Tuple[bool, str]:
        allowed_schemes = {
            "postgresql",
            "mysql",
            "sqlite",
            "mssql",
            "postgresql+psycopg2",
        }
        scheme = conn_str.split("://")[0].lower() if "://" in conn_str else ""
        if scheme not in allowed_schemes:
            return (
                False,
                f"Database scheme '{scheme}' not allowed. Supported: {allowed_schemes}",
            )
        return True, ""

    @staticmethod
    def validate_dataset_id(dataset_id: str) -> Tuple[bool, str]:
        if not re.match(r"^[a-zA-Z0-9_\-]{8,64}$", dataset_id):
            return False, "Invalid dataset_id format."
        return True, ""

    @staticmethod
    def sanitize_column_name(name: str) -> str:
        return re.sub(r"[^\w]", "_", str(name))[:128]

    @staticmethod
    def validate_chart_type(chart_type: str) -> Tuple[bool, str]:
        from backend.models.schemas import ChartType

        valid = {ct.value for ct in ChartType}
        if chart_type not in valid:
            return False, f"Unknown chart type '{chart_type}'. Valid: {sorted(valid)}"
        return True, ""


# ---------------------------------------------------------------------------
# LLM Output Guardrails
# ---------------------------------------------------------------------------


class OutputGuardrails:
    @staticmethod
    def validate_generated_code(code: str) -> Tuple[bool, str]:
        if not code or not code.strip():
            return False, "Generated code is empty."
        if _DANGEROUS_CODE.search(code):
            logger.warning("Dangerous code pattern in LLM output", snippet=code[:200])
            return False, "Generated code contains disallowed operations."
        if "result_df" not in code:
            return False, "Generated code must assign output to 'result_df'."
        if len(code) > 10_000:
            return False, "Generated code exceeds length limit."
        return True, ""

    @staticmethod
    def validate_insight_output(data: Dict[str, Any]) -> Tuple[bool, str]:
        if "insights" not in data:
            return False, "Missing 'insights' key in LLM response."
        if not isinstance(data["insights"], list):
            return False, "'insights' must be a list."
        for i, ins in enumerate(data["insights"]):
            for key in ("category", "title", "description"):
                if key not in ins:
                    return False, f"Insight [{i}] missing required key '{key}'."
        return True, ""

    @staticmethod
    def validate_chart_output(data: Dict[str, Any]) -> Tuple[bool, str]:
        required = {"chart", "title"}
        missing = required - data.keys()
        if missing:
            return False, f"Chart output missing keys: {missing}"
        from backend.models.schemas import ChartType

        valid = {ct.value for ct in ChartType}
        if data.get("chart") not in valid:
            return False, f"Invalid chart type '{data.get('chart')}' in LLM output."
        return True, ""

    @staticmethod
    def validate_json_parseable(text: str) -> Tuple[bool, str]:
        from backend.services.llm_service import LLMService

        try:
            LLMService.extract_json(text)
            return True, ""
        except Exception as e:
            return False, f"LLM response is not valid JSON: {e}"

    @staticmethod
    def clamp_confidence(value: Any) -> float:
        try:
            return max(0.0, min(1.0, float(value)))
        except Exception:
            return 0.5

    @staticmethod
    def clamp_priority(value: Any, max_val: int = 10) -> int:
        try:
            return max(1, min(max_val, int(value)))
        except Exception:
            return 5


# ---------------------------------------------------------------------------
# Rate Limiter (per-endpoint, per-IP)
# ---------------------------------------------------------------------------


class RateLimiter:
    LIMITS = {
        "upload": (10, 3600),
        "query": (60, 3600),
        "insights": (20, 3600),
        "chart": (100, 3600),
        "report": (5, 3600),
        "default": (200, 3600),
    }

    def __init__(self, cache):
        self._cache = cache

    async def check(self, endpoint: str, identifier: str) -> Tuple[bool, str]:
        limit, window = self.LIMITS.get(endpoint, self.LIMITS["default"])
        key = f"{endpoint}:{identifier}"
        allowed = await self._cache.check_rate_limit(key, limit, window)
        if not allowed:
            return (
                False,
                f"Rate limit exceeded for {endpoint}. Limit: {limit} req/{window}s.",
            )
        return True, ""
