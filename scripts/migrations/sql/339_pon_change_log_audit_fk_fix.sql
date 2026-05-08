-- Migration 339: pon_change_log audit-FK fix + defensive GRANTs for tracker workspace
-- Spec: docs/superpowers/specs/2026-05-08-project-tracker-workspace-design.md §11 Q4
-- Plan: docs/superpowers/plans/2026-05-08-tracker-workspace-1.0a-schema-foundation.md
--
-- Numbering note: migration 338 was reserved by plan 1.0a Task 4 for an
-- optional "master_tracker_align" migration that turned out unnecessary
-- (the existing master_tracker schema already matched the spec). The gap is
-- intentional — do not renumber this migration; the runner sorts numerically
-- and the gap is harmless. See plan 1.0a Task 4 for the audit result.
--
-- Two fixes from the blind code review on PR #1558:
--   1. (HIGH) ON DELETE CASCADE on pon_change_log FKs is wrong for an audit log —
--      deleting a PON or drop would silently erase its history. Switch to SET NULL
--      so audit rows survive parent deletion.
--   2. (HIGH-defensive) Live DB has full grants on the three new tables already
--      (Supabase default-privileges); adding explicit GRANTs makes the migration
--      files self-sufficient for fresh-DB bootstraps.
--
-- The chk_pon_or_drop CHECK constraint must be dropped: with SET NULL, both FKs
-- can legitimately end up null after parent deletion. Application code is the
-- correct enforcement layer for "every audit row must reference at least one
-- entity at INSERT time" — see deep doc.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Re-target pon_change_log FKs from CASCADE to SET NULL
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE pon_change_log
  DROP CONSTRAINT IF EXISTS pon_change_log_pon_stage_id_fkey,
  DROP CONSTRAINT IF EXISTS pon_change_log_drop_id_fkey,
  DROP CONSTRAINT IF EXISTS chk_pon_or_drop;

ALTER TABLE pon_change_log
  ADD CONSTRAINT pon_change_log_pon_stage_id_fkey
    FOREIGN KEY (pon_stage_id) REFERENCES pon_stage_tracking(id) ON DELETE SET NULL,
  ADD CONSTRAINT pon_change_log_drop_id_fkey
    FOREIGN KEY (drop_id) REFERENCES drops(id) ON DELETE SET NULL;

COMMENT ON COLUMN pon_change_log.pon_stage_id IS
  'PON this audit row references. NULL after the parent PON is deleted (audit row survives).';
COMMENT ON COLUMN pon_change_log.drop_id IS
  'Drop this audit row references. NULL after the parent drop is deleted (audit row survives).';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Defensive explicit GRANTs (no-op on live DB, safety for fresh-DB rebuilds)
-- ──────────────────────────────────────────────────────────────────────────────
-- The live DB already has full grants for fibreflow_user via Supabase default
-- privileges. Adding explicit GRANTs ensures the migrations are self-sufficient
-- for any future fresh-DB bootstrap that does not inherit defaults.

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON pon_manual_overrides TO fibreflow_user;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON pon_change_log       TO fibreflow_user;

COMMIT;
