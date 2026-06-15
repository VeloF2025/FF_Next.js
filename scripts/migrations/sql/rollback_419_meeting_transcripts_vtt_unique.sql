-- Rollback for migration 419 (vtt partial unique index).
-- Clean reversal — drops only the index; no data is touched.
DROP INDEX IF EXISTS meeting_transcripts_meeting_id_vtt_uq;
