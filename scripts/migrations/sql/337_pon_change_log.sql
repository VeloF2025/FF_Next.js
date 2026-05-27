-- Migration 337: pon_change_log — append-only audit log
-- Spec: docs/superpowers/specs/2026-05-08-project-tracker-workspace-design.md §4.5
--
-- Every write through the tracker workspace inserts a row here. Sources include
-- the workspace UI, automated feeds (1Map / OES / Nokia / SP sync), the Lawley
-- snapshot importer, and any future migration scripts.

BEGIN;

CREATE TABLE IF NOT EXISTS pon_change_log (
  id            bigserial PRIMARY KEY,
  pon_stage_id  uuid REFERENCES pon_stage_tracking(id) ON DELETE CASCADE,
  drop_id       uuid REFERENCES drops(id) ON DELETE CASCADE,
  field         text NOT NULL,
  old_value     text,
  new_value     text,
  source        text NOT NULL CHECK (source IN ('ui','1map','oes','nokia','sp_sync','import','migration')),
  changed_by    text,
  changed_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pon_or_drop CHECK (pon_stage_id IS NOT NULL OR drop_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_pon_change_log_pon_stage ON pon_change_log (pon_stage_id, changed_at DESC) WHERE pon_stage_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pon_change_log_drop      ON pon_change_log (drop_id, changed_at DESC)      WHERE drop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pon_change_log_recent    ON pon_change_log (changed_at DESC);

COMMENT ON TABLE pon_change_log IS
  'Append-only audit log for tracker-workspace edits and feed-sourced updates.';
COMMENT ON COLUMN pon_change_log.source IS
  'Origin of the change: ui (workspace edit), 1map/oes/nokia/sp_sync (feed), import (Lawley snapshot), migration (forward-port).';

COMMIT;
