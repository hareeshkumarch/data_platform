# Product Prioritized Fix Plan (UI/UX + Backend Honest Evaluation)

## Purpose

This document converts the current product evaluation into a concrete execution plan.
It is intentionally blunt and practical: what to fix first, what to keep, what to postpone, and how to measure progress.

## Product Snapshot (Current State)

The platform is already strong in scope and architecture:

- Multi-surface workflow is valuable: `Insights` + `DataCleaning` + `Query` + `PowerBI`.
- Visual quality is modern and mostly consistent.
- App shell structure is solid (`AppShell`, `AppSidebar`, `TopBar`).

Main risk today is **cognitive overload**, not lack of features.
The product feels powerful but busy, especially on dense screens.

## Recently Fixed (Removed from Active Backlog)

These items were completed and are no longer treated as pending priorities:

- Prompt templates now use internal-only reasoning instructions (no visible `<thinking>` output requirement).
- Prompt trust-boundary rules were added so untrusted question/schema/sample/RAG content is treated as data, not instructions.
- Query prompt now has an explicit insufficient-data fallback contract (safe empty result + low confidence behavior).
- Untrusted text sanitization was added in prompt builders for query/viz inputs.

- Naming/IA consistency (Analytics Studio).
- Toast unification (Sonner only).
- Platform shortcut fix for Windows/macOS.
- Query overload reduction (state simplification and reduced CTAs).
- Destructive action safety for conversation deletion.
- **P1.5 Visual Noise Reduction:** Simplified BrandMark (removed animated glow/rotate), removed KPI tile decorative gradients, slowed pipeline animation pulse.
- **P1.6 Typography & Readability:** Bumped all 10px/11px text in TopBar, QueryHistory, Query pipeline/agent summary/tables, Analytics badges/relationships/hierarchy, Insights metric cards/table headers, DataCleaning labels/badges.
- **P1.8 Error/Empty States:** Added actionable empty states with guidance text in Analytics (EmptyCard), Insights (column profile), DataCleaning (no dataset selected).
- **B1 Async Job Execution:** Added `BackgroundJobManager` with thread-pool/async support, auto-pruning, status polling via `/jobs/{job_id}` endpoint.
- **B2 Analytical Trust:** Added confidence intervals (R², CI bounds, warnings) to forecast endpoint; added method metadata, stats, and confidence levels to anomaly endpoint. Added input validation bounds.
- **B3 Redis-ready Cache:** Added `RedisCacheService` with full API parity + `get_cache()` factory; added `REDIS_URL`/`CACHE_BACKEND` config.
- **B4 API Contract Standardization:** Added `StandardResponse` and `StandardErrorResponse` Pydantic models; added input validation for `periods`/`threshold` params.
- **B5 Observability:** Enhanced startup logging with cache_backend/thread_pool_size; added PostgreSQL bootstrap confirmation; improved shutdown event.
- **B6 Storage Lifecycle:** Added SHA-256 checksum tracking, `created_at`/`last_accessed_at` timestamps, `list_stale_datasets()`, `get_storage_stats()`.
- **B7 Rate Limiting:** Complete rewrite with per-user/token buckets, env-driven limits (`RATE_LIMIT_*`), proxy-safe identity, structured 429 responses.
- **G1 Endpoint Monolith:** Added detailed architecture split plan as TODO markers in `endpoints.py`.
- **G2 Execution Bounds:** Added configurable `CODE_EXEC_TIMEOUT_SEC` and `CODE_EXEC_MAX_ROWS` settings, wired into sandbox.
- **P2.9 Command Palette:** Wired dynamic dataset search, conversation search, and cross-page navigation into CommandPalette; TopBar search now opens the palette.
- **P2.10 Trust/Evidence Layer:** Added confidence score badges (color-coded), row-count provenance, cached indicator, and model name to query result messages.
- **P2.12 DataCleaning Productivity:** Added "Select All" batch button with count, enhanced "Clear" with count indicator.
- **P3 Motion Tuning:** Slowed decorative animations (float 6→8s, glow-ring 2.2→3s, gradient-shift 8→12s) for calmer UI.
- **B8 Query Router:** Made `QUERY_MAX_RETRIES` configurable via settings (default: 3).
- **B9 Self-Healing Execution:** Made retry count and temperature escalation (`QUERY_RETRY_TEMP_ESCALATION`) configurable.
- **B10 Session Memory:** Made `SESSION_MEMORY_MAX_TURNS` and `SESSION_MEMORY_TTL` configurable; added `/conversations/{id}/reset-context` endpoint for user-facing context reset.
- **G3 Data Lifecycle:** Added `validate_upload()` with schema sanity checks (size, extension, parse, malformed-row threshold, duplicate columns); wired into upload endpoint with 422 rejection. Added `purge_stale_datasets()` and `verify_checksum()`. Added admin endpoints: `/datasets/stale`, `/datasets/storage-stats`, `/datasets/{id}/verify-checksum`, `/datasets/purge-stale`.
- **G4 Quality Gates:** Created `tests/conftest.py` with shared fixtures and `tests/test_contracts.py` with 14 contract tests covering response schemas, upload validation, checksum verification, configuration defaults, and storage lifecycle.

---

## Status Summary

All P0, P1, P2, P3, BP0, BP1, BP2, G1–G4 items have been completed.

- **P0 — Must Fix Now:** ✅ Complete
- **P1 — High Priority Improvements:** ✅ Complete
- **P2 — Feature Improvements:** ✅ Complete (P2.11 PowerBI skipped — file does not exist)
- **P3 — Nice to Have:** ✅ Complete
- **BP0 — Must Fix Now (Backend):** ✅ Complete
- **BP1 — High Priority (Backend):** ✅ Complete
- **BP2 — Feature/Architecture Upgrades:** ✅ Complete
- **G1–G4 — Critical Gaps:** ✅ Complete

---

## Features to Keep (Do Not Remove)

- Unified shell structure (`AppShell`, sidebar, topbar).
- Insights page direction and compact dataset health framing.
- Multi-surface analytics workflow concept (major product strength).

---

## BP3 — Nice to Have (Future)

- Dedicated LLM gateway/proxy for cost/routing governance.
- Deeper confidence calibration for insights output.
- Advanced statistical model registry/versioning for reproducibility.

---

## Final "No-Skip" Go-Live Checklist

Use this as strict go/no-go criteria.

- [x] P0 UI items complete (`Query` simplification, IA naming consistency, toast unification, OS shortcut correctness).
- [x] P1 UI items complete (visual noise reduction, typography pass, actionable empty states).
- [x] P2 UI items complete (command palette wiring, trust/evidence layer, cleaning batch apply).
- [x] P3 Motion/polish complete (decorative animation tuning).
- [x] BP0 backend items complete (async heavy jobs, analytics trust metadata, shared cache strategy, API contracts).
- [x] BP1 backend items complete (observability, storage lifecycle, rate limiting).
- [x] BP2 backend items complete (query router config, self-healing config, session memory endpoints).
- [x] Endpoint monolith split plan documented with architecture TODO markers.
- [x] Execution-path reliability bounds configurable (`CODE_EXEC_TIMEOUT_SEC`, `CODE_EXEC_MAX_ROWS`).
- [x] G3 Data lifecycle quality controls (upload validation, retention purge, checksum verification).
- [x] G4 Release quality gates (test suite with 14 contract tests).
- [ ] Observability dashboards and alerts deployed in monitoring system.
- [ ] Load test baseline and rollback playbook approved.

If any checkbox is open, treat launch as **at risk**.
