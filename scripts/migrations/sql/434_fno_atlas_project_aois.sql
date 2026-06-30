-- Migration 434: FNO Atlas 1Map project AOI polygons
-- Stores generated area-only footprints from 1Map GPS points. These are NOT official FNO coverage polygons.

CREATE TABLE IF NOT EXISTS fno_atlas_project_aois (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID REFERENCES fno_atlas_operators(id) ON DELETE SET NULL,
  source_id UUID REFERENCES fno_atlas_sources(id) ON DELETE SET NULL,
  ingestion_run_id UUID REFERENCES fno_atlas_ingestion_runs(id) ON DELETE SET NULL,
  site_code TEXT NOT NULL,
  area_name TEXT NOT NULL,
  area_kind TEXT NOT NULL DEFAULT 'onemap_site_aoi',
  point_count INTEGER NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'medium',
  geom geometry(MultiPolygon, 4326) NOT NULL,
  centroid geometry(Point, 4326) GENERATED ALWAYS AS (ST_Centroid(geom)) STORED,
  bbox geometry(Polygon, 4326) GENERATED ALWAYS AS (ST_Envelope(geom)) STORED,
  raw_properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fno_atlas_project_aois_area_kind_check
    CHECK (area_kind IN ('onemap_site_aoi')),
  CONSTRAINT fno_atlas_project_aois_confidence_check
    CHECK (confidence IN ('high', 'medium', 'low', 'needs_verification')),
  CONSTRAINT fno_atlas_project_aois_point_count_check
    CHECK (point_count > 0),
  CONSTRAINT fno_atlas_project_aois_valid_geom
    CHECK (ST_IsValid(geom))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fno_atlas_project_aois_active_site_source
  ON fno_atlas_project_aois(source_id, site_code, area_name)
  WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fno_atlas_project_aois_operator
  ON fno_atlas_project_aois(operator_id, site_code)
  WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fno_atlas_project_aois_geom
  ON fno_atlas_project_aois USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_fno_atlas_project_aois_bbox
  ON fno_atlas_project_aois USING GIST (bbox);

COMMENT ON TABLE fno_atlas_project_aois IS
  'Generated area-only Velocity/1Map AOI polygons for FNO Atlas. These are derived from 1Map GPS source data and must not be labelled as official FNO-published coverage.';

INSERT INTO schema_migrations (filename, applied_at)
VALUES ('434_fno_atlas_project_aois.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
