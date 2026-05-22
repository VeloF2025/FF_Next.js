-- Migration 365: Consolidate NOC ticket statuses 'closed' → 'resolved'
--
-- (Originally numbered 364 in PR #1710, but version 364 was claimed by
-- migration `serial_event_triggers` while #1710 was in review — see
-- `feedback_migration_version_collision` for the side-branch hazard.
-- Renumbered to 365 in the follow-up so the runner picks it up.)
--
-- Context: The Kanban board hid the 'closed' column by default
-- (DEFAULT_EXCLUDED_STATUSES in KanbanBoard.tsx), so any ticket moved to
-- 'closed' effectively disappeared. 'resolved' and 'closed' were redundant
-- terminal states. Going forward, 'resolved' is the single terminal state
-- for completed work. The QContact integration still exchanges 'closed'
-- externally; mapping happens at the sync boundary.
--
-- Pre-check (2026-05-21): 1595 rows with status='closed', 1272 with
-- status='resolved' — post-migration the resolved bucket will hold ~2867.
-- No CHECK constraint exists on maintenance_tickets.status, so no schema
-- change is required.
--
-- Trigger handling: `calculate_resolution_time` fires on UPDATE and sets
-- NEW.resolved_at := NOW() unconditionally when transitioning into
-- 'resolved' — which would overwrite the original closure timestamp on
-- every migrated row. We disable the trigger for the duration of the
-- UPDATE, copy closed_at → resolved_at via COALESCE so historical
-- timestamps survive, then re-enable. The trigger's dead 'closed' branch
-- is removed at the end (no callers can produce that status anymore).
--
-- Idempotent: safe to re-run (no-op once the closed→resolved rewrite is done).
--
-- Hotfix 2026-05-22: dropped `status_changed_at = COALESCE(...)` from the
-- UPDATE. That column was never added to maintenance_tickets — application
-- code (src/modules/noc/types/ticket.ts, KanbanCard.tsx) references it as
-- optional and falls back to `updated_at` when null/undefined, so removing
-- the line is harmless. Re-adding it would require a separate migration to
-- ADD COLUMN + a trigger to maintain it (out of scope here). Without this
-- fix, the migration parser rejects the UPDATE before evaluating WHERE,
-- blocking the deploy pipeline even when 0 'closed' rows exist.

BEGIN;

-- Audit trail: how many rows are about to flip
DO $$
DECLARE
  closed_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO closed_count
  FROM maintenance_tickets
  WHERE status = 'closed';
  RAISE NOTICE 'Migration 365: rewriting % maintenance_tickets rows from closed to resolved', closed_count;
END $$;

ALTER TABLE maintenance_tickets DISABLE TRIGGER trigger_calculate_resolution_time;

UPDATE maintenance_tickets
   SET status = 'resolved',
       resolved_at = COALESCE(resolved_at, closed_at, NOW()),
       resolution_time = COALESCE(resolution_time, closed_at - created_at, NOW() - created_at),
       updated_at = NOW()
 WHERE status = 'closed';

ALTER TABLE maintenance_tickets ENABLE TRIGGER trigger_calculate_resolution_time;

-- Drop the now-unreachable 'closed' branch from the resolution-time trigger.
-- After this migration, no UPDATE can land on status='closed', so the branch
-- is dead — and keeping it would mislead anyone reading the function later.
CREATE OR REPLACE FUNCTION public.calculate_resolution_time()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'resolved' AND OLD.status != 'resolved' THEN
    NEW.resolved_at := NOW();
    NEW.resolution_time := NOW() - NEW.created_at;
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
