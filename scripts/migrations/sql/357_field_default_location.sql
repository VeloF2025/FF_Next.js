-- Migration 357: Insert FIELD-DEFAULT virtual destination location
--
-- Purpose: The /my/stores issue PWA needs a stable destination location UUID
--   for all field-issue pickings. Rather than resolving it at runtime, a known
--   synthetic UUID is seeded here so locationDefaults.ts can hard-code the
--   constant and the pickings body is always valid.
--
-- UUID chosen: 00000000-0000-0000-0000-000000000001
--   Deliberately synthetic (all-zeros prefix) so it is visually distinct from
--   real data rows and can never collide with gen_random_uuid() output.
--
-- location_type: 'transit'
--   The CHECK constraint on stock_locations.location_type accepts:
--     warehouse | site_store | transit | technician | customer | scrap | adjustment
--   'transit' is the closest semantic fit: stock that has left the warehouse and
--   is moving to field technicians. 'field' is not a valid value.
--
-- is_virtual: true
--   There is no physical shelf for this location; it is a logical sink for
--   all field-issue transactions until per-technician van-stock locations are
--   wired up end-to-end.
--
-- Idempotent: INSERT ... ON CONFLICT (id) DO NOTHING, so re-running the
--   migration on a DB that already has the row is safe.

INSERT INTO stock_locations (
  id,
  code,
  name,
  location_type,
  is_virtual,
  is_active,
  created_at,
  updated_at,
  created_by
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'FIELD-DEFAULT',
  'FIELD-DEFAULT',
  'transit',
  true,
  true,
  NOW(),
  NOW(),
  'system'
)
ON CONFLICT (id) DO NOTHING;
