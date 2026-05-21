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

CREATE TABLE drops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number TEXT UNIQUE NOT NULL,
  project_id UUID REFERENCES projects(id)
);
INSERT INTO drops (id, drop_number, project_id) VALUES
  ('44444444-4444-4444-4444-444444444444', 'DR0000001',
   '11111111-1111-1111-1111-111111111111');

CREATE TABLE stock_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT UNIQUE NOT NULL,
  device_type TEXT NOT NULL
);
INSERT INTO stock_items (id, sku, device_type) VALUES
  ('55555555-5555-5555-5555-555555555555', 'ONT-NOKIA-G140W-H', 'ont'),
  ('66666666-6666-6666-6666-666666666666', 'GIZZU-30W',         'gizzu');

CREATE TABLE stock_serials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id UUID NOT NULL REFERENCES stock_items(id),
  serial_number TEXT NOT NULL,
  mac_address TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  current_holder_staff_id UUID REFERENCES staff(id),
  current_location_id UUID,
  installed_at_drop_id UUID REFERENCES drops(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stock_item_id, serial_number),
  CONSTRAINT stock_serials_status_check CHECK (
    status IN ('available','reserved','in_transit','issued',
               'installed','returned','scrapped','faulty')
  )
);

INSERT INTO stock_serials (id, stock_item_id, serial_number, status) VALUES
  ('77777777-7777-7777-7777-777777777777',
   '55555555-5555-5555-5555-555555555555',
   'ALCL12345001', 'available');

INSERT INTO stock_serials (id, stock_item_id, serial_number, status,
                           current_holder_staff_id) VALUES
  ('88888888-8888-8888-8888-888888888888',
   '55555555-5555-5555-5555-555555555555',
   'ALCL12345002', 'issued',
   '33333333-3333-3333-3333-333333333333');

CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  mac_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO assets (id, asset_type, serial_number, mac_address) VALUES
  ('99999999-9999-9999-9999-999999999999', 'ont', 'ALCL12345003', 'AA:BB:CC:00:00:03'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'gizzu', 'GZU0000004', NULL);

CREATE TABLE qa_photo_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id UUID REFERENCES drops(id),
  drop_number TEXT,
  ont_serial TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO qa_photo_reviews (drop_id, drop_number, ont_serial) VALUES
  ('44444444-4444-4444-4444-444444444444', 'DR0000001', 'ALCL12345002');

CREATE TABLE oes_pp_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number TEXT,
  olt_id TEXT,
  pon_id TEXT,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE stock_pickings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  picking_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  contractor_id UUID,
  staff_id UUID REFERENCES staff(id),
  done_at TIMESTAMPTZ
);

CREATE TABLE stock_picking_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  picking_id UUID NOT NULL REFERENCES stock_pickings(id) ON DELETE CASCADE,
  stock_serial_id UUID REFERENCES stock_serials(id),
  serial_number TEXT
);

WITH p AS (
  INSERT INTO stock_pickings (id, picking_type, status, staff_id, done_at)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'issue', 'done',
          '33333333-3333-3333-3333-333333333333', NOW())
  RETURNING id
)
INSERT INTO stock_picking_lines (picking_id, stock_serial_id, serial_number)
  SELECT id, '88888888-8888-8888-8888-888888888888', 'ALCL12345002' FROM p;

CREATE TABLE stock_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending_inspection',
  staff_id UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE stock_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES stock_returns(id) ON DELETE CASCADE,
  stock_serial_id UUID REFERENCES stock_serials(id),
  serial_number TEXT,
  disposition TEXT
);

CREATE TABLE contractor_stock_accountability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL,
  total_issued_count INTEGER NOT NULL DEFAULT 0,
  total_returned_count INTEGER NOT NULL DEFAULT 0,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (contractor_id)
);

CREATE TABLE migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO migrations (version, name) SELECT 361, 'prior_migration_placeholder';

COMMIT;
