-- Migration 397: Cortex meeting-action delivery marker
-- M2 (delivered-action loop): when FibreFlow turns a human-reviewed sealed meeting's
-- approved actions into real `action_items` and acks Cortex, it stamps this local
-- `delivered_at` so the 30-min pull cron never re-creates tasks or re-acks. The
-- authoritative delivery timestamp lives on Cortex's `meeting_outbox.delivered_at`;
-- this is the consumer-side mirror used purely to make the pull idempotent.

ALTER TABLE cortex_meeting_actions
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Partial index over the not-yet-delivered, human-reviewed rows the pull loop scans.
CREATE INDEX IF NOT EXISTS cortex_meeting_actions_undelivered_idx
  ON cortex_meeting_actions (sealed_at DESC)
  WHERE delivered_at IS NULL AND human_reviewed = TRUE;
