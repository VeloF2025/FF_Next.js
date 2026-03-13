-- Migration 242: Recording bot infrastructure
-- Tracks bot-initiated recordings for "Meet Now" calls

-- Bot recording jobs — one row per recording bot dispatch
CREATE TABLE IF NOT EXISTS bot_recordings (
  id            SERIAL PRIMARY KEY,
  meeting_id    INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
  join_url      TEXT NOT NULL,
  container_id  TEXT,                -- Docker container ID
  status        VARCHAR(30) NOT NULL DEFAULT 'dispatched'
                CHECK (status IN ('dispatched','joining','recording','uploading','completed','failed','timeout')),
  triggered_by  TEXT,                -- Graph user ID that triggered presence detection
  audio_path    TEXT,                -- Local path to recorded audio file
  audio_size    INTEGER,             -- File size in bytes
  duration_sec  INTEGER,             -- Recording duration in seconds
  error         TEXT,                -- Error message on failure
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMPTZ,         -- When bot joined the meeting
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_recordings_status ON bot_recordings(status);
CREATE INDEX IF NOT EXISTS idx_bot_recordings_join_url ON bot_recordings(join_url);

-- Track active presence monitoring state per user
CREATE TABLE IF NOT EXISTS presence_monitor (
  user_id       TEXT PRIMARY KEY,    -- Graph user ID
  display_name  TEXT,
  email         TEXT,
  last_status   VARCHAR(30),         -- Last known presence status
  in_call_since TIMESTAMPTZ,         -- When the current call started (null if not in call)
  bot_dispatched BOOLEAN DEFAULT FALSE,  -- Whether a bot was dispatched for current call
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
