-- 383_stock_holders.sql
-- Sprint C: typed custody-identity registry (holder / party model).
-- See docs/superpowers/specs/2026-05-26-holder-party-model-sprintC-design.md
BEGIN;

CREATE TABLE IF NOT EXISTS stock_holders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_type   text NOT NULL,
  staff_id      uuid REFERENCES staff(id),
  contractor_id uuid REFERENCES contractors(id),
  name          text NOT NULL,
  phone         text,
  email         text,
  is_active     boolean NOT NULL DEFAULT true,
  notes         text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_holders_type_chk CHECK (holder_type IN ('staff','contractor','external_person')),
  CONSTRAINT stock_holders_ref_chk CHECK (
       (holder_type = 'staff'           AND staff_id IS NOT NULL AND contractor_id IS NULL)
    OR (holder_type = 'contractor'      AND contractor_id IS NOT NULL AND staff_id IS NULL)
    OR (holder_type = 'external_person' AND staff_id IS NULL AND contractor_id IS NULL)
  )
);

-- One holder per person / org. Partial unique indexes double as ON CONFLICT targets.
CREATE UNIQUE INDEX IF NOT EXISTS stock_holders_staff_uk
  ON stock_holders (staff_id) WHERE holder_type = 'staff';
CREATE UNIQUE INDEX IF NOT EXISTS stock_holders_contractor_uk
  ON stock_holders (contractor_id) WHERE holder_type = 'contractor';

INSERT INTO migrations (version, name, executed_at)
VALUES ('383', 'stock_holders', NOW());

COMMIT;
