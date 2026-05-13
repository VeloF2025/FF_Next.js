-- Migration 344: Backfill correct activations team on active tickets
--
-- Two problems found across Lawley / Mamelodi / Mohadin / Thembisa projects:
--
--   1. Wrong team  — Mamelodi (47) and Mohadin (336) activations tickets were
--      manually assigned to Lawley Activations before migration 343 seeded the
--      correct project_team_assignments rows. These need to be moved to their
--      project's actual activations team.
--
--   2. No team     — 648 activations tickets (Lawley 239, Mamelodi 41,
--      Mohadin 367, Thembisa POP 1 1) have assigned_team_id = NULL because
--      the bulk OLT/PP APIs created them before the team routing was fixed.
--
-- Scope: type = 'activations' AND status NOT IN closed/resolved/cancelled/verified.
-- Both assigned_team_id and assigned_team (legacy UUID FK) are updated to stay in sync.
--
-- UUIDs verified against live production DB:
--   Lawley         project 4eb13426-b2a1-472d-9b3c-277082ae9b55  team da2ea0dd-d0c3-4afe-bc42-062134c93da9
--   Mamelodi       project 7003dc06-9af7-4a7c-bc6c-a177d77784f2  team 8e1ab592-8a62-430f-bb62-592cd9bc1f40
--   Mohadin        project bf9a90db-e758-4c05-b999-694cd63c451f  team 48507948-48ba-4d95-9768-e2b40a6d13bb
--   Thembisa POP 1 project 7d8b94d6-8e5a-4dbb-9ede-69ce3884e004  team 601b3f04-a60f-4d5b-8301-e32885e31256
--   Thembisa POP 2 project d3df9135-9aa3-415d-87b6-17cce547eb22  team 601b3f04-a60f-4d5b-8301-e32885e31256
--   Thembisa POP 3 project 1de088dd-fe24-43fb-b8d3-94fca61ef91d  team 601b3f04-a60f-4d5b-8301-e32885e31256
--
-- One-shot, idempotent: re-running is safe (all backfills are gated on the row
-- still being NULL or still pointing at the wrong team). RAISE NOTICE prints
-- the row counts so the operator can verify the migration touched what the PR
-- body claims (383 wrong-team + 648 NULL = 1031 rows on first run, 0 on re-run).

BEGIN;

DO $$
DECLARE
  v_lawley_team   uuid := 'da2ea0dd-d0c3-4afe-bc42-062134c93da9';
  v_mamelodi_team uuid := '8e1ab592-8a62-430f-bb62-592cd9bc1f40';
  v_mohadin_team  uuid := '48507948-48ba-4d95-9768-e2b40a6d13bb';
  v_thembisa_team uuid := '601b3f04-a60f-4d5b-8301-e32885e31256';
  v_count         integer;
  v_total         integer := 0;
  v_active        text[] := ARRAY['closed','resolved','cancelled','verified'];
BEGIN
  -- Verify all hardcoded team UUIDs exist before any UPDATE runs. A typo or
  -- a renamed team would otherwise cause silent 0-row UPDATEs.
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = v_lawley_team) THEN
    RAISE EXCEPTION 'Lawley Activations team % not found — aborting migration', v_lawley_team;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = v_mamelodi_team) THEN
    RAISE EXCEPTION 'Mamelodi Activations team % not found — aborting migration', v_mamelodi_team;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = v_mohadin_team) THEN
    RAISE EXCEPTION 'Mohadin Activations team % not found — aborting migration', v_mohadin_team;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = v_thembisa_team) THEN
    RAISE EXCEPTION 'Tembisa Activations team % not found — aborting migration', v_thembisa_team;
  END IF;

  -- ── Lawley — unassigned ───────────────────────────────────────────────────
  UPDATE maintenance_tickets
  SET assigned_team_id = v_lawley_team, assigned_team = v_lawley_team
  WHERE project_id = '4eb13426-b2a1-472d-9b3c-277082ae9b55'
    AND type = 'activations'
    AND assigned_team_id IS NULL
    AND status <> ALL(v_active);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;
  RAISE NOTICE 'Lawley unassigned backfill: % rows', v_count;

  -- ── Mamelodi — unassigned + wrong-team (Lawley → Mamelodi) ────────────────
  UPDATE maintenance_tickets
  SET assigned_team_id = v_mamelodi_team, assigned_team = v_mamelodi_team
  WHERE project_id = '7003dc06-9af7-4a7c-bc6c-a177d77784f2'
    AND type = 'activations'
    AND (assigned_team_id IS NULL OR assigned_team_id = v_lawley_team)
    AND status <> ALL(v_active);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;
  RAISE NOTICE 'Mamelodi backfill (unassigned + wrong-team): % rows', v_count;

  -- ── Mohadin — unassigned + wrong-team (Lawley → Mohadin) ──────────────────
  UPDATE maintenance_tickets
  SET assigned_team_id = v_mohadin_team, assigned_team = v_mohadin_team
  WHERE project_id = 'bf9a90db-e758-4c05-b999-694cd63c451f'
    AND type = 'activations'
    AND (assigned_team_id IS NULL OR assigned_team_id = v_lawley_team)
    AND status <> ALL(v_active);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;
  RAISE NOTICE 'Mohadin backfill (unassigned + wrong-team): % rows', v_count;

  -- ── Thembisa POPs 1/2/3 — unassigned ──────────────────────────────────────
  UPDATE maintenance_tickets
  SET assigned_team_id = v_thembisa_team, assigned_team = v_thembisa_team
  WHERE project_id IN (
          '7d8b94d6-8e5a-4dbb-9ede-69ce3884e004',  -- Thembisa POP 1
          'd3df9135-9aa3-415d-87b6-17cce547eb22',  -- Thembisa POP 2
          '1de088dd-fe24-43fb-b8d3-94fca61ef91d'   -- Thembisa POP 3
        )
    AND type = 'activations'
    AND assigned_team_id IS NULL
    AND status <> ALL(v_active);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total := v_total + v_count;
  RAISE NOTICE 'Thembisa POPs 1/2/3 unassigned backfill: % rows', v_count;

  RAISE NOTICE 'Migration 344 complete: % total rows updated (expected ~1031 on first run, 0 on re-run)', v_total;
END;
$$;

COMMIT;
