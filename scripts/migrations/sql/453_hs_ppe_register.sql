-- 453: H&S PPE catalogue + issuance register (goal Phase 3)
--
-- Records personal protective equipment issued to workers for the safety file:
-- a catalogue of PPE types (with a replacement lifespan that drives due-dates),
-- and per-issue records with size/quantity, the worker's acknowledgement
-- e-signature (§4.5) and a computed replacement-due date.
--
-- Worker model matches the toolbox register (Phase 2): worker_name required,
-- optional mutually-exclusive staff_id/team_member_id link, contractor_id
-- carried for per-contractor rollups. A strict one-worker rule would be
-- unusable — field crews include workers in neither table.
--
-- Idempotent. Rollback: rollback_453_hs_ppe_register.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS hs_ppe_catalogue (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              varchar(64) NOT NULL,
  name              varchar(160) NOT NULL,
  description       text,
  -- head | eye | hand | foot | body | hearing | respiratory | fall | other
  category          varchar(32) NOT NULL DEFAULT 'other',
  -- NULL = no scheduled replacement; else drives replacement_due on issue
  lifespan_months   integer,
  -- available sizes, e.g. ["S","M","L"] or ["8","9","10"]
  sizes             jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active         boolean NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 0,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_ppe_catalogue_lifespan_positive
    CHECK (lifespan_months IS NULL OR lifespan_months > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS hs_ppe_catalogue_code_key ON hs_ppe_catalogue (code);

CREATE TABLE IF NOT EXISTS hs_ppe_issuance (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ppe_item_id    uuid NOT NULL REFERENCES hs_ppe_catalogue(id) ON DELETE RESTRICT,
  staff_id       uuid REFERENCES staff(id) ON DELETE SET NULL,
  team_member_id uuid REFERENCES team_members(id) ON DELETE SET NULL,
  contractor_id  uuid REFERENCES contractors(id) ON DELETE SET NULL,
  worker_name    text NOT NULL,
  project_id     uuid REFERENCES projects(id) ON DELETE SET NULL,
  size           varchar(32),
  quantity       integer NOT NULL DEFAULT 1,
  issued_date    date NOT NULL,
  -- NULL = no scheduled replacement; else issued_date + catalogue lifespan
  replacement_due date,
  -- §4.5 acknowledgement e-signature
  signature_name text,
  signed_at      timestamptz,
  signed_by      uuid,
  signed_ip      varchar(64),
  notes          text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_ppe_issuance_at_most_one_worker
    CHECK (NOT (staff_id IS NOT NULL AND team_member_id IS NOT NULL)),
  CONSTRAINT hs_ppe_issuance_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS hs_ppe_issuance_item_idx ON hs_ppe_issuance (ppe_item_id);
CREATE INDEX IF NOT EXISTS hs_ppe_issuance_project_idx ON hs_ppe_issuance (project_id);
CREATE INDEX IF NOT EXISTS hs_ppe_issuance_contractor_idx ON hs_ppe_issuance (contractor_id);
CREATE INDEX IF NOT EXISTS hs_ppe_issuance_due_idx ON hs_ppe_issuance (replacement_due);

-- Seed a common SA-construction PPE catalogue (idempotent)
INSERT INTO hs_ppe_catalogue (code, name, category, lifespan_months, sizes, sort_order)
SELECT v.code, v.name, v.category, v.lifespan_months, v.sizes::jsonb, v.sort_order
FROM (VALUES
  ('hard_hat',      'Hard Hat',              'head',        24, '[]', 10),
  ('safety_boots',  'Safety Boots',          'foot',        12, '["6","7","8","9","10","11","12"]', 20),
  ('hi_vis_vest',   'Hi-Vis Vest',           'body',        12, '["S","M","L","XL","2XL"]', 30),
  ('safety_gloves', 'Safety Gloves',         'hand',         6, '["S","M","L","XL"]', 40),
  ('safety_glasses','Safety Glasses',        'eye',         12, '[]', 50),
  ('ear_plugs',     'Ear Plugs',             'hearing',      3, '[]', 60),
  ('dust_mask',     'Dust Mask (FFP2)',      'respiratory',  1, '[]', 70),
  ('fall_harness',  'Full Body Harness',     'fall',        60, '["M/L","XL"]', 80),
  ('overalls',      'Overalls',              'body',        12, '["S","M","L","XL","2XL"]', 90)
) AS v(code, name, category, lifespan_months, sizes, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM hs_ppe_catalogue c WHERE c.code = v.code);

COMMIT;
