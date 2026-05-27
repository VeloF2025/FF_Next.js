-- scripts/migrations/sql/379_vlm_bench_runs.sql
CREATE TABLE IF NOT EXISTS vlm_bench_runs (
  id            BIGSERIAL PRIMARY KEY,
  mode          TEXT NOT NULL CHECK (mode IN ('golden','live')),
  model         TEXT NOT NULL,
  git_sha       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('ok','infra_error')),
  started_at    TIMESTAMPTZ NOT NULL,
  pack_scores   JSONB NOT NULL,        -- [{packId,total,scored,errors,passed,scorePct}]
  live_snapshot JSONB,                 -- [{packId, caseIds:[...]}] for replay (Plan 2)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vlm_bench_runs_model_started ON vlm_bench_runs (model, started_at DESC);
