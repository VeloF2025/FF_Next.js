-- 355: Close duplicate open pp_data maintenance tickets.
--
-- Background: until the dedup guards in pp-data-tickets.ts and oesImportService.ts
-- (this PR), the PP re-entry path would clear oes_pp_data.maintenance_ticket_id
-- whenever a previously-activated serial reappeared in PP DATA. The next
-- pp-data-tickets POST then re-created a ticket for the same (DR, ONT serial),
-- producing up to 17 duplicate open tickets per DR.
--
-- Backlog audit at write time:
--   - 242 open pp_data tickets across 36 (dr_number, ont_serial) groups had
--     duplicates.
--   - For each group: keep the earliest-created ticket, close the rest.
--   - All 206 "later" duplicates had zero engagement: no user_assigned,
--     no maintenance_notes, no maintenance_attachments, no reassignment
--     history. Safe to bulk-close.
--
-- Safety: this migration only touches tickets that are STILL duplicate
-- candidates at run time and STILL show zero engagement. Anything touched
-- by NOC between this PR and the deploy is left alone.

BEGIN;

WITH ranked AS (
  SELECT
    t.id,
    t.ticket_uid,
    t.dr_number,
    t.ont_serial,
    t.assigned_to,
    ROW_NUMBER() OVER (
      PARTITION BY t.dr_number, t.ont_serial
      ORDER BY t.created_at
    ) AS rn,
    FIRST_VALUE(t.ticket_uid) OVER (
      PARTITION BY t.dr_number, t.ont_serial
      ORDER BY t.created_at
    ) AS earliest_uid,
    FIRST_VALUE(t.id) OVER (
      PARTITION BY t.dr_number, t.ont_serial
      ORDER BY t.created_at
    ) AS earliest_id
  FROM maintenance_tickets t
  WHERE t.source = 'pp_data'
    AND t.status NOT IN ('resolved', 'closed', 'cancelled')
    AND t.dr_number IS NOT NULL
    AND t.ont_serial IS NOT NULL
),
duplicates AS (
  SELECT id, ticket_uid, earliest_uid, earliest_id
  FROM ranked
  WHERE rn > 1
    AND assigned_to IS NULL
    AND NOT EXISTS (SELECT 1 FROM maintenance_notes n WHERE n.ticket_id = ranked.id)
    AND NOT EXISTS (SELECT 1 FROM maintenance_attachments a WHERE a.ticket_id = ranked.id)
),
note_insert AS (
  INSERT INTO maintenance_notes (ticket_id, content, note_type, visibility, created_at, updated_at)
  SELECT
    id,
    'Auto-closed as duplicate of ' || earliest_uid || ' (migration 355_close_duplicate_pp_data_tickets).',
    'system',
    'private',
    NOW(),
    NOW()
  FROM duplicates
  RETURNING ticket_id
)
UPDATE maintenance_tickets t
   SET status = 'closed',
       closed_at = NOW(),
       updated_at = NOW()
  FROM duplicates d
 WHERE t.id = d.id;

-- Also relink the source oes_pp_data row to the earliest OPEN ticket so the
-- post-import reconciliation sees a stable link going forward. Excluding
-- resolved/closed/cancelled tickets matters: if the earliest ticket is
-- already closed, the OES re-entry path will null out maintenance_ticket_id
-- on the next import (correctly), so we shouldn't pin to a dead ticket here.
WITH ranked AS (
  SELECT
    t.id,
    t.dr_number,
    t.ont_serial,
    ROW_NUMBER() OVER (
      PARTITION BY t.dr_number, t.ont_serial
      ORDER BY t.created_at
    ) AS rn,
    FIRST_VALUE(t.id) OVER (
      PARTITION BY t.dr_number, t.ont_serial
      ORDER BY t.created_at
    ) AS earliest_id
  FROM maintenance_tickets t
  WHERE t.source = 'pp_data'
    AND t.status NOT IN ('resolved', 'closed', 'cancelled')
    AND t.dr_number IS NOT NULL
    AND t.ont_serial IS NOT NULL
)
UPDATE oes_pp_data p
   SET maintenance_ticket_id = r.earliest_id
  FROM ranked r
 WHERE r.rn = 1
   AND p.resolved_drop_number = r.dr_number
   AND p.serial_number = r.ont_serial
   AND p.maintenance_ticket_id IS DISTINCT FROM r.earliest_id;

-- Now that duplicates are closed, enforce uniqueness at the DB layer so
-- concurrent POSTs against pp-data-tickets can't bypass the application-level
-- findDuplicateTickets check. Predicate matches the dedup semantics:
-- "one open pp_data ticket per ONT serial". Different serials on the same
-- DR remain allowed (rare but legitimate — ONT swap mid-investigation).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_pp_data_ticket_per_serial
  ON maintenance_tickets (ont_serial)
  WHERE source = 'pp_data'
    AND ont_serial IS NOT NULL
    AND status NOT IN ('resolved', 'closed', 'cancelled');

COMMIT;
