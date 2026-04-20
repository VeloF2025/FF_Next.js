-- Migration 315: NOC taxonomy — expand type constraint + seed team disciplines
-- (renamed from 278_ — collision with 278_expand_ticket_type_for_disciplines.sql)
--
-- Part of PR 3/4 in the April-11 two-axis taxonomy refactor. Prepares the DB
-- for the auto-ingest classification code changes that land in the same PR:
--
--   1. Expands the maintenance_tickets.type CHECK constraint to accept the
--      5 discipline values added in migration 277 (civils / optical /
--      activations / maintenance / dev_ops) alongside the legacy 15-value
--      vocabulary. Required so the updated TQR snag import and QContact
--      sync can write discipline values into `type`. Every legacy value
--      stays valid — PR 4 is where the enum shrink + data migration ships.
--
--   2. Backfills teams.discipline and teams.project_id from the existing
--      17-row teams table. Rules:
--
--        - name ILIKE '% activations' → discipline = 'activations'
--        - name ILIKE '% civils'      → discipline = 'civils'
--        - name ILIKE '% optical'     → discipline = 'optical'
--        - name ILIKE '% maintenance' → discipline = 'maintenance'
--        - name = 'DevOps'            → discipline = 'dev_ops'
--        - name = 'Cleone Roux'       → discipline = 'maintenance'
--
--      project_id is resolved from the team-name prefix (the word before the
--      discipline suffix) using a case-insensitive match against projects.project_name.
--
--      - 'Lawley*'   → Lawley
--      - 'Mamelodi*' → Mamelodi
--      - 'Mohadin*'  → Mohadin
--      - 'Etwatwa*'  → Etwatwa
--      - 'Tembisa*'  → Thembisa POP 1 (name is misspelled in teams — best
--                      guess; someone will have to reassign if the team
--                      actually covers POP 2 or 3)
--
--      DevOps and Cleone Roux stay project_id = NULL (cross-project).
--
--      Only rows with discipline IS NULL are updated, so re-running this
--      migration won't overwrite any manual corrections made via the teams
--      admin UI afterwards.
--
-- Related: migrations 270 (teams), 274 (sub_type), 277 (ticket_category +
-- team.discipline column + team.project_id column).

-- ---------------------------------------------------------------------------
-- Part 1: expand maintenance_tickets.type CHECK to accept discipline values
-- ---------------------------------------------------------------------------

ALTER TABLE maintenance_tickets
  DROP CONSTRAINT IF EXISTS maintenance_tickets_type_check;

ALTER TABLE maintenance_tickets
  ADD CONSTRAINT maintenance_tickets_type_check
  CHECK (type IN (
    -- Legacy vocabulary from migration 274 (stays until PR 4)
    'fault', 'fault_repair', 'installation', 'new_installation',
    'modification', 'ont_swap', 'incident', 'other',
    'hse_incident', 'hse_near_miss',
    'serial_mismatch', 'pre_provision', 'olt_investigation',
    'dev_ops', 'snag', 'internal_snag',
    'sales_lead', 'unspecified',
    -- Disciplines (April-11 two-axis taxonomy)
    'civils', 'optical', 'activations', 'maintenance'
  ));

-- ---------------------------------------------------------------------------
-- Part 2: backfill teams.discipline + teams.project_id
-- ---------------------------------------------------------------------------

-- Discipline backfill. Only touches rows where discipline is still NULL —
-- safe to re-run after manual corrections.
UPDATE teams SET discipline = 'dev_ops'
  WHERE discipline IS NULL AND LOWER(TRIM(name)) IN ('devops', 'dev ops', 'dev_ops');

UPDATE teams SET discipline = 'activations'
  WHERE discipline IS NULL AND name ILIKE '% activations';

UPDATE teams SET discipline = 'civils'
  WHERE discipline IS NULL AND name ILIKE '% civils';

UPDATE teams SET discipline = 'optical'
  WHERE discipline IS NULL AND (name ILIKE '% optical' OR name ILIKE '% splic%' OR name ILIKE '% fibre%');

UPDATE teams SET discipline = 'maintenance'
  WHERE discipline IS NULL AND (name ILIKE '% maintenance' OR name ILIKE '% maint');

-- Cleone Roux is a single-person internal maintenance team — catch it with
-- an exact name match since it has no discipline suffix.
UPDATE teams SET discipline = 'maintenance'
  WHERE discipline IS NULL AND name = 'Cleone Roux';

-- project_id backfill. Resolve the project by matching the team-name prefix
-- against projects.project_name. Only touches rows where project_id is NULL.

UPDATE teams t
SET project_id = p.id
FROM projects p
WHERE t.project_id IS NULL
  AND t.name ILIKE 'Lawley %'
  AND p.project_name = 'Lawley';

UPDATE teams t
SET project_id = p.id
FROM projects p
WHERE t.project_id IS NULL
  AND t.name ILIKE 'Mamelodi %'
  AND p.project_name = 'Mamelodi';

UPDATE teams t
SET project_id = p.id
FROM projects p
WHERE t.project_id IS NULL
  AND t.name ILIKE 'Mohadin %'
  AND p.project_name = 'Mohadin';

UPDATE teams t
SET project_id = p.id
FROM projects p
WHERE t.project_id IS NULL
  AND t.name ILIKE 'Etwatwa %'
  AND p.project_name = 'Etwatwa';

-- Tembisa teams → Thembisa POP 1 (best guess; the team name is misspelled,
-- and there are 3 POPs on the project side). Someone can re-point via the
-- teams admin UI if the team actually covers POP 2 or POP 3.
UPDATE teams t
SET project_id = p.id
FROM projects p
WHERE t.project_id IS NULL
  AND t.name ILIKE 'Tembisa %'
  AND p.project_name = 'Thembisa POP 1';
