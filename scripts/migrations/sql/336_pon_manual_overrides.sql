-- Migration 336: pon_manual_overrides — manual-only string fields per PON
-- Spec: docs/superpowers/specs/2026-05-08-project-tracker-workspace-design.md §4.1
--
-- Companion to pon_stage_tracking. Holds free-text fields that have no
-- automated source feed (1Map / OES / Nokia don't supply these).

BEGIN;

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
CREATE TRIGGER pon_manual_overrides_updated_at
  BEFORE UPDATE ON pon_manual_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE pon_manual_overrides IS
  'Manual-only string fields per PON. 1:1 with pon_stage_tracking.';
COMMENT ON COLUMN pon_manual_overrides.blockage IS
  'Free-text blockage description; mirrored from Excel tracker "Blockage" column for parity.';
COMMENT ON COLUMN pon_manual_overrides.updated_by IS
  'User id or email of the last editor; written by the workspace UI.';

COMMIT;
