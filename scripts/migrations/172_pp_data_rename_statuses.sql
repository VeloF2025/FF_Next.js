-- Migration 172: Rename PP Data resolution statuses
-- "resolved/unresolved" -> "located/not_found/activated"
-- - not_found: no DR match yet (was 'unresolved')
-- - located_oes: found via oes_activations (was 'matched_oes')
-- - located_unified: found via unified reviews (was 'matched_unified')
-- - located_onemap: found via onemap_properties (was 'matched_onemap')
-- - located_1map: found via 1Map API (was 'matched_1map')
-- - activated: serial appeared in OES activations = truly resolved (NEW)

-- Step 1: Drop old CHECK constraint
ALTER TABLE oes_pp_data DROP CONSTRAINT IF EXISTS oes_pp_data_resolution_status_check;

-- Step 2: Rename existing values
UPDATE oes_pp_data SET resolution_status = 'not_found' WHERE resolution_status = 'unresolved';
UPDATE oes_pp_data SET resolution_status = 'located_oes' WHERE resolution_status = 'matched_oes';
UPDATE oes_pp_data SET resolution_status = 'located_unified' WHERE resolution_status = 'matched_unified';
UPDATE oes_pp_data SET resolution_status = 'located_onemap' WHERE resolution_status = 'matched_onemap';
UPDATE oes_pp_data SET resolution_status = 'located_1map' WHERE resolution_status = 'matched_1map';

-- Step 3: Add new CHECK constraint with updated values
ALTER TABLE oes_pp_data ADD CONSTRAINT oes_pp_data_resolution_status_check
  CHECK (resolution_status IN ('not_found', 'located_oes', 'located_unified', 'located_onemap', 'located_1map', 'activated'));

-- Step 4: Update default
ALTER TABLE oes_pp_data ALTER COLUMN resolution_status SET DEFAULT 'not_found';

-- Step 5: Rename batch columns for clarity
ALTER TABLE oes_pp_import_batches RENAME COLUMN resolved_count TO located_count;
ALTER TABLE oes_pp_import_batches RENAME COLUMN unresolved_count TO not_found_count;
