-- rollback_335_postgis_polygon_geom.sql
-- Drops geom columns + GIST indexes from zone_boundaries / pon_boundaries.
-- Does NOT drop the PostGIS extension (other features may depend on it).

BEGIN;

DROP INDEX IF EXISTS idx_zone_boundaries_geom;
DROP INDEX IF EXISTS idx_pon_boundaries_geom;

ALTER TABLE zone_boundaries DROP COLUMN IF EXISTS geom;
ALTER TABLE pon_boundaries  DROP COLUMN IF EXISTS geom;

COMMIT;
