import asyncio
import base64
import uuid
from typing import Any, Dict

from celery import Celery
from celery.utils.log import get_task_logger
from kombu import Exchange, Queue

from backend.config import settings

logger = get_task_logger(__name__)

celery_app = Celery("dip", broker=settings.CELERY_BROKER_URL, backend=settings.CELERY_RESULT_BACKEND)
celery_app.conf.update(
    task_serializer="json", result_serializer="json", accept_content=["json"],
    result_expires=7200, worker_prefetch_multiplier=4, task_acks_late=True,
    worker_max_tasks_per_child=100, task_soft_time_limit=300, task_time_limit=600,
    task_queues=(
        Queue("high", Exchange("high"), routing_key="high", queue_arguments={"x-max-priority": 10}),
        Queue("default", Exchange("default"), routing_key="default", queue_arguments={"x-max-priority": 5}),
        Queue("low", Exchange("low"), routing_key="low", queue_arguments={"x-max-priority": 1}),
    ),
    task_default_queue="default",
    task_routes={
        "backend.tasks.celery_app.task_ingest": {"queue": "high"},
        "backend.tasks.celery_app.task_query": {"queue": "high"},
        "backend.tasks.celery_app.task_process": {"queue": "default"},
        "backend.tasks.celery_app.task_insights": {"queue": "default"},
        "backend.tasks.celery_app.task_dashboard": {"queue": "default"},
        "backend.tasks.celery_app.task_report": {"queue": "low"},
        "backend.tasks.celery_app.task_pipeline": {"queue": "low"},
    },
)


def _services():
    from backend.services.cache_service import CacheService
    from backend.services.llm_service import LLMService
    from backend.services.storage_service import StorageService
    from backend.services.vector_service import VectorService
    cache = CacheService()
    llm = LLMService(cache)
    vector = VectorService()
    storage = StorageService()
    return cache, llm, vector, storage


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(bind=True, name="backend.tasks.celery_app.task_ingest",
                 max_retries=settings.CELERY_MAX_RETRIES, default_retry_delay=settings.CELERY_RETRY_BACKOFF)
