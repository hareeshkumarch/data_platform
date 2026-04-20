"""Supervisor entry — re-exports the FastAPI app from ``backend.main``."""
import os
import sys

# Ensure the /app root is on PYTHONPATH so ``backend.*`` imports resolve.
APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)

from backend.main import app  # noqa: E402,F401 — re-exported for uvicorn

__all__ = ["app"]
