-- Migration 519: auto-provision a stock warehouse for every active project
--
-- Why: procurement's GRN and Transfer screens both build their site dropdown
-- from stock_locations. Nothing ever created a location when a project was
-- created, so a site stayed invisible to procurement until somebody remembered
-- to hand-run a seed script. Lizelle hit this on "Phalaborwa - Ben Farm":
-- the project went active in June, the warehouse was never created, and she
-- could not book a GRN against it.
--
-- Rule: a project gets exactly one warehouse location, created the moment it
-- becomes active. Planning / on_hold projects deliberately get nothing — they
-- carry no stock, and padding the dropdown with them trades "my site is
-- missing" for "I picked the wrong site off a long list".
--
-- There are four separate INSERT INTO projects paths in the app, so this is a
-- trigger rather than app code: a fifth call site cannot bypass it.

-- ---------------------------------------------------------------------------
-- Code generator: WH-<ALNUM name, 20 chars>, de-duplicated with a -2/-3 suffix.
-- stock_locations.code carries a UNIQUE constraint, so a collision would
-- otherwise abort the caller's INSERT INTO projects.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_warehouse_code(p_project_name text)
RETURNS varchar(50)
LANGUAGE plpgsql
AS $$
DECLARE
  v_base    text;
  v_code    text;
  v_suffix  int := 1;
BEGIN
  v_base := upper(regexp_replace(coalesce(p_project_name, ''), '[^a-zA-Z0-9]', '', 'g'));
  IF v_base = '' THEN
    v_base := 'SITE';
  END IF;
  v_base := left(v_base, 20);
  v_code := 'WH-' || v_base;

  WHILE EXISTS (SELECT 1 FROM stock_locations WHERE code = v_code) LOOP
    v_suffix := v_suffix + 1;
    v_code := 'WH-' || v_base || '-' || v_suffix;
  END LOOP;

  RETURN v_code;
END;
$$;

-- ---------------------------------------------------------------------------
-- Idempotent provisioner. Safe to call on an already-provisioned project.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ensure_project_warehouse(p_project_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_name        text;
  v_normalised  text;
  v_existing    uuid;
  v_new_id      uuid;
BEGIN
  SELECT project_name INTO v_name FROM projects WHERE id = p_project_id;
  IF v_name IS NULL THEN
    RETURN NULL;
  END IF;

  -- Already linked?
  SELECT id INTO v_existing
    FROM stock_locations
   WHERE project_id = p_project_id
     AND location_type = 'warehouse'
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- An unlinked warehouse already carries this exact name (ignoring spacing and
  -- punctuation) — adopt it instead of creating a duplicate site in the
  -- dropdown. Deliberately an exact normalised match, not a fuzzy one: the
  -- existing data contains near-misses that are different sites
  -- (e.g. "Mafikeng" vs "Mahikeng"), and those need a human decision.
  v_normalised := lower(regexp_replace(v_name, '[^a-zA-Z0-9]', '', 'g'));

  SELECT id INTO v_existing
    FROM stock_locations
   WHERE location_type = 'warehouse'
     AND project_id IS NULL
     AND lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) = v_normalised
   ORDER BY created_at
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE stock_locations
       SET project_id = p_project_id, updated_at = now()
     WHERE id = v_existing;
    RETURN v_existing;
  END IF;

  INSERT INTO stock_locations (code, name, location_type, project_id, is_active, is_virtual, created_by)
  VALUES (generate_warehouse_code(v_name), v_name, 'warehouse', p_project_id, true, false, 'auto-provision')
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Trigger: fire when a project is created active, or transitions into active.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_project_warehouse()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM ensure_project_warehouse(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_project_warehouse_on_active ON projects;
CREATE TRIGGER tr_project_warehouse_on_active
  AFTER INSERT OR UPDATE OF status ON projects
  FOR EACH ROW
  WHEN (NEW.status = 'active')
  EXECUTE FUNCTION trg_project_warehouse();

-- ---------------------------------------------------------------------------
-- Repair FIRST, backfill second. These warehouses were created by hand under a
-- different spelling and never linked to their project. ensure_project_warehouse
-- only adopts an exact normalised name match, so without this step the backfill
-- below would create a SECOND warehouse for the same site (a "Mahikeng"
-- alongside the existing "Mafikeng"). These are name judgements, not something
-- a trigger can infer, so they are listed explicitly.
--
-- Grabouw is on_hold and so is not auto-provisioned, but its warehouse already
-- exists and linking it costs nothing and adds no dropdown entry.
-- ---------------------------------------------------------------------------
UPDATE stock_locations sl
   SET project_id = p.id, updated_at = now()
  FROM projects p
 WHERE sl.project_id IS NULL
   AND sl.location_type = 'warehouse'
   AND (sl.code, p.project_code) IN (
     ('WH-MAF', 'PRJ-1782143116953'),  -- "Mafikeng"       -> Mahikeng
     ('WH-TAV', 'TON'),                -- "Tonga A (Vuma)" -> Tonga
     ('WH-GR',  'PL-01010')            -- "Grabouw"        -> Grabouw (on_hold)
   );

-- ---------------------------------------------------------------------------
-- Backfill: every currently-active project.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN SELECT id, project_name FROM projects WHERE status = 'active' ORDER BY project_name LOOP
    PERFORM ensure_project_warehouse(p.id);
  END LOOP;
END;
$$;
