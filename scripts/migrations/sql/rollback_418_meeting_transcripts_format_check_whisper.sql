-- Rollback for migration 418 (meeting_transcripts.format CHECK widening).
--
-- Restores the pre-418 narrow whitelist ('vtt','text','json'). WARNING: this will
-- FAIL if any 'whisper-af' / 'whisper-en' rows exist (they violate the narrow CHECK)
-- — which is exactly the production state migration 418 was written to support. To
-- actually roll back you must first remove or relabel those rows. This rollback
-- exists for completeness; in practice 418 should not be reverted.
ALTER TABLE meeting_transcripts DROP CONSTRAINT IF EXISTS meeting_transcripts_format_check;
ALTER TABLE meeting_transcripts
  ADD CONSTRAINT meeting_transcripts_format_check
  CHECK (format IN ('vtt', 'text', 'json'));
