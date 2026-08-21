-- 514_staff_assigned_project.sql
--
-- Gives the stores issue flow a way to know which site a person belongs to, so
-- the "issue to" picker can show only the people who work at the store being
-- issued from.
--
-- Two halves, because the flow needs BOTH sides of the comparison:
--
--   1. staff.assigned_project_id — the person's home site, set by an admin.
--      Distinct from staff.declared_project_id (migration 513), which the
--      worker sets themselves at login. Admin assignment wins where it is set;
--      the declaration remains the fallback. Casuals do not move between sites,
--      so an admin-set value is the durable answer and the declaration covers
--      anyone not yet assigned.
--
--   2. stock_locations.project_id — which site a warehouse serves. The column
--      already existed but was NULL for all 17 warehouses, so nothing could be
--      compared against. Without this the picker has no site to match on.
--
-- The warehouse->project mapping below is NOT derived from name similarity.
-- Warehouse and project names disagree in ways that make fuzzy matching unsafe:
-- 'Tembisa 1' vs 'Thembisa POP 1', 'Tembelihle' vs "Themb'elihle", and a bare
-- 'Mohadin' that could mean either 'Mohadin' or 'Mohadin Ph 2'. Each row here
-- was confirmed by Hein on 2026-08-21 rather than guessed. Unmapped warehouses
-- stay NULL on purpose — an unmapped store shows everyone rather than
-- filtering to the wrong site.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS assigned_project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_project_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_project_by uuid REFERENCES staff(id) ON DELETE SET NULL;

COMMENT ON COLUMN staff.assigned_project_id IS
  'Admin-set home site. Takes precedence over declared_project_id when resolving which site a person belongs to.';

-- Partial index: the picker only ever looks up people who HAVE a site.
CREATE INDEX IF NOT EXISTS idx_staff_assigned_project
  ON staff (assigned_project_id)
  WHERE assigned_project_id IS NOT NULL;

-- Warehouse -> project, confirmed 2026-08-21. Matched on the stable `code`,
-- never on name. Each statement is independently safe to re-run and a warehouse
-- whose code is absent simply updates nothing.
UPDATE stock_locations l SET project_id = p.id
FROM projects p
WHERE l.code = 'WH-Law'   AND p.project_name = 'Lawley'                 AND l.project_id IS DISTINCT FROM p.id;
UPDATE stock_locations l SET project_id = p.id
FROM projects p
WHERE l.code = 'WH-ETW'   AND p.project_name = 'Etwatwa'                AND l.project_id IS DISTINCT FROM p.id;
UPDATE stock_locations l SET project_id = p.id
FROM projects p
WHERE l.code = 'WH-MamP1' AND p.project_name = 'Mamelodi'               AND l.project_id IS DISTINCT FROM p.id;
UPDATE stock_locations l SET project_id = p.id
FROM projects p
WHERE l.code = 'WH-TBL'   AND p.project_name = 'Themb''elihle'          AND l.project_id IS DISTINCT FROM p.id;
UPDATE stock_locations l SET project_id = p.id
FROM projects p
WHERE l.code = 'WH-Moh'   AND p.project_name = 'Mohadin'                AND l.project_id IS DISTINCT FROM p.id;
UPDATE stock_locations l SET project_id = p.id
FROM projects p
WHERE l.code = 'WH-Tem1'  AND p.project_name = 'Thembisa POP 1'         AND l.project_id IS DISTINCT FROM p.id;
UPDATE stock_locations l SET project_id = p.id
FROM projects p
WHERE l.code = 'WH-Tem2'  AND p.project_name = 'Thembisa POP 2'         AND l.project_id IS DISTINCT FROM p.id;
UPDATE stock_locations l SET project_id = p.id
FROM projects p
WHERE l.code = 'WH-Tem3'  AND p.project_name = 'Thembisa POP 3'         AND l.project_id IS DISTINCT FROM p.id;
