-- 454: H&S Permit to Work (goal Phase 4)
--
-- Permit types carry a mandatory precondition checklist; permit instances move
-- through a server-enforced lifecycle (requested → approved → active → closed,
-- plus rejected/expired). An expired permit — one whose validity window has
-- lapsed while still approved/active — must visibly block, so the effective
-- status is derived at read time from valid_to (goal §7.4), never left as a
-- stale 'active'.
--
-- Idempotent. Rollback: rollback_454_hs_permits.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS hs_permit_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          varchar(64) NOT NULL,
  name          varchar(160) NOT NULL,
  description   text,
  -- [{ "text": "...", "required": true }, ...]
  preconditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS hs_permit_types_code_key ON hs_permit_types (code);

CREATE TABLE IF NOT EXISTS hs_permits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_type_id   uuid NOT NULL REFERENCES hs_permit_types(id) ON DELETE RESTRICT,
  permit_number    varchar(40) NOT NULL,
  project_id       uuid REFERENCES projects(id) ON DELETE SET NULL,
  title            varchar(200) NOT NULL,
  work_description text,
  location         text,
  status           varchar(20) NOT NULL DEFAULT 'requested',
  valid_from       timestamptz,
  valid_to         timestamptz,
  requested_by     uuid,
  approved_by      uuid,
  approved_at      timestamptz,
  -- confirmed precondition texts (subset of the type's preconditions)
  precondition_confirmed jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes            text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_permits_status_check
    CHECK (status IN ('requested','approved','active','closed','expired','rejected')),
  CONSTRAINT hs_permits_validity_order
    CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS hs_permits_number_key ON hs_permits (permit_number);
CREATE INDEX IF NOT EXISTS hs_permits_project_idx ON hs_permits (project_id);
CREATE INDEX IF NOT EXISTS hs_permits_status_idx ON hs_permits (status);
CREATE INDEX IF NOT EXISTS hs_permits_valid_to_idx ON hs_permits (valid_to);

-- Seed the statutory permit types with their precondition checklists (idempotent)
INSERT INTO hs_permit_types (code, name, description, preconditions, sort_order)
SELECT v.code, v.name, v.description, v.preconditions::jsonb, v.sort_order
FROM (VALUES
  ('hot_work', 'Hot Work', 'Welding, cutting, grinding — any spark/flame producing work',
    '[{"text":"Fire extinguisher present and serviced","required":true},{"text":"Combustibles removed or protected within 10m","required":true},{"text":"Fire watch assigned","required":true},{"text":"Gas test completed (if applicable)","required":false}]', 10),
  ('confined_space', 'Confined Space Entry', 'Entry into tanks, chambers, trenches >1.5m',
    '[{"text":"Atmospheric test completed (O2, LEL, toxic)","required":true},{"text":"Continuous ventilation in place","required":true},{"text":"Standby person / rescue plan in place","required":true},{"text":"Communication method confirmed","required":true}]', 20),
  ('excavation', 'Excavation', 'Trenching / excavation per Construction Reg 13',
    '[{"text":"Underground services located and marked","required":true},{"text":"Shoring / sloping in place for depth >1.5m","required":true},{"text":"Spoil kept >1m from edge","required":true},{"text":"Access/egress provided","required":true}]', 30),
  ('working_at_heights', 'Working at Heights', 'Work at height per Construction Reg 8',
    '[{"text":"Fall protection plan communicated","required":true},{"text":"Harnesses inspected and anchor points certified","required":true},{"text":"Edge protection / guardrails in place","required":true},{"text":"Exclusion zone below established","required":false}]', 40),
  ('electrical', 'Electrical Work', 'Live or near-live electrical work; LOTO',
    '[{"text":"Lock-out / tag-out applied and verified","required":true},{"text":"Circuit proven dead","required":true},{"text":"Competent person (wireman) assigned","required":true},{"text":"Insulated tools / PPE in use","required":true}]', 50)
) AS v(code, name, description, preconditions, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM hs_permit_types t WHERE t.code = v.code);

COMMIT;
