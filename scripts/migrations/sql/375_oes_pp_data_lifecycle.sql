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

BEGIN;

ALTER TABLE oes_pp_data
  ADD COLUMN IF NOT EXISTS activated_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decommissioned_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decommissioned_reason  TEXT,
  ADD COLUMN IF NOT EXISTS linked_via             TEXT[] NOT NULL DEFAULT '{}';

-- Lifecycle invariant: cannot be decommissioned without first being activated.
-- Decommission timestamp must be at or after activation timestamp.
ALTER TABLE oes_pp_data
  DROP CONSTRAINT IF EXISTS oes_pp_data_lifecycle_order_check;
ALTER TABLE oes_pp_data
  ADD CONSTRAINT oes_pp_data_lifecycle_order_check CHECK (
    decommissioned_at IS NULL
    OR (activated_at IS NOT NULL AND decommissioned_at >= activated_at)
  );

-- Index supporting the Lifecycle Dispute query
-- (activated AND not decommissioned AND on latest PP list)
CREATE INDEX IF NOT EXISTS idx_oes_pp_data_activated_live
  ON oes_pp_data (activated_at)
  WHERE activated_at IS NOT NULL AND decommissioned_at IS NULL;

-- ---------------------------------------------------------------------------
-- Backfill 1: populate activated_at for rows already marked 'activated'.
-- Source: the matching oes_activations row's activation_datetime, falling back
-- to activation_date if datetime is null. Only fills NULL activated_at so a
-- re-run is idempotent.
-- ---------------------------------------------------------------------------
UPDATE oes_pp_data pp
   SET activated_at = COALESCE(oa.activation_datetime, oa.activation_date::timestamptz)
  FROM oes_activations oa
 WHERE pp.resolution_status = 'activated'
   AND pp.activated_at IS NULL
   AND LOWER(oa.serial_number) = LOWER(pp.serial_number)
   AND (oa.activation_datetime IS NOT NULL OR oa.activation_date IS NOT NULL);

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

INSERT INTO migrations (version, name, executed_at)
VALUES ('375', 'oes_pp_data_lifecycle', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
