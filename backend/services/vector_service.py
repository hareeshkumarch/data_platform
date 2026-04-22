from __future__ import annotations
import asyncio
import json
import pickle
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np

from backend.config import settings
from backend.models.schemas import RAGDocument
from backend.utils.logger import get_logger

logger = get_logger(__name__)

try:
    import faiss as _faiss  # noqa: F401

    _FAISS_AVAILABLE = True
except ModuleNotFoundError:
    _FAISS_AVAILABLE = False
    logger.warning(
        "faiss not installed — RAG retrieval disabled, LLM will answer from schema/stats context only"
    )


class EmbeddingService:
    def __init__(self):
        self._gemini = None

    async def embed(self, texts: List[str]) -> List[List[float]]:
        return await self._embed_hash(texts)

    async def embed_one(self, text: str) -> List[float]:
        return (await self.embed([text]))[0]

    async def _embed_gemini(self, texts: List[str]) -> List[List[float]]:
        results = []
        for text in texts:
            resp = await asyncio.to_thread(
                self._gemini.embed_content,
                model="models/text-embedding-004",
                content=text,
                task_type="retrieval_document",
            )
            results.append(resp["embedding"])
        return results

    async def _embed_hash(self, texts: List[str]) -> List[List[float]]:
        import hashlib

        def _hash(text: str) -> List[float]:
            digest = hashlib.sha256(text.encode()).digest()
            floats = [b / 255.0 for b in digest]
            while len(floats) < 768:
                floats.extend(floats)
            return floats[:768]

        return await asyncio.to_thread(lambda: [_hash(t) for t in texts])


class FAISSStore:
    def __init__(self):
        self._indexes: Dict[str, Any] = {}
        self._docs: Dict[str, List[RAGDocument]] = {}
        self._dir = Path(settings.FAISS_INDEX_PATH)
        self._dir.mkdir(parents=True, exist_ok=True)

    def _load(self, dataset_id: str):
        idx_path = self._dir / f"{dataset_id}.index"
        doc_path = self._dir / f"{dataset_id}.docs"
        if idx_path.exists() and doc_path.exists():
            import faiss

            self._indexes[dataset_id] = faiss.read_index(str(idx_path))
            with open(doc_path, "rb") as f:
                self._docs[dataset_id] = pickle.load(f)

    def _persist(self, dataset_id: str):
        import faiss

        faiss.write_index(
            self._indexes[dataset_id], str(self._dir / f"{dataset_id}.index")
        )
        with open(self._dir / f"{dataset_id}.docs", "wb") as f:
            pickle.dump(self._docs[dataset_id], f)

    async def add(self, dataset_id: str, docs: List[RAGDocument]):
        if not _FAISS_AVAILABLE:
            return

        def _run():
            import faiss

            vecs = np.array(
                [d.embedding for d in docs if d.embedding], dtype=np.float32
            )
            if not len(vecs):
                return
            faiss.normalize_L2(vecs)

            # Reload persisted index from disk before appending so a backend
            # restart doesn't wipe out an existing FAISS index for this
            # dataset. Previously the in-memory check treated a fresh
            # process as "no prior index" and overwrote disk on ``_persist``.
            if dataset_id not in self._indexes:
                self._load(dataset_id)
            if dataset_id not in self._indexes:
                self._indexes[dataset_id] = faiss.IndexFlatIP(vecs.shape[1])
                self._docs[dataset_id] = []
            elif self._indexes[dataset_id].d != vecs.shape[1]:
                # Embedding dimension changed (e.g. different embedder). Reset
                # rather than raise — keeps ingestion flowing.
                logger.warning(
                    "FAISS dim mismatch — rebuilding index",
                    dataset_id=dataset_id,
                    existing=self._indexes[dataset_id].d,
                    incoming=int(vecs.shape[1]),
                )
                self._indexes[dataset_id] = faiss.IndexFlatIP(vecs.shape[1])
                self._docs[dataset_id] = []

            self._indexes[dataset_id].add(vecs)
            self._docs[dataset_id].extend(docs)
            self._persist(dataset_id)

        await asyncio.to_thread(_run)

    async def search(
        self, dataset_id: str, query_vec: List[float], top_k: int = 5
    ) -> List[Tuple[RAGDocument, float]]:
        if not _FAISS_AVAILABLE:
            return []

        def _run():
            import faiss

            if dataset_id not in self._indexes:
                self._load(dataset_id)
            if dataset_id not in self._indexes:
                return []
            vec = np.array([query_vec], dtype=np.float32)
            faiss.normalize_L2(vec)
            idx = self._indexes[dataset_id]
            k = min(top_k, idx.ntotal)
            if k == 0:
                return []
            scores, idxs = idx.search(vec, k)
            docs = self._docs.get(dataset_id, [])
            return [
                (docs[i], float(s))
                for s, i in zip(scores[0], idxs[0])
                if 0 <= i < len(docs)
            ]

        return await asyncio.to_thread(_run)


class VectorService:
    def __init__(self):
        self._embedder = EmbeddingService()
        self._store = FAISSStore()

    async def index_dataset(
        self, dataset_id: str, schema: Dict, stats: Dict, insights: List[str] = None
    ):
        docs: List[RAGDocument] = []

        docs.append(
            RAGDocument(
                dataset_id=dataset_id,
                content=f"Dataset schema: {json.dumps(schema, indent=2)[:2000]}",
                doc_type="schema",
                metadata={"type": "schema"},
            )
        )
        for col in schema.get("columns", []):
            docs.append(
                RAGDocument(
                    dataset_id=dataset_id,
                    content=(
                        f"Column '{col['name']}': type={col['inferred_type']}, "
                        f"unique={col['unique_count']}, nulls={col['null_pct']}%, "
                        f"samples={col.get('sample_values', [])[:3]}"
                    ),
                    doc_type="column",
                    metadata={"column": col["name"]},
                )
            )
        if stats:
            docs.append(
                RAGDocument(
                    dataset_id=dataset_id,
                    content=f"Statistics: {json.dumps(stats)[:2000]}",
                    doc_type="stats",
                    metadata={},
                )
            )
        for i, text in enumerate(insights or []):
            docs.append(
                RAGDocument(
                    dataset_id=dataset_id,
                    content=text,
                    doc_type="insight",
                    metadata={"index": i},
                )
            )

        embeddings = await self._embedder.embed([d.content for d in docs])
        for doc, emb in zip(docs, embeddings):
            doc.embedding = emb
        await self._store.add(dataset_id, docs)
        logger.info("RAG index built", dataset_id=dataset_id, docs=len(docs))

    async def retrieve(self, dataset_id: str, query: str, top_k: int = 5) -> str:
        q_emb = await self._embedder.embed_one(query)
        results = await self._store.search(dataset_id, q_emb, top_k=top_k * 2)
        if not results:
            return "No context available."

        q_tokens = set(query.lower().split())
        reranked = []
        for doc, vec_score in results:
            kw = len(q_tokens & set(doc.content.lower().split())) / max(
                len(q_tokens), 1
            )
            reranked.append((doc, 0.7 * vec_score + 0.3 * kw))
        reranked.sort(key=lambda x: x[1], reverse=True)

        return "\n\n".join(
            f"[Context {i + 1} | score={s:.2f}]\n{doc.content}"
            for i, (doc, s) in enumerate(reranked[:top_k])
        )