def task_ingest(self, payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        self.update_state(state="PROGRESS", meta={"progress": 10, "stage": "Initializing services"})
        cache, llm, vector, storage = _services()
        if payload.get("content_b64"):
            payload["content"] = base64.b64decode(payload["content_b64"])
            del payload["content_b64"]
        self.update_state(state="PROGRESS", meta={"progress": 30, "stage": "Running ingestion agent"})
        from backend.agents.agents import IngestionAgent
        agent = IngestionAgent(cache, storage)
        result = _run(agent.execute(payload, payload.get("correlation_id", str(uuid.uuid4()))))
        if result.success:
            self.update_state(state="PROGRESS", meta={"progress": 70, "stage": "Indexing vectors"})
            schema = result.data.get("schema", {})
            _run(vector.index_dataset(payload["dataset_id"], schema, {}))
            self.update_state(state="PROGRESS", meta={"progress": 90, "stage": "Saving dataset record"})
            storage.save_dataset_record(schema)
        return {"success": result.success, "data": result.data, "error": result.error}
    except Exception as e:
        raise self.retry(exc=e, countdown=settings.CELERY_RETRY_BACKOFF * (2 ** self.request.retries))


@celery_app.task(bind=True, name="backend.tasks.celery_app.task_process",
                 max_retries=settings.CELERY_MAX_RETRIES, default_retry_delay=settings.CELERY_RETRY_BACKOFF)
def task_process(self, payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        self.update_state(state="PROGRESS", meta={"progress": 10, "stage": "Initializing"})
        cache, llm, vector, storage = _services()
        corr = payload.get("correlation_id", str(uuid.uuid4()))
        from backend.agents.agents import UnderstandingAgent, FeatureAgent
        self.update_state(state="PROGRESS", meta={"progress": 25, "stage": "Running EDA analysis"})
        eda_result = _run(UnderstandingAgent(cache).execute(payload, corr))
        self.update_state(state="PROGRESS", meta={"progress": 60, "stage": "Running feature engineering"})
        feat_result = _run(FeatureAgent(cache).execute({"dataset_id": payload["dataset_id"]}, corr))
        if eda_result.success:
            self.update_state(state="PROGRESS", meta={"progress": 85, "stage": "Indexing results"})
            schema = _run(cache.get_schema(payload["dataset_id"])) or {}
            _run(vector.index_dataset(payload["dataset_id"], schema, eda_result.data.get("summary_stats", {})))
        return {"eda": {"success": eda_result.success, "data": eda_result.data},
                "feature": {"success": feat_result.success, "data": feat_result.data}}
    except Exception as e:
        raise self.retry(exc=e, countdown=settings.CELERY_RETRY_BACKOFF * (2 ** self.request.retries))


@celery_app.task(bind=True, name="backend.tasks.celery_app.task_insights",
                 max_retries=settings.CELERY_MAX_RETRIES, default_retry_delay=settings.CELERY_RETRY_BACKOFF)
def task_insights(self, payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        cache, llm, vector, storage = _services()
        from backend.agents.agents import InsightAgent
        result = _run(InsightAgent(cache, llm).execute(payload, payload.get("correlation_id", str(uuid.uuid4()))))
        return {"success": result.success, "data": result.data, "error": result.error}
    except Exception as e:
        raise self.retry(exc=e, countdown=settings.CELERY_RETRY_BACKOFF * (2 ** self.request.retries))


@celery_app.task(bind=True, name="backend.tasks.celery_app.task_query",
                 max_retries=2, default_retry_delay=10)
def task_query(self, payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        self.update_state(state="PROGRESS", meta={"progress": 15, "stage": "Preparing query context"})
        cache, llm, vector, storage = _services()
        from backend.agents.agents import QueryAgent
        self.update_state(state="PROGRESS", meta={"progress": 40, "stage": "Executing query agent"})
        result = _run(QueryAgent(cache, llm, vector).execute(payload, payload.get("correlation_id", str(uuid.uuid4()))))
        return {"success": result.success, "data": result.data, "error": result.error}
    except Exception as e:
        raise self.retry(exc=e, countdown=10 * (2 ** self.request.retries))


@celery_app.task(bind=True, name="backend.tasks.celery_app.task_dashboard",
                 max_retries=settings.CELERY_MAX_RETRIES, default_retry_delay=settings.CELERY_RETRY_BACKOFF)
def task_dashboard(self, payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        cache, llm, vector, storage = _services()
        from backend.agents.agents import VisualizationAgent
        result = _run(VisualizationAgent(cache, llm).execute(payload, payload.get("correlation_id", str(uuid.uuid4()))))
        return {"success": result.success, "data": result.data, "error": result.error}
    except Exception as e:
        raise self.retry(exc=e, countdown=settings.CELERY_RETRY_BACKOFF * (2 ** self.request.retries))


@celery_app.task(bind=True, name="backend.tasks.celery_app.task_report",
                 max_retries=settings.CELERY_MAX_RETRIES, default_retry_delay=settings.CELERY_RETRY_BACKOFF,
                 soft_time_limit=480, time_limit=600)
def task_report(self, payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        cache, llm, vector, storage = _services()
        from backend.agents.agents import ReportAgent
        result = _run(ReportAgent(cache, llm).execute(payload, payload.get("correlation_id", str(uuid.uuid4()))))
        return {"success": result.success, "data": result.data, "error": result.error}
    except Exception as e:
        raise self.retry(exc=e, countdown=settings.CELERY_RETRY_BACKOFF * (2 ** self.request.retries))


@celery_app.task(bind=True, name="backend.tasks.celery_app.task_pipeline",
                 max_retries=1, soft_time_limit=540, time_limit=600)
def task_pipeline(self, payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        cache, llm, vector, storage = _services()
        from backend.agents.orchestrator.orchestrator_agent import OrchestratorAgent
        result = _run(OrchestratorAgent(cache, llm, vector, storage).execute(
            payload, payload.get("correlation_id", str(uuid.uuid4()))
        ))
        return {"success": result.success, "data": result.data, "error": result.error}
    except Exception as e:
        raise self.retry(exc=e, countdown=60)
