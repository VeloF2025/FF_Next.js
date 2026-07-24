-- 451: H&S training matrix & competency (goal Phases 4-9, PR Phase 1)
--
-- Adds the two tables the contractor gate's training weight needs in order to
-- stop being inert. Before this, hs_contractor_compliance.training_score was a
-- stored column nobody ever populated (NULL for all 5 real contractors), and
-- the only "training" surface was four hand-toggled booleans on a jsonb column.
--
-- Worker model (decided against goal §4.2 after checking the live data):
--   §4.2 assumed "workers are staff". True for INTERNAL workers — `staff`
--   holds 91 Velocity employees. But the gate is per-CONTRACTOR, and contractor
--   field workers are NOT in `staff`. `team_members` exists for them, but every
--   one of its 65 rows has contractor_id NULL and an unresolved team_id — it is
--   unlinked demo residue, so it cannot by itself tell us which contractor a
--   worker belongs to. §4.2 anticipated this ("if field workers are not in
--   staff, use the existing field-worker records rather than inventing"), so:
--     * hs_worker_training references a worker polymorphically — exactly one of
--       staff_id (→staff) or team_member_id (→team_members) — inventing NO new
--       person table, and
--     * carries contractor_id directly (the authoritative worker→contractor
--       link for gate aggregation, since team_members' own link is broken).
--   contractor_id NULL = internal-staff training (surfaced in the matrix and
--   the expiring-soon dashboard, but never feeds a contractor gate).
--
-- Competency status (current / expiring_soon / expired) is derived in SQL from
-- expiry_date at read time (goal §4.7) — never stored, never stale.
--
-- Idempotent: safe to run against live and to re-run under the deploy's
-- run-pending-migrations.sh. Rollback: rollback_451_hs_training_matrix.sql.

BEGIN;

-- ---------------------------------------------------------------------------
-- Training / competency type catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hs_training_types (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                varchar(64)  NOT NULL,
  name                varchar(160) NOT NULL,
  description         text,
  -- NULL = competency never expires; else refresher cadence in months
  validity_months     integer,
  is_statutory        boolean NOT NULL DEFAULT false,
  requires_certificate boolean NOT NULL DEFAULT true,
  is_active           boolean NOT NULL DEFAULT true,
  sort_order          integer NOT NULL DEFAULT 0,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_training_types_validity_positive
    CHECK (validity_months IS NULL OR validity_months > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS hs_training_types_code_key
  ON hs_training_types (code);

-- ---------------------------------------------------------------------------
-- Per-worker training records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hs_worker_training (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_type_id   uuid NOT NULL REFERENCES hs_training_types(id) ON DELETE RESTRICT,
  -- exactly one worker reference (enforced below)
  staff_id           uuid REFERENCES staff(id) ON DELETE CASCADE,
  team_member_id     uuid REFERENCES team_members(id) ON DELETE CASCADE,
  -- authoritative worker→contractor link for gate aggregation; NULL = internal
  contractor_id      uuid REFERENCES contractors(id) ON DELETE CASCADE,
  -- display snapshot so the safety file and lists render without a live join
  worker_name        text NOT NULL,
  project_id         uuid REFERENCES projects(id) ON DELETE SET NULL,
  completed_date     date NOT NULL,
  -- NULL = no expiry; else drives competency status in SQL
  expiry_date        date,
  certificate_url    text,
  certificate_number varchar(120),
  issued_by          varchar(160),
  notes              text,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_worker_training_one_worker
    CHECK ((staff_id IS NOT NULL)::int + (team_member_id IS NOT NULL)::int = 1),
  CONSTRAINT hs_worker_training_expiry_after_completed
    CHECK (expiry_date IS NULL OR expiry_date >= completed_date)
);

CREATE INDEX IF NOT EXISTS hs_worker_training_contractor_idx
  ON hs_worker_training (contractor_id);
CREATE INDEX IF NOT EXISTS hs_worker_training_staff_idx
  ON hs_worker_training (staff_id);
CREATE INDEX IF NOT EXISTS hs_worker_training_team_member_idx
  ON hs_worker_training (team_member_id);
CREATE INDEX IF NOT EXISTS hs_worker_training_type_idx
  ON hs_worker_training (training_type_id);
CREATE INDEX IF NOT EXISTS hs_worker_training_expiry_idx
  ON hs_worker_training (expiry_date);
CREATE INDEX IF NOT EXISTS hs_worker_training_project_idx
  ON hs_worker_training (project_id);

-- ---------------------------------------------------------------------------
-- Seed the statutory SA-construction training catalogue (idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO hs_training_types (code, name, description, validity_months, is_statutory, requires_certificate, sort_order)
SELECT v.code, v.name, v.description, v.validity_months, v.is_statutory, v.requires_certificate, v.sort_order
FROM (VALUES
  ('working_at_heights', 'Working at Heights', 'Fall protection / work at height competency per Construction Reg 8', 24, true,  true, 10),
  ('fall_arrest',        'Fall Arrest Systems', 'Fall-arrest equipment use and rescue', 24, true, true, 20),
  ('first_aid',          'First Aid (Level 1)', 'First aid competency per General Safety Reg 3', 36, true, true, 30),
  ('fire_fighting',      'Basic Fire Fighting', 'Fire prevention and extinguisher use per Construction Reg 29', 24, true, true, 40),
  ('confined_space',     'Confined Space Entry', 'Entry, atmospheric testing and rescue for confined spaces', 24, true, true, 50),
  ('hira',               'HIRA', 'Hazard Identification & Risk Assessment competency', 24, true, true, 60),
  ('she_rep',            'SHE Representative', 'Safety, Health & Environment rep training per OHS Act s17', 12, true, true, 70),
  ('ohs_induction',      'OHS Site Induction', 'General site safety induction per Construction Reg 7', 12, true, false, 80),
  ('excavation',         'Excavation Safety', 'Trenching and excavation safety per Construction Reg 13', 24, true, true, 90),
  ('electrical_safety',  'Electrical Safety / LOTO', 'Lock-out tag-out and electrical safety awareness', 24, true, true, 100)
) AS v(code, name, description, validity_months, is_statutory, requires_certificate, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM hs_training_types t WHERE t.code = v.code
);

COMMIT;
