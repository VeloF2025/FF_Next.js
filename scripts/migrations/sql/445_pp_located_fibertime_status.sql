-- 445: allow 'located_fibertime' in oes_pp_data.resolution_status.
-- Fibertime's per-site OES PP sheets now carry a "Drop Number" column;
-- the nightly PP import promotes not_found rows whose serial the sheet
-- maps to a DR (resolved_source='fibertime_sheet').
-- Purely additive (CHECK widened) — safe to apply before the code deploy.
-- (442-444 already applied by parallel branches per live schema_migrations.)

BEGIN;

ALTER TABLE oes_pp_data DROP CONSTRAINT oes_pp_data_resolution_status_check;
ALTER TABLE oes_pp_data ADD CONSTRAINT oes_pp_data_resolution_status_check
  CHECK (resolution_status = ANY (ARRAY[
    'not_found'::text,
    'located_oes'::text,
    'located_unified'::text,
    'located_onemap'::text,
    'located_1map'::text,
    'located_local'::text,
    'located_fibertime'::text,
    'activated'::text
  ]));

COMMIT;
