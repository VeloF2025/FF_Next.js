-- Migration: 460_qfield_pole_pon_cache.sql
-- Description: Cache of resolved pole->PON design maps for the QField audit
--              reconciliation report. One row per (project, design-GPKG version);
--              payload is the resolver output. Read cache only — never a source of truth.
-- Created: 2026-07-24

BEGIN;

CREATE TABLE IF NOT EXISTS qfield_pole_pon_cache (
  project_id   UUID        NOT NULL,
  gpkg_version TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  resolved_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, gpkg_version)
);

COMMIT;
