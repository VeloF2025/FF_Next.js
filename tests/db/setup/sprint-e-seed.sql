-- tests/db/setup/sprint-e-seed.sql
--
-- Sprint E prerequisite tables and seed data loaded by global-setup.ts
-- AFTER mig 362-367. Creates the tables that mig 383/384/387 depend on,
-- then runs those migrations so the lifecycle triggers are installed in the
-- test container.
--
-- Rules:
--   1. All CREATE TABLE / CREATE TABLE IF NOT EXISTS — never fail if re-run.
--   2. Foreign keys reference tables already in seed.sql (projects, staff, etc.)
--   3. Minimal seed rows inserted with fixed UUIDs for deterministic tests.

BEGIN;

-- Migrations table may lack executed_at (mig 383/384 INSERT uses that column).
ALTER TABLE migrations ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ DEFAULT NOW();

-- contractors — referenced by stock_holders.contractor_id FK.
-- Minimal version; only id + name required for FK validity.
CREATE TABLE IF NOT EXISTS contractors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       varchar(255) NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- field_stock_movements — referenced by mig 384 ALTER TABLE + view.
-- Mirrors the sprint A ledger schema (from_location_id / to_location_id /
-- movement_type / total_cost are what v_holder_accountability reads).
CREATE TABLE IF NOT EXISTS field_stock_movements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_type      varchar(50) NOT NULL,
  stock_item_id      uuid REFERENCES stock_items(id),
  quantity           numeric(12,3) NOT NULL DEFAULT 0,
  unit_cost          numeric(12,2),
  total_cost         numeric(14,2),
  from_location_id   uuid REFERENCES stock_locations(id),
  to_location_id     uuid REFERENCES stock_locations(id),
  reference_table    varchar(50),
  reference_id       uuid,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- stock_consumptions — referenced by mig 384 ADD COLUMN.
-- Minimal columns; full prod schema is not required for lifecycle tests.
CREATE TABLE IF NOT EXISTS stock_consumptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id uuid REFERENCES stock_items(id),
  serial_id     uuid REFERENCES stock_serials(id),
  quantity      numeric(12,3) NOT NULL DEFAULT 1,
  consumed_by   uuid REFERENCES staff(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMIT;
