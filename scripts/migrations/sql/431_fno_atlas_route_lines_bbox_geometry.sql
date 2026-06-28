-- Migration 431: allow route-line bbox envelopes for linear geometries
-- Purpose: ST_Envelope over a line can return a LineString/Point for degenerate route extents.

ALTER TABLE fno_atlas_route_lines
  DROP COLUMN IF EXISTS bbox;

ALTER TABLE fno_atlas_route_lines
  ADD COLUMN bbox geometry(Geometry, 4326) GENERATED ALWAYS AS (ST_Envelope(geom)) STORED;

DROP INDEX IF EXISTS idx_fno_atlas_route_lines_bbox;
CREATE INDEX IF NOT EXISTS idx_fno_atlas_route_lines_bbox
  ON fno_atlas_route_lines USING GIST (bbox);

INSERT INTO schema_migrations (filename, applied_at)
VALUES ('431_fno_atlas_route_lines_bbox_geometry.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
