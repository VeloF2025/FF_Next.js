-- tests/db/setup/seed.sql
--
-- Test database seed. Mirrors the prod schema for the tables that the Wave 1
-- backfill scripts + PR-6 triggers touch. Verified against migrations
-- 027_field_stock_core.sql, 028_field_stock_transactions.sql, and
-- 029_field_stock_returns.sql.
--
-- Hard rule (from PR-6 schema review): any new column the trigger or backfill
-- touches MUST be added here. If a future migration changes a column,
-- update this seed in the same PR so tests reflect prod.

BEGIN;

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL
);
INSERT INTO projects (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Test Project A');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL
);
INSERT INTO users (id, email) VALUES
  ('22222222-2222-2222-2222-222222222222', 'tester@test.local');

CREATE TABLE staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL
);
INSERT INTO staff (id, full_name) VALUES
  ('33333333-3333-3333-3333-333333333333', 'Test Tech');

-- drops — mirror prod columns needed by:
--   * Trigger 2 (qa_photo_reviews): drop_number text match
--   * Migration 366 trigger (drops AFTER UPDATE OF ont_serial): ont_serial, installed_at
CREATE TABLE drops (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number  TEXT UNIQUE NOT NULL,
  project_id   UUID REFERENCES projects(id),
  ont_serial   TEXT,
  installed_at TIMESTAMPTZ
);
INSERT INTO drops (id, drop_number, project_id) VALUES
  ('44444444-4444-4444-4444-444444444444', 'DR0000001',
   '11111111-1111-1111-1111-111111111111');
-- A second drop row with ont_serial=NULL so the trigger test can UPDATE it.
INSERT INTO drops (id, drop_number, project_id, ont_serial) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'DR0000002',
   '11111111-1111-1111-1111-111111111111', NULL);

-- stock_items — prod schema (PR-7 probe):
--   NO device_type column. Items are identified by item_code.
--   ONT/Gizzu items use item_code 'FT-ONT'/'FT-GIZZU' and category='bootstock'.
--   tracking_type column exists in prod.
CREATE TABLE stock_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code     TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  category      TEXT,
  tracking_type TEXT NOT NULL DEFAULT 'serial'
);
INSERT INTO stock_items (id, item_code, name, category, tracking_type) VALUES
  ('55555555-5555-5555-5555-555555555555', 'FT-ONT',   'FT-ONT',   'bootstock', 'serial'),
  ('66666666-6666-6666-6666-666666666666', 'FT-GIZZU', 'FT-GIZZU', 'bootstock', 'serial');

-- stock_locations (prod migration 027). Required because stock_pickings has
-- two NOT NULL FK columns referencing it (source_location_id, destination_location_id).
CREATE TABLE stock_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  location_type VARCHAR(50) NOT NULL
);
INSERT INTO stock_locations (id, code, name, location_type) VALUES
  ('10000000-0000-0000-0000-000000000001', 'WH-MAIN',  'Main Warehouse', 'warehouse'),
  ('10000000-0000-0000-0000-000000000002', 'TECH-001', 'Tech 1 truck',   'technician');

CREATE TABLE stock_serials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id UUID NOT NULL REFERENCES stock_items(id),
  serial_number TEXT NOT NULL,
  mac_address TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  -- Prod has current_location_id (NOT current_holder_staff_id).
  current_location_id UUID REFERENCES stock_locations(id),
  installed_at_drop_id UUID REFERENCES drops(id),
  installed_at_drop_number VARCHAR(255),
  installed_by VARCHAR(255),
  activated_at_olt_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stock_item_id, serial_number),
  -- Prod status check (migration 362): includes activated, allocated_to_project, in_repair.
  CONSTRAINT stock_serials_status_check CHECK (
    status IN ('available','reserved','allocated_to_project','in_transit','issued',
               'installed','activated','returned','scrapped','faulty','in_repair')
  )
);

INSERT INTO stock_serials (id, stock_item_id, serial_number, status) VALUES
  ('77777777-7777-7777-7777-777777777777',
   '55555555-5555-5555-5555-555555555555',
   'ALCL12345001', 'available');

INSERT INTO stock_serials (id, stock_item_id, serial_number, status,
                           current_location_id) VALUES
  ('88888888-8888-8888-8888-888888888888',
   '55555555-5555-5555-5555-555555555555',
   'ALCL12345002', 'issued',
   '10000000-0000-0000-0000-000000000002');

-- asset_categories — required for assets.category_id FK.
-- Prod schema (PR-7 probe): id UUID PK, name VARCHAR, code VARCHAR, type VARCHAR.
CREATE TABLE asset_categories (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50),
  type VARCHAR(50)
);
INSERT INTO asset_categories (id, name, code, type) VALUES
  ('cc000000-0000-0000-0000-000000000001', 'ONT Device',   'ONTD', 'network_device'),
  ('cc000000-0000-0000-0000-000000000002', 'UPS/Gizzu',    'GZZU', 'network_device');

-- assets — prod schema (PR-7 probe):
--   NO asset_type column, NO mac_address column at top-level.
--   Identified by category_id (FK → asset_categories) + name.
--   Serial-to-stock_item linkage uses stock_item_id FK (nullable).
CREATE TABLE assets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_number   VARCHAR(255) NOT NULL DEFAULT '',
  name           VARCHAR(255) NOT NULL,
  category_id    UUID NOT NULL REFERENCES asset_categories(id),
  serial_number  VARCHAR(255),
  stock_item_id  UUID REFERENCES stock_items(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     VARCHAR(255) NOT NULL DEFAULT 'seed'
);
-- One ONT asset linked to FT-ONT stock_item so the backfill can find it.
INSERT INTO assets (id, asset_number, name, category_id, serial_number, stock_item_id) VALUES
  ('99999999-9999-9999-9999-999999999999',
   'ASSET-ONT-001', 'FT-ONT-UNIT-03',
   'cc000000-0000-0000-0000-000000000001',
   'ALCL12345003',
   '55555555-5555-5555-5555-555555555555'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'ASSET-GZU-001', 'FT-GIZZU-UNIT-04',
   'cc000000-0000-0000-0000-000000000002',
   'GZU0000004',
   '66666666-6666-6666-6666-666666666666');

