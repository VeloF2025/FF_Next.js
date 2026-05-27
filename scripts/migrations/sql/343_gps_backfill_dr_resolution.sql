-- Migration 343: Add GPS coordinates to oes_pp_data and dr_photo_unified_reviews
-- Backfills existing resolved records from drops → oes_activations → onemap_drops

-- 1. Add columns
ALTER TABLE oes_pp_data
  ADD COLUMN IF NOT EXISTS latitude  NUMERIC,
  ADD COLUMN IF NOT EXISTS longitude NUMERIC;

ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS latitude  NUMERIC,
  ADD COLUMN IF NOT EXISTS longitude NUMERIC;

-- 2. Backfill oes_pp_data from drops (highest priority)
UPDATE oes_pp_data pp
SET latitude  = d.latitude,
    longitude = d.longitude,
    updated_at = NOW()
FROM drops d
WHERE d.drop_number = pp.resolved_drop_number
  AND pp.resolved_drop_number IS NOT NULL
  AND pp.latitude IS NULL
  AND d.latitude IS NOT NULL
  AND d.longitude IS NOT NULL;

-- 3. Backfill oes_pp_data from oes_activations (fallback)
UPDATE oes_pp_data pp
SET latitude  = oa.latitude,
    longitude = oa.longitude,
    updated_at = NOW()
FROM oes_activations oa
WHERE oa.drop_number = pp.resolved_drop_number
  AND pp.resolved_drop_number IS NOT NULL
  AND pp.latitude IS NULL
  AND oa.latitude IS NOT NULL
  AND oa.longitude IS NOT NULL;

-- 4. Backfill oes_pp_data from onemap_drops (second fallback)
UPDATE oes_pp_data pp
SET latitude  = od.latitude::numeric,
    longitude = od.longitude::numeric,
    updated_at = NOW()
FROM onemap_drops od
WHERE od.drop_number = pp.resolved_drop_number
  AND pp.resolved_drop_number IS NOT NULL
  AND pp.latitude IS NULL
  AND od.latitude IS NOT NULL
  AND od.longitude IS NOT NULL;

-- 5. Backfill dr_photo_unified_reviews from drops
-- (ur.drop_number is NOT NULL constrained, so no extra guard is needed)
UPDATE dr_photo_unified_reviews ur
SET latitude  = d.latitude,
    longitude = d.longitude,
    updated_at = NOW()
FROM drops d
WHERE d.drop_number = ur.drop_number
  AND ur.latitude IS NULL
  AND d.latitude IS NOT NULL
  AND d.longitude IS NOT NULL;

-- 6. Backfill dr_photo_unified_reviews from oes_activations (fallback)
UPDATE dr_photo_unified_reviews ur
SET latitude  = oa.latitude,
    longitude = oa.longitude,
    updated_at = NOW()
FROM oes_activations oa
WHERE oa.drop_number = ur.drop_number
  AND ur.latitude IS NULL
  AND oa.latitude IS NOT NULL
  AND oa.longitude IS NOT NULL;

-- 7. Backfill drops table GPS from oes_activations (fill planning gaps)
UPDATE drops d
SET latitude  = oa.latitude,
    longitude = oa.longitude,
    updated_at = NOW()
FROM oes_activations oa
WHERE oa.drop_number = d.drop_number
  AND d.latitude IS NULL
  AND oa.latitude IS NOT NULL
  AND oa.longitude IS NOT NULL;

-- 8. Backfill drops table GPS from onemap_drops (second fallback)
UPDATE drops d
SET latitude  = od.latitude::numeric,
    longitude = od.longitude::numeric,
    updated_at = NOW()
FROM onemap_drops od
WHERE od.drop_number = d.drop_number
  AND d.latitude IS NULL
  AND od.latitude IS NOT NULL
  AND od.longitude IS NOT NULL;
