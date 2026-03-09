-- Migration 225: Add transcript_source to track transcription method
-- Values: 'teams-vtt' (Microsoft Teams), 'whisper' (OpenAI Whisper re-transcription), 'fireflies' (Fireflies sentences)
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS transcript_source TEXT;

-- Mark existing Teams transcripts as VTT
UPDATE meetings SET transcript_source = 'teams-vtt' WHERE source = 'teams' AND raw_transcript IS NOT NULL AND transcript_source IS NULL;

-- Mark existing Fireflies transcripts
UPDATE meetings SET transcript_source = 'fireflies' WHERE source = 'fireflies' AND raw_transcript IS NOT NULL AND transcript_source IS NULL;