-- qa_photo_reviews — prod schema (PR-7 probe):
--   NO drop_id column (no FK to drops).
--   Serial column is `ont_serial_scanned`, NOT `ont_serial`.
--   Links to drops via drop_number (text match).
CREATE TABLE qa_photo_reviews (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number        TEXT NOT NULL,
  ont_serial_scanned TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO qa_photo_reviews (drop_number, ont_serial_scanned) VALUES
  ('DR0000001', 'ALCL12345002');

-- Probe 3 confirmed prod uses olt_name, not olt_id.
-- Probe PR-7: oes_pp_data.id is INTEGER (SERIAL), NOT UUID.
--             No `activated_at` or `pon_id` column.
--             Ordering uses `created_at`. PON reference uses `olt_pon` (smallint).
-- HOTFIX (PR-7 blind review): resolution_status column added to mirror prod.
--   Backfill C must filter WHERE resolution_status = 'activated'.
CREATE TABLE oes_pp_data (
  id                SERIAL PRIMARY KEY,
  serial_number     TEXT,
  olt_name          TEXT,
  olt_pon           SMALLINT,
  resolution_status TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- stock_pickings — prod schema (migration 028):
--   picking_number NOT NULL UNIQUE, picking_type NOT NULL CHECK,
--   source_location_id / destination_location_id NOT NULL FKs,
--   contractor_id / contractor_name (used by accountability trigger),
--   technician_id (NOT staff_id).
CREATE TABLE stock_pickings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  picking_number VARCHAR(50) NOT NULL UNIQUE,
  picking_type VARCHAR(50) NOT NULL CHECK (picking_type IN
    ('issue','receipt','return','transfer','scrap')),
  source_location_id UUID NOT NULL REFERENCES stock_locations(id),
  destination_location_id UUID NOT NULL REFERENCES stock_locations(id),
  contractor_id UUID,
  contractor_name VARCHAR(255),
  technician_id UUID,
  technician_name VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'planned',
  -- Prod has no done_at column. Issue moment is COALESCE(signed_at,
  -- effective_date, approved_at) — the trigger reads in that priority.
  signed_at TIMESTAMPTZ,
  effective_date TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- stock_picking_lines — prod schema:
--   stock_item_id NOT NULL, serial_ids UUID[] for serial-tracked items.
--   NO stock_serial_id (column does not exist in prod).
CREATE TABLE stock_picking_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  picking_id UUID NOT NULL REFERENCES stock_pickings(id) ON DELETE CASCADE,
  stock_item_id UUID NOT NULL REFERENCES stock_items(id),
  serial_ids UUID[],
  serial_number TEXT,
  status VARCHAR(50) DEFAULT 'pending'
);

-- Seed: one done picking with one serial-tracked line for ALCL12345002.
WITH p AS (
  INSERT INTO stock_pickings
    (id, picking_number, picking_type, status,
     source_location_id, destination_location_id,
     technician_id, signed_at)
  VALUES (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'PICK-SEED-001',
    'issue',
    'done',
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    '33333333-3333-3333-3333-333333333333',
    NOW())
  RETURNING id
)
INSERT INTO stock_picking_lines (picking_id, stock_item_id, serial_ids, serial_number)
  SELECT id,
         '55555555-5555-5555-5555-555555555555',
         ARRAY['88888888-8888-8888-8888-888888888888'::uuid],
         'ALCL12345002'
  FROM p;

-- stock_returns — prod schema (migration 029):
--   return_number NOT NULL UNIQUE, returned_by_id (NOT staff_id),
--   returned_by_name, contractor_id, contractor_name.
CREATE TABLE stock_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number VARCHAR(50) NOT NULL UNIQUE,
  original_picking_id UUID REFERENCES stock_pickings(id),
  returned_by_id UUID,
  returned_by_name VARCHAR(255),
  contractor_id UUID,
  contractor_name VARCHAR(255),
  return_to_location_id UUID REFERENCES stock_locations(id),
  status VARCHAR(50) DEFAULT 'pending',
  return_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- stock_return_lines — prod schema:
--   serial_id (NOT stock_serial_id), stock_item_id NOT NULL, disposition CHECK.
CREATE TABLE stock_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES stock_returns(id) ON DELETE CASCADE,
  stock_item_id UUID NOT NULL REFERENCES stock_items(id),
  serial_id UUID REFERENCES stock_serials(id),
  serial_number TEXT,
  disposition VARCHAR(50) CHECK (disposition IN
    ('restock','repair','scrap','supplier_return'))
);

-- contractor_stock_accountability — prod has contractor_name NOT NULL plus
-- additional counter columns. Mirror them so the trigger UPSERT works.
CREATE TABLE contractor_stock_accountability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL UNIQUE,
  contractor_name VARCHAR(255) NOT NULL,
  total_issued_count INTEGER NOT NULL DEFAULT 0,
  total_issued_value DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_returned_count INTEGER NOT NULL DEFAULT 0,
  total_returned_value DECIMAL(14,2) NOT NULL DEFAULT 0,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO migrations (version, name) SELECT 361, 'prior_migration_placeholder';

COMMIT;
