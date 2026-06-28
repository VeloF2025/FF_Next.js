-- Migration 428: FNO Atlas presence points
-- Purpose: store source-backed low-LSM/township service-area markers separately from polygon coverage.
-- These are not coverage polygons; they are explicit public-map township/presence markers.

CREATE TABLE IF NOT EXISTS fno_atlas_presence_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES fno_atlas_operators(id) ON DELETE CASCADE,
  source_id UUID REFERENCES fno_atlas_sources(id) ON DELETE SET NULL,
  ingestion_run_id UUID REFERENCES fno_atlas_ingestion_runs(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  point_name TEXT NOT NULL,
  service_status TEXT NOT NULL DEFAULT 'presence_marker',
  network_type TEXT NOT NULL DEFAULT 'ftth',
  confidence TEXT NOT NULL DEFAULT 'medium',
  geom geometry(Point, 4326) NOT NULL,
  raw_properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fno_atlas_presence_points_external_unique UNIQUE (source_id, external_id),
  CONSTRAINT fno_atlas_presence_points_confidence_check CHECK (confidence IN ('high', 'medium', 'low')),
  CONSTRAINT fno_atlas_presence_points_status_check CHECK (service_status IN ('presence_marker', 'planned', 'live', 'unknown'))
);

CREATE INDEX IF NOT EXISTS idx_fno_atlas_presence_points_operator
  ON fno_atlas_presence_points(operator_id);

CREATE INDEX IF NOT EXISTS idx_fno_atlas_presence_points_geom
  ON fno_atlas_presence_points USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_fno_atlas_presence_points_raw_gin
  ON fno_atlas_presence_points USING GIN (raw_properties);

INSERT INTO fno_atlas_sources (
  operator_id, source_name, source_url, source_type, access_method, priority, terms_notes, last_checked_at
)
SELECT o.id,
  'Fibertime public township map markers',
  'https://fibertime.com/',
  'official_map',
  'static_fetch',
  15,
  'Official Fibertime landing page embeds township lat/lng map markers. These are presence markers, not polygon coverage boundaries.',
  NOW()
FROM fno_atlas_operators o
WHERE o.slug = 'fibertime'
ON CONFLICT (source_url) DO UPDATE SET
  operator_id = EXCLUDED.operator_id,
  source_name = EXCLUDED.source_name,
  source_type = EXCLUDED.source_type,
  access_method = EXCLUDED.access_method,
  priority = EXCLUDED.priority,
  terms_notes = EXCLUDED.terms_notes,
  last_checked_at = NOW(),
  updated_at = NOW();

INSERT INTO schema_migrations (filename, applied_at)
VALUES ('428_fno_atlas_presence_points.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
