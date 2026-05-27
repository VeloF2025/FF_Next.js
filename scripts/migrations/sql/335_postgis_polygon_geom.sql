-- 335_postgis_polygon_geom.sql
-- Add PostGIS-backed polygon geometry alongside existing GeoJSON.
-- Phase 1 of geofence archetype matching (spec 2026-05-08).

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE zone_boundaries ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326);
ALTER TABLE pon_boundaries  ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326);

-- Backfill: GeoJSON Polygon → MultiPolygon, validate, set SRID.
-- ST_MakeValid handles self-intersections; rows that still fail go to a
-- log-only NOTICE so the deploy isn't blocked by a single bad row.
DO $$
DECLARE
  r RECORD;
  bad_zone INT := 0;
  bad_pon  INT := 0;
BEGIN
  FOR r IN SELECT id, geojson FROM zone_boundaries WHERE geom IS NULL LOOP
    BEGIN
      UPDATE zone_boundaries
         SET geom = ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(r.geojson::text), 4326)))
       WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      bad_zone := bad_zone + 1;
      RAISE NOTICE 'zone_boundaries % failed geom backfill: %', r.id, SQLERRM;
    END;
  END LOOP;

  FOR r IN SELECT id, geojson FROM pon_boundaries WHERE geom IS NULL LOOP
    BEGIN
      UPDATE pon_boundaries
         SET geom = ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(r.geojson::text), 4326)))
       WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      bad_pon := bad_pon + 1;
      RAISE NOTICE 'pon_boundaries % failed geom backfill: %', r.id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Backfill complete. zone_boundaries failures=%, pon_boundaries failures=%', bad_zone, bad_pon;
END $$;

CREATE INDEX IF NOT EXISTS idx_zone_boundaries_geom ON zone_boundaries USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_pon_boundaries_geom  ON pon_boundaries  USING GIST (geom);

COMMIT;
