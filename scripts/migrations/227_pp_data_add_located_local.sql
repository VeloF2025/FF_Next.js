-- Migration 227: Add 'located_local' to PP Data resolution statuses
-- Needed for WA photo VLM scan and WA cross-ref rescan which use 'located_local'

ALTER TABLE oes_pp_data DROP CONSTRAINT IF EXISTS oes_pp_data_resolution_status_check;

ALTER TABLE oes_pp_data ADD CONSTRAINT oes_pp_data_resolution_status_check
  CHECK (resolution_status IN ('not_found', 'located_oes', 'located_unified', 'located_onemap', 'located_1map', 'located_local', 'activated'));
