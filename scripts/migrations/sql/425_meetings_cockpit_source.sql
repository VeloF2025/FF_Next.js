-- Migration 425: allow source='cockpit' on meetings + index teams_meeting_id.
-- (version = max(applied DB version, file 424) + 1.)
--
-- Cortex Scribe's interactive cockpit lets a participant log action items LIVE in a Teams
-- meeting side panel. For un-recorded ad-hoc meetings there is no callRecord/transcript, so
-- FibreFlow has no `meetings` row. The new `pull-cortex-cockpit-recaps` cron find-or-creates
-- one with source='cockpit' so the meeting shows on communications?tab=meetings as a normal
-- meeting, with its action items. This migration:
--   1. extends the meetings.source CHECK to include 'cockpit'; and
--   2. indexes teams_meeting_id (the live Teams thread id) which the cron's find-or-create
--      reconciliation queries against (NOT unique — a recurring series shares a thread id
--      across occurrences, so the cron scopes thread matches by a meeting_date window).
--
-- Safe + idempotent: the new CHECK is the current set + 'cockpit', so no existing row can
-- violate it (any row already satisfies the current constraint). Re-runnable.

-- 1. Extend the source CHECK constraint (inline column CHECK from mig 221 is auto-named
--    meetings_source_check).
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_source_check;
ALTER TABLE meetings
  ADD CONSTRAINT meetings_source_check
  CHECK (source IN ('fireflies','teams','livekit','manual','cockpit'));

-- 2. Index the reconciliation lookup column.
CREATE INDEX IF NOT EXISTS idx_meetings_teams_meeting_id
  ON meetings(teams_meeting_id) WHERE teams_meeting_id IS NOT NULL;

-- Rollback (manual):
--   DROP INDEX IF EXISTS idx_meetings_teams_meeting_id;
--   ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_source_check;
--   ALTER TABLE meetings ADD CONSTRAINT meetings_source_check
--     CHECK (source IN ('fireflies','teams','livekit','manual'));
--   -- (only after any source='cockpit' rows are removed/relabelled)
