-- 375_oes_pp_data_lifecycle.sql
--
-- ONT lifecycle correctness: introduce explicit terminal-activation tracking
-- and source-of-linkage diagnostics on oes_pp_data.
--
-- Lifecycle rule (enforced in code, surfaced here as schema):
--   not_activated_yet --> activated  (set activated_at, one-way)
--   activated         --> decommissioned  (only via explicit fault/swap)
--
-- Day-to-day OLT offline, FT re-listing on PP, or missing-from-latest-import
-- are NOT deactivation triggers. The previous code path that demoted
-- activated -> not_found on FT re-list was a lifecycle violation; this
-- migration introduces the fields a corrected post-import handler can rely on.
--
-- Forward-compatible: additive only. No existing code reads these columns yet
-- (gated behind ONT_LIFECYCLE_V2 feature flag). Safe to ship with flag OFF.
--
-- Execution order:
--   1. ADD COLUMNS (idempotent with IF NOT EXISTS)
--   2. CREATE INDEXES (supporting backfill performance + runtime queries)
--   3. BACKFILL 1-4 (must run before constraint validation)
--   4. ADD CONSTRAINT NOT VALID (no scan needed — backfills guarantee compliance)
--   5. VALIDATE CONSTRAINT (fast: only checks rows touched after ADD CONSTRAINT)

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Add columns
-- ---------------------------------------------------------------------------
ALTER TABLE oes_pp_data
  ADD COLUMN IF NOT EXISTS activated_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decommissioned_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decommissioned_reason  TEXT,
  ADD COLUMN IF NOT EXISTS linked_via             TEXT[] NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- Step 2: Indexes
--   a) Partial index supporting the Lifecycle Dispute query
--   b) Functional index on oes_activations(LOWER(serial_number)) used by
--      the DISTINCT ON serial-swap queries (loadFtDisputeDefiniteRows,
--      loadFtDisputeLifecycleRows). Dramatically reduces seq-scans on large
--      activation tables.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_oes_pp_data_activated_live
  ON oes_pp_data (activated_at)
  WHERE activated_at IS NOT NULL AND decommissioned_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oes_activations_lower_serial
  ON oes_activations (LOWER(serial_number));

-- ---------------------------------------------------------------------------
-- Step 3: Backfills (run before constraint to avoid false violations)
-- ---------------------------------------------------------------------------

-- Backfill 1: populate activated_at for rows already marked 'activated'.
-- Source: the matching oes_activations row's activation_datetime, falling back
-- to activation_date, then NOW() if both are null (ensures no activated row is
-- ever left with activated_at IS NULL after migration).
-- Only fills NULL activated_at so a re-run is idempotent.
DO $$
DECLARE
  filled_count  INTEGER;
  skipped_count INTEGER;
BEGIN
  UPDATE oes_pp_data pp
     SET activated_at = COALESCE(
           oa.activation_datetime,
           oa.activation_date::timestamptz,
           NOW()
         )
    FROM oes_activations oa
   WHERE pp.resolution_status = 'activated'
     AND pp.activated_at IS NULL
     AND LOWER(oa.serial_number) = LOWER(pp.serial_number);
  GET DIAGNOSTICS filled_count = ROW_COUNT;

  -- Count activated rows that still have no matching oes_activations row
  SELECT COUNT(*) INTO skipped_count
    FROM oes_pp_data
   WHERE resolution_status = 'activated'
     AND activated_at IS NULL;

  RAISE NOTICE 'Backfill 1 (activated_at for activated rows): filled=%, still_null=%',
    filled_count, skipped_count;
END $$;

-- Backfill 2: populate linked_via for previously-resolved rows so the new
-- "Linked, awaiting activation" tab can express HOW we know the DR.
UPDATE oes_pp_data
   SET linked_via = ARRAY['oes_activations']
 WHERE resolution_status = 'located_oes'
   AND NOT ('oes_activations' = ANY(linked_via));

UPDATE oes_pp_data
   SET linked_via = ARRAY['dr_photo_unified_reviews']
 WHERE resolution_status = 'located_unified'
   AND NOT ('dr_photo_unified_reviews' = ANY(linked_via));

UPDATE oes_pp_data
   SET linked_via = ARRAY['onemap_properties']
 WHERE resolution_status = 'located_onemap'
   AND NOT ('onemap_properties' = ANY(linked_via));

-- Backfill 3: for located_oes rows whose latest matching oes_activations event
-- is currently Active, backfill activated_at so they correctly classify as
-- FT Dispute Definite or Lifecycle — not as "still awaiting activation".
--
-- Without this, every existing located_oes row would appear in the
-- "PP — Linked, Awaiting Activation" tab on the first nightly with flag ON,
-- even when the serial is currently OLT-Active.
DO $$
DECLARE
  b3_count INTEGER;
BEGIN
  WITH latest_per_serial AS (
    SELECT DISTINCT ON (LOWER(serial_number))
      LOWER(serial_number) AS lserial,
      activation_datetime,
      activation_date,
      status
    FROM oes_activations
    ORDER BY LOWER(serial_number),
             activation_datetime DESC NULLS LAST,
             activation_date DESC NULLS LAST
  )
  UPDATE oes_pp_data pp
     SET activated_at = COALESCE(la.activation_datetime, la.activation_date::timestamptz)
    FROM latest_per_serial la
   WHERE pp.resolution_status = 'located_oes'
     AND pp.activated_at IS NULL
     AND la.lserial = LOWER(pp.serial_number)
     AND LOWER(la.status) = 'active'
     AND (la.activation_datetime IS NOT NULL OR la.activation_date IS NOT NULL);
  GET DIAGNOSTICS b3_count = ROW_COUNT;
  RAISE NOTICE 'Backfill 3 (activated_at for currently-Active located_oes rows): filled=%',
    b3_count;
END $$;

-- ---------------------------------------------------------------------------
-- Step 4: Constraint — add NOT VALID first (no full-table scan; backfills
-- above ensure all existing rows comply). Then VALIDATE to lock in the
-- guarantee for rows written after this statement.
-- ---------------------------------------------------------------------------
ALTER TABLE oes_pp_data
  DROP CONSTRAINT IF EXISTS oes_pp_data_lifecycle_order_check;
ALTER TABLE oes_pp_data
  ADD CONSTRAINT oes_pp_data_lifecycle_order_check CHECK (
    decommissioned_at IS NULL
    OR (activated_at IS NOT NULL AND decommissioned_at >= activated_at)
  ) NOT VALID;

ALTER TABLE oes_pp_data
  VALIDATE CONSTRAINT oes_pp_data_lifecycle_order_check;

INSERT INTO migrations (version, name, executed_at)
VALUES ('375', 'oes_pp_data_lifecycle', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
