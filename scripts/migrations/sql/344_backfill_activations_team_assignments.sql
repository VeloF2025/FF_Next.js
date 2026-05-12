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

-- Helper: active statuses we touch
-- (closed / resolved / cancelled / verified are left untouched per historic-data scope rule)

-- ── Lawley ────────────────────────────────────────────────────────────────────
UPDATE maintenance_tickets
SET
  assigned_team_id = 'da2ea0dd-d0c3-4afe-bc42-062134c93da9',
  assigned_team    = 'da2ea0dd-d0c3-4afe-bc42-062134c93da9'
WHERE project_id = '4eb13426-b2a1-472d-9b3c-277082ae9b55'
  AND type = 'activations'
  AND assigned_team_id IS NULL
  AND status NOT IN ('closed','resolved','cancelled','verified');

-- ── Mamelodi — unassigned ──────────────────────────────────────────────────────
UPDATE maintenance_tickets
SET
  assigned_team_id = '8e1ab592-8a62-430f-bb62-592cd9bc1f40',
  assigned_team    = '8e1ab592-8a62-430f-bb62-592cd9bc1f40'
WHERE project_id = '7003dc06-9af7-4a7c-bc6c-a177d77784f2'
  AND type = 'activations'
  AND assigned_team_id IS NULL
  AND status NOT IN ('closed','resolved','cancelled','verified');

-- ── Mamelodi — wrong team (Lawley Activations → Mamelodi Activations) ──────────
UPDATE maintenance_tickets
SET
  assigned_team_id = '8e1ab592-8a62-430f-bb62-592cd9bc1f40',
  assigned_team    = '8e1ab592-8a62-430f-bb62-592cd9bc1f40'
WHERE project_id = '7003dc06-9af7-4a7c-bc6c-a177d77784f2'
  AND type = 'activations'
  AND assigned_team_id = 'da2ea0dd-d0c3-4afe-bc42-062134c93da9'
  AND status NOT IN ('closed','resolved','cancelled','verified');

-- ── Mohadin — unassigned ───────────────────────────────────────────────────────
UPDATE maintenance_tickets
SET
  assigned_team_id = '48507948-48ba-4d95-9768-e2b40a6d13bb',
  assigned_team    = '48507948-48ba-4d95-9768-e2b40a6d13bb'
WHERE project_id = 'bf9a90db-e758-4c05-b999-694cd63c451f'
  AND type = 'activations'
  AND assigned_team_id IS NULL
  AND status NOT IN ('closed','resolved','cancelled','verified');

-- ── Mohadin — wrong team (Lawley Activations → Mohadin Activations) ────────────
UPDATE maintenance_tickets
SET
  assigned_team_id = '48507948-48ba-4d95-9768-e2b40a6d13bb',
  assigned_team    = '48507948-48ba-4d95-9768-e2b40a6d13bb'
WHERE project_id = 'bf9a90db-e758-4c05-b999-694cd63c451f'
  AND type = 'activations'
  AND assigned_team_id = 'da2ea0dd-d0c3-4afe-bc42-062134c93da9'
  AND status NOT IN ('closed','resolved','cancelled','verified');

-- ── Thembisa POP 1 ────────────────────────────────────────────────────────────
UPDATE maintenance_tickets
SET
  assigned_team_id = '601b3f04-a60f-4d5b-8301-e32885e31256',
  assigned_team    = '601b3f04-a60f-4d5b-8301-e32885e31256'
WHERE project_id = '7d8b94d6-8e5a-4dbb-9ede-69ce3884e004'
  AND type = 'activations'
  AND assigned_team_id IS NULL
  AND status NOT IN ('closed','resolved','cancelled','verified');

-- ── Thembisa POP 2 ────────────────────────────────────────────────────────────
UPDATE maintenance_tickets
SET
  assigned_team_id = '601b3f04-a60f-4d5b-8301-e32885e31256',
  assigned_team    = '601b3f04-a60f-4d5b-8301-e32885e31256'
WHERE project_id = 'd3df9135-9aa3-415d-87b6-17cce547eb22'
  AND type = 'activations'
  AND assigned_team_id IS NULL
  AND status NOT IN ('closed','resolved','cancelled','verified');

-- ── Thembisa POP 3 ────────────────────────────────────────────────────────────
UPDATE maintenance_tickets
SET
  assigned_team_id = '601b3f04-a60f-4d5b-8301-e32885e31256',
  assigned_team    = '601b3f04-a60f-4d5b-8301-e32885e31256'
WHERE project_id = '1de088dd-fe24-43fb-b8d3-94fca61ef91d'
  AND type = 'activations'
  AND assigned_team_id IS NULL
  AND status NOT IN ('closed','resolved','cancelled','verified');
