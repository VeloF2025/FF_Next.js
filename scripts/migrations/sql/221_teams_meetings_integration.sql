-- Migration 221: Teams Meeting Integration
-- Extends meetings table for Microsoft Teams Graph API sync
-- Adds transcript storage and webhook subscription tracking

-- 1. Drop NOT NULL on fireflies_id (Teams meetings won't have one)
ALTER TABLE meetings ALTER COLUMN fireflies_id DROP NOT NULL;

-- 2. Add Teams-specific columns
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'fireflies'
    CHECK (source IN ('fireflies','teams','livekit','manual')),
  ADD COLUMN IF NOT EXISTS teams_call_record_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS teams_meeting_id TEXT,
  ADD COLUMN IF NOT EXISTS organizer_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS organizer_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS join_url TEXT,
  ADD COLUMN IF NOT EXISTS raw_transcript TEXT,
  ADD COLUMN IF NOT EXISTS recording_path TEXT,
  ADD COLUMN IF NOT EXISTS recording_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS processing_status VARCHAR(30) NOT NULL DEFAULT 'completed'
    CHECK (processing_status IN ('pending','fetching','processing','completed','failed')),
  ADD COLUMN IF NOT EXISTS processing_error TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- 3. meeting_transcripts table (for large transcripts >500KB)
CREATE TABLE IF NOT EXISTS meeting_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  format VARCHAR(10) NOT NULL DEFAULT 'vtt' CHECK (format IN ('vtt','text','json')),
  content TEXT NOT NULL,
  speaker_map JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_meeting ON meeting_transcripts(meeting_id);

-- 4. graph_subscriptions table (webhook lifecycle)
CREATE TABLE IF NOT EXISTS graph_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id TEXT NOT NULL UNIQUE,
  resource TEXT NOT NULL,
  change_type TEXT NOT NULL,
  notification_url TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  client_state TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  renewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_graph_subs_expires ON graph_subscriptions(expires_at) WHERE status = 'active';

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_meetings_source ON meetings(source);
CREATE INDEX IF NOT EXISTS idx_meetings_teams_cr ON meetings(teams_call_record_id) WHERE teams_call_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_proc_status ON meetings(processing_status) WHERE processing_status != 'completed';
