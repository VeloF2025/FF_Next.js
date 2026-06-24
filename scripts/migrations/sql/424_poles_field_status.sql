-- Migration 424: add poles.field_status (+ synced_at) to carry the QField civil-audit
-- "Status" into the queryable DB.
-- (version = max(DB 416, file 423) + 1.)
--
-- The civil-audit pole Status (e.g. "Pole Planted/ All Photos", "Pole Planted - Photos
-- Incomplete", "(ADMIN) Q/A Passed", "Q/A Failed", "Pole Removed/Canceled") lives ONLY in
-- the project GPKGs (MOAPoles.gpkg, PolesAudit.gpkg, ...). The GPKG import maps
-- pole_planted (date) but drops Status entirely, so the Works QA PON overview can only see
-- "planned" (sow_poles) and "photographed/QA'd" (pole_qa_photos) — never the field-planted
-- stage in between. Verified live: Mohadin PON 223 = 50 planned, but only ~4 planted /
-- 1 removed / 45 not-started, a gap invisible to the dashboard today.
--
-- field_status holds the raw GPKG Status string (NULL = not yet planted/captured);
-- field_status_synced_at records when the inbound sync last touched the row.
-- Populated by scripts/sync-qfield-status-to-ff.py (read-only inbound mirror of
-- sync-qa-to-qfield.py). Additive + idempotent; the runner wraps this in psql -1.
--
-- poles is hot (Works QA polls it every 30s), so a bare ADD COLUMN can queue
-- behind readers and stall the deploy while its pending ACCESS EXCLUSIVE blocks
-- new readers. lock_timeout makes the grab fail fast and retry instead of piling
-- up; ADD COLUMN of a nullable, default-less column is otherwise instant.
-- Plain SET (not SET LOCAL) so the timeout applies whether the runner wraps the
-- file in psql -1 or applies it autocommit; it rolls back with the txn either way.
SET lock_timeout = '3s';
ALTER TABLE poles ADD COLUMN IF NOT EXISTS field_status VARCHAR(100);
ALTER TABLE poles ADD COLUMN IF NOT EXISTS field_status_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN poles.field_status IS
  'QField civil-audit Status synced inbound from the project GPKG by sync-qfield-status-to-ff.py. NULL = not yet planted/captured. Distinct from poles.status (SoW import lifecycle).';
