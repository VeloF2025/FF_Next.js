-- Migration 394: Cortex meeting actions — downstream landing for the Cortex Scribe outbox feed
-- FibreFlow pulls vetted (approved + sealed) meeting action items from the Cortex bridge
-- (GET /api/meetings/outbox/feed) and lands them here. One row per Cortex meeting (the
-- opaque mtg_ hash), mapped to FibreFlow's own meetings row via source_id (= the Cortex
-- record's source_id, which equals our teams_call_record_id). Read-only landing for now;
-- a review UI consumes this table in a later phase. Re-pulls upsert in place.

CREATE TABLE IF NOT EXISTS cortex_meeting_actions (
  cortex_meeting_id TEXT        PRIMARY KEY,                 -- Cortex mtg_ hash
  source_id         TEXT,                                   -- = teams_call_record_id (join key)
  ff_meeting_id     INTEGER     REFERENCES meetings(id) ON DELETE SET NULL,
  seal_source       TEXT        NOT NULL,                   -- 'human' | 'auto'
  human_reviewed    BOOLEAN     NOT NULL DEFAULT FALSE,
  sealed_at         TIMESTAMPTZ,
  summary           TEXT,
  items             JSONB       NOT NULL DEFAULT '[]'::jsonb, -- [{action_id,text,owner,due,confidence,...}]
  pulled_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No index on source_id: the Cortex→FibreFlow mapping is resolved app-side at pull time
-- (one lookup per sealed meeting), never as a SQL join, so source_id is not a query key.
-- Add one in a follow-up migration if a "find by source_id" query is ever introduced.
CREATE INDEX IF NOT EXISTS cortex_meeting_actions_ff_idx     ON cortex_meeting_actions (ff_meeting_id);
CREATE INDEX IF NOT EXISTS cortex_meeting_actions_sealed_idx ON cortex_meeting_actions (sealed_at DESC);
