-- Rollback 445: remove 'located_fibertime' from the CHECK.
-- Must first demote any rows carrying the status or the ADD CONSTRAINT fails.
-- Demotion clears the fibertime-sheet resolution fields it set.

BEGIN;

UPDATE oes_pp_data
SET resolution_status = 'not_found',
    resolved_drop_number = NULL,
    resolved_source = NULL,
    resolved_at = NULL,
    updated_at = NOW()
WHERE resolution_status = 'located_fibertime';

ALTER TABLE oes_pp_data DROP CONSTRAINT oes_pp_data_resolution_status_check;
ALTER TABLE oes_pp_data ADD CONSTRAINT oes_pp_data_resolution_status_check
  CHECK (resolution_status = ANY (ARRAY[
    'not_found'::text,
    'located_oes'::text,
    'located_unified'::text,
    'located_onemap'::text,
    'located_1map'::text,
    'located_local'::text,
    'activated'::text
  ]));

COMMIT;
