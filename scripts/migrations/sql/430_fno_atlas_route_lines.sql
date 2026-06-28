-- Migration 430: FNO Atlas route-line storage
-- Purpose: store source-backed cable/backhaul route geometries separately from coverage polygons.

CREATE TABLE IF NOT EXISTS fno_atlas_route_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES fno_atlas_operators(id) ON DELETE CASCADE,
  source_id UUID REFERENCES fno_atlas_sources(id) ON DELETE SET NULL,
  ingestion_run_id UUID REFERENCES fno_atlas_ingestion_runs(id) ON DELETE SET NULL,
  external_id TEXT,
  route_name TEXT,
  route_type TEXT NOT NULL DEFAULT 'unknown',
  network_type TEXT NOT NULL DEFAULT 'backhaul',
  confidence TEXT NOT NULL DEFAULT 'needs_verification',
  geom geometry(MultiLineString, 4326) NOT NULL,
  bbox geometry(Polygon, 4326) GENERATED ALWAYS AS (ST_Envelope(geom)) STORED,
  raw_properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fno_atlas_route_lines_type_check
    CHECK (route_type IN ('fibre_route', 'duct_route', 'backhaul_route', 'unknown')),
  CONSTRAINT fno_atlas_route_lines_network_type_check
    CHECK (network_type IN ('ftth', 'fttb', 'backhaul', 'wireless', 'mixed', 'unknown')),
  CONSTRAINT fno_atlas_route_lines_confidence_check
    CHECK (confidence IN ('high', 'medium', 'low', 'needs_verification')),
  CONSTRAINT fno_atlas_route_lines_valid_geom
    CHECK (ST_IsValid(geom))
);

ALTER TABLE fno_atlas_project_overlays
  ADD COLUMN IF NOT EXISTS route_line_id UUID REFERENCES fno_atlas_route_lines(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_fno_atlas_route_lines_operator_type
  ON fno_atlas_route_lines(operator_id, route_type, network_type);
CREATE INDEX IF NOT EXISTS idx_fno_atlas_route_lines_geom
  ON fno_atlas_route_lines USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_fno_atlas_route_lines_bbox
  ON fno_atlas_route_lines USING GIST (bbox);
CREATE INDEX IF NOT EXISTS idx_fno_atlas_project_overlays_route
  ON fno_atlas_project_overlays(route_line_id, fit_score DESC);

COMMENT ON TABLE fno_atlas_route_lines IS
  'Source-backed FNO/backhaul cable/duct/route linework. Keep separate from polygon coverage areas.';

INSERT INTO schema_migrations (filename, applied_at)
VALUES ('430_fno_atlas_route_lines.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
