-- tests/db/setup/sprint-e-holders-seed.sql
--
-- Seed stock_holders rows for Sprint E tests. Loaded AFTER mig 383 has
-- created the stock_holders table.
--
-- Uses fixed UUIDs in the ee* range to avoid collisions with seed.sql rows
-- (which use 11..99 prefix ranges).

BEGIN;

INSERT INTO stock_holders (id, holder_type, staff_id, name, is_active)
VALUES
  -- A staff holder for the test technician (staff_id from seed.sql row 33*3).
  ('ee000000-0000-0000-0000-000000000001',
   'staff',
   '33333333-3333-3333-3333-333333333333',
   'Test Tech Holder',
   true)
ON CONFLICT (id) DO NOTHING;

COMMIT;
