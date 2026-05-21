-- Wave: WA mention -> ticket / DR-lifecycle linking
-- Adds the schema bits needed for waMaintenanceProcessor to link WhatsApp
-- messages (DR / ONT serial mentions from all monitored groups) into:
--   * maintenance_notes      (per-ticket comment)
--   * maintenance_activities (per-ticket lifecycle row)
--   * dr_activity_log        (per-drop_number lifecycle, ticket-independent)
--   * maintenance_wa_photos  (photo -> ticket link)
-- Idempotent: every statement is IF NOT EXISTS / DROP-then-CREATE.

BEGIN;

-- (a) Extend maintenance_notes.note_type CHECK to include 'wa_mention'.
-- Probe: existing constraint (named ticket_notes_note_type_check from a prior
-- table rename) allowed only ('internal','external','system').
ALTER TABLE maintenance_notes DROP CONSTRAINT IF EXISTS ticket_notes_note_type_check;
ALTER TABLE maintenance_notes DROP CONSTRAINT IF EXISTS maintenance_notes_note_type_check;
ALTER TABLE maintenance_notes ADD CONSTRAINT maintenance_notes_note_type_check CHECK (
  note_type IN ('internal', 'external', 'system', 'wa_mention')
);

-- (b) Per-note source ref so the WA-mention writer can dedupe re-emits.
ALTER TABLE maintenance_notes
  ADD COLUMN IF NOT EXISTS wa_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_maintenance_notes_wa_message
  ON maintenance_notes(ticket_id, wa_message_id)
  WHERE wa_message_id IS NOT NULL;

-- (c) Link captured WA photos directly to a ticket.
-- ON DELETE SET NULL: a ticket deletion leaves the photo row in place
-- (still useful for forensics and the dr_activity_log entry).
ALTER TABLE maintenance_wa_photos
  ADD COLUMN IF NOT EXISTS ticket_id UUID REFERENCES maintenance_tickets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_maintenance_wa_photos_ticket
  ON maintenance_wa_photos(ticket_id)
  WHERE ticket_id IS NOT NULL;

-- (d) Dedupe maintenance_activities WA-mention rows on the external WA message id.
-- external_id column already exists; this partial unique index only constrains
-- rows where activity_type='wa_mention', so it never collides with other sources.
CREATE UNIQUE INDEX IF NOT EXISTS uq_maintenance_activities_wa_mention
  ON maintenance_activities(ticket_id, external_id)
  WHERE activity_type = 'wa_mention' AND external_id IS NOT NULL;

-- (e) Dedupe dr_activity_log on the embedded wa_message_id for WA_DR_MENTION events.
-- event_data is jsonb; we index the extracted text. Partial predicate keeps
-- the index small and limits enforcement to rows we own.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dr_activity_log_wa_mention
  ON dr_activity_log(drop_number, (event_data->>'wa_message_id'))
  WHERE event_type = 'WA_DR_MENTION' AND event_data ? 'wa_message_id';

COMMIT;
