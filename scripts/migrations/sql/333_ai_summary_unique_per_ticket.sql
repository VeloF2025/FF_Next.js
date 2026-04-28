-- Migration 333 — Enforce at most one ai_summary row per maintenance_tickets.id
--
-- PRD-062 Phase 2: the regenerate endpoint does a DELETE+INSERT and could
-- otherwise leave duplicate ai_summary rows on the timeline if two
-- regenerate calls interleave. This unique partial index lets Postgres
-- enforce the invariant. Phase-1 createTicket inserts a fresh ticket with
-- no prior summary, so it is unaffected.

-- First, drop any pre-existing duplicates so the index can be created.
-- Keep the most recently created row per (ticket_id, ai_summary).
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY ticket_id
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM maintenance_activities
  WHERE activity_type = 'ai_summary'
)
DELETE FROM maintenance_activities
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_maintenance_activities_ai_summary_per_ticket
  ON maintenance_activities (ticket_id)
  WHERE activity_type = 'ai_summary';
