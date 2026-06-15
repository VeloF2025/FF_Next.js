-- Migration 418: record the real meeting_transcripts.format CHECK (add whisper-af/whisper-en)
-- (version = max(DB 417, file 417) + 1.)
--
-- Migration 221 created `meeting_transcripts.format` with an inline
--   CHECK (format IN ('vtt','text','json'))
-- but the whisper transcription paths (src/lib/graph/meeting-processor.ts and
-- scripts/retranscribe-whisper.ts) write 'whisper-af' / 'whisper-en'. The live DB's
-- CHECK was therefore widened out-of-band and never captured in a migration, so a
-- fresh rebuild from migrations would reject every whisper insert. This migration
-- records the real constraint so the schema history matches production.
--
-- Idempotent: drops the existing format check (whatever its current value set) and
-- re-adds the full 5-value whitelist. On the live DB this is a no-op re-assertion
-- (the constraint already permits all five); on a fresh build it widens the inline
-- 3-value check created by migration 221.
ALTER TABLE meeting_transcripts DROP CONSTRAINT IF EXISTS meeting_transcripts_format_check;
ALTER TABLE meeting_transcripts
  ADD CONSTRAINT meeting_transcripts_format_check
  CHECK (format IN ('vtt', 'text', 'json', 'whisper-af', 'whisper-en'));
