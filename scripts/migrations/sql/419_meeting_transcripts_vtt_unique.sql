-- Migration 419: enforce one 'vtt' transcript row per meeting (partial unique index)
-- (version = max(DB 418, file 418) + 1.)
--
-- meeting_transcripts has no unique constraint on meeting_id (PK is `id`), so the
-- >500KB spill path in src/lib/graph/meeting-helpers.ts could leave two 'vtt' rows
-- for one meeting under concurrent captures, and could not use an atomic ON CONFLICT
-- upsert (PR #1970 worked around this with DELETE-then-INSERT). A PARTIAL unique index
-- on (meeting_id) WHERE format='vtt' enforces the one-vtt-row-per-meeting invariant the
-- readers already assume and lets the app use
--   INSERT ... ON CONFLICT (meeting_id) WHERE format='vtt' DO UPDATE  (atomic, race-safe).
--
-- Scoped to 'vtt' ONLY: the same meeting legitimately holds sibling 'whisper-af' /
-- 'whisper-en' rows (Afrikaans/English whisper passes), so a full UNIQUE(meeting_id)
-- would be wrong. Built non-concurrently — the canonical runner wraps each migration
-- in a single transaction (psql -1), which disallows CREATE INDEX CONCURRENTLY; the
-- table is tiny so the brief lock is negligible. Verified 0 existing duplicate 'vtt'
-- (meeting_id) rows before writing this, so the unique build cannot fail on legacy data.
CREATE UNIQUE INDEX IF NOT EXISTS meeting_transcripts_meeting_id_vtt_uq
  ON meeting_transcripts (meeting_id)
  WHERE format = 'vtt';
