# Test Credentials

This Lumen deployment has **no user authentication** (single-user tool).
All endpoints are publicly accessible under `/api/v1/*`.

## Useful IDs
- Demo dataset (Postgres table): `sales_performance`
- Seeded via: `POST /api/v1/datasets/seed-demo`

## Env vars
- `EMERGENT_LLM_KEY` is pre-configured in `backend/.env`.
- `DATABASE_URL` points to the local Postgres instance on port 5432
  (`postgres:postgres`).
