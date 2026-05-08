-- Migration 336: pon_manual_overrides — manual-only string fields per PON
-- Spec: docs/superpowers/specs/2026-05-08-project-tracker-workspace-design.md §4.1
--
-- Companion to pon_stage_tracking. Holds free-text fields that have no
-- automated source feed (1Map / OES / Nokia don't supply these).
--
-- LAZY INSERT: A row in this table only exists when at least one field has
-- been edited. Queries that join pon_manual_overrides to pon_stage_tracking
-- MUST use LEFT JOIN — an INNER JOIN silently drops every PON that has
-- never been edited, producing wrong rollups.

BEGIN;

-- Idempotent guard: ensures the trigger function exists even on a fresh DB
-- where it has not yet been created by an earlier bootstrap step. No-op on
-- the live DB where the function (from the original mig 179 bootstrap) is
-- already present and identical.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS pon_manual_overrides (
  pon_stage_id          uuid PRIMARY KEY REFERENCES pon_stage_tracking(id) ON DELETE CASCADE,
  blockage              text,
  civil_contractor      text,
  stringing_contractor  text,
  optical_contractor    text,
  optical_splitter      text,
  optical_type          text,
  atp_submitter_notes   text,
  override_notes        text,
  updated_by            text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Updated-at trigger reuses the existing update_updated_at_column() function
-- defined alongside pon_stage_tracking (mig 179).
DROP TRIGGER IF EXISTS pon_manual_overrides_updated_at ON pon_manual_overrides;
CREATE TRIGGER pon_manual_overrides_updated_at
  BEFORE UPDATE ON pon_manual_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE pon_manual_overrides IS
  'Manual-only string fields per PON. 1:1 with pon_stage_tracking. LAZY INSERT — use LEFT JOIN.';
COMMENT ON COLUMN pon_manual_overrides.blockage IS
  'Free-text blockage description; mirrored from Excel tracker "Blockage" column for parity.';
COMMENT ON COLUMN pon_manual_overrides.updated_by IS
  'User id or email of the last editor; written by the workspace UI.';

COMMIT;
