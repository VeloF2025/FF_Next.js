-- Migration 342: Correct pon_stage_tracking.scope_string column comment
-- The comment incorrectly said "Scoped stringing length / count".
-- scope_string is metres of stringing, never a count.
COMMENT ON COLUMN pon_stage_tracking.scope_string IS 'Scoped stringing length in metres for this PON.';
