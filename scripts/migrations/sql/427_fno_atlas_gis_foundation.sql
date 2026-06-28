-- Migration 427: FNO Atlas GIS foundation
-- Purpose: replace concept-only FNO Atlas data with source-backed coverage storage.
-- Notes:
--   * Additive only. No production data mutation outside new fno_atlas_* tables.
--   * Uses PostGIS geometry(MultiPolygon, 4326) for real coverage polygons.
--   * Project overlays are stored as computed evidence, not hand-authored claims.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS fno_atlas_operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  operator_type TEXT NOT NULL DEFAULT 'fno',
  website_url TEXT,
  brand_color TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fno_atlas_operators_status_check
    CHECK (status IN ('active', 'monitoring', 'inactive', 'needs_verification')),
  CONSTRAINT fno_atlas_operators_type_check
    CHECK (operator_type IN ('fno', 'backhaul', 'aggregator', 'isp_partner'))
);

CREATE TABLE IF NOT EXISTS fno_atlas_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID REFERENCES fno_atlas_operators(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  access_method TEXT NOT NULL,
  terms_notes TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fno_atlas_sources_type_check
    CHECK (source_type IN ('official_map', 'official_api', 'partner_aggregator', 'public_page', 'pdf', 'manual')),
  CONSTRAINT fno_atlas_sources_access_check
    CHECK (access_method IN ('api', 'playwright', 'static_fetch', 'manual_upload', 'commercial_api'))
);

CREATE TABLE IF NOT EXISTS fno_atlas_ingestion_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES fno_atlas_sources(id) ON DELETE SET NULL,
  run_status TEXT NOT NULL DEFAULT 'started',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_imported INTEGER NOT NULL DEFAULT 0,
  records_failed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT NOT NULL DEFAULT 'system',
  CONSTRAINT fno_atlas_ingestion_runs_status_check
    CHECK (run_status IN ('started', 'success', 'partial', 'failed', 'dry_run'))
);

CREATE TABLE IF NOT EXISTS fno_atlas_coverage_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES fno_atlas_operators(id) ON DELETE CASCADE,
  source_id UUID REFERENCES fno_atlas_sources(id) ON DELETE SET NULL,
  ingestion_run_id UUID REFERENCES fno_atlas_ingestion_runs(id) ON DELETE SET NULL,
  external_id TEXT,
  area_name TEXT,
  province TEXT,
  municipality TEXT,
  suburb TEXT,
  rollout_status TEXT NOT NULL DEFAULT 'unknown',
  network_type TEXT NOT NULL DEFAULT 'unknown',
  confidence TEXT NOT NULL DEFAULT 'needs_verification',
  geom geometry(MultiPolygon, 4326) NOT NULL,
  centroid geometry(Point, 4326) GENERATED ALWAYS AS (ST_Centroid(geom)) STORED,
  bbox geometry(Polygon, 4326) GENERATED ALWAYS AS (ST_Envelope(geom)) STORED,
  raw_properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fno_atlas_coverage_status_check
    CHECK (rollout_status IN ('live', 'wip', 'planned', 'coming_soon', 'unknown', 'not_available')),
  CONSTRAINT fno_atlas_coverage_network_type_check
    CHECK (network_type IN ('ftth', 'fttb', 'backhaul', 'wireless', 'mixed', 'unknown')),
  CONSTRAINT fno_atlas_coverage_confidence_check
    CHECK (confidence IN ('high', 'medium', 'low', 'needs_verification')),
  CONSTRAINT fno_atlas_coverage_valid_geom
    CHECK (ST_IsValid(geom))
);

CREATE TABLE IF NOT EXISTS fno_atlas_project_overlays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  project_code TEXT,
  operator_id UUID NOT NULL REFERENCES fno_atlas_operators(id) ON DELETE CASCADE,
  coverage_area_id UUID REFERENCES fno_atlas_coverage_areas(id) ON DELETE CASCADE,
  match_type TEXT NOT NULL,
  distance_m NUMERIC,
  overlap_ratio NUMERIC,
  fit_score NUMERIC NOT NULL DEFAULT 0,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fno_atlas_project_overlay_match_check
    CHECK (match_type IN ('inside_coverage', 'near_coverage', 'backhaul_nearby', 'no_match')),
  CONSTRAINT fno_atlas_project_overlay_score_check
    CHECK (fit_score >= 0 AND fit_score <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fno_atlas_operators_slug
  ON fno_atlas_operators(slug);
CREATE INDEX IF NOT EXISTS idx_fno_atlas_sources_operator
  ON fno_atlas_sources(operator_id, is_active, priority);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fno_atlas_sources_url_unique
  ON fno_atlas_sources(source_url);
CREATE INDEX IF NOT EXISTS idx_fno_atlas_runs_source_started
  ON fno_atlas_ingestion_runs(source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_fno_atlas_coverage_operator_status
  ON fno_atlas_coverage_areas(operator_id, rollout_status, network_type);
CREATE INDEX IF NOT EXISTS idx_fno_atlas_coverage_geom
  ON fno_atlas_coverage_areas USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_fno_atlas_coverage_centroid
  ON fno_atlas_coverage_areas USING GIST (centroid);
CREATE INDEX IF NOT EXISTS idx_fno_atlas_project_overlays_project
  ON fno_atlas_project_overlays(project_id, fit_score DESC);
CREATE INDEX IF NOT EXISTS idx_fno_atlas_project_overlays_operator
  ON fno_atlas_project_overlays(operator_id, fit_score DESC);

INSERT INTO fno_atlas_operators (slug, name, operator_type, website_url, brand_color, notes)
VALUES
  ('openserve', 'Openserve', 'fno', 'https://openserve.co.za/connect/home/fibre', '#0072BC', 'Official address coverage portal; national incumbent layer.'),
  ('vumatel', 'Vumatel', 'fno', 'https://vumatel.co.za/', '#EC008C', 'Official portal plus partner/ISP coverage sources required.'),
  ('frogfoot', 'Frogfoot', 'fno', 'https://www.frogfoot.co.za/coverage/', '#76B82A', 'Official coverage map with live/WIP/planned status indicators.'),
  ('metrofibre', 'MetroFibre', 'fno', 'https://metrofibre.co.za/', '#00A3AD', 'Official/partner coverage verification required.'),
  ('octotel', 'Octotel', 'fno', 'https://octotel.co.za/coverage-map/', '#F58220', 'Western Cape focused coverage source.'),
  ('herotel', 'Herotel', 'fno', 'https://herotel.com/', '#E31E24', 'Small town fibre/wireless distinction must be captured.'),
  ('evotel', 'Evotel', 'fno', 'https://evotel.co.za/', '#6F2DBD', 'Suburb-specific verification needed.'),
  ('fibertime', 'Fibertime', 'fno', 'https://fibertime.com/', '#FFD400', 'Township/low-LSM/prepaid rollout source.'),
  ('net99', 'Net Nine Nine', 'fno', 'https://netninenine.co.za/', '#FF6A00', 'Affordable prepaid/home fibre rollout source.'),
  ('dfa', 'DFA', 'backhaul', 'https://dfafrica.co.za/', '#003A70', 'Backhaul/dark fibre reference layer.'),
  ('liquid', 'Liquid Intelligent Technologies', 'backhaul', 'https://za.liquid.tech/about-us/our-network/', '#00AEEF', 'Enterprise/backbone and cross-border capacity layer.'),
  ('seacom', 'SEACOM', 'backhaul', 'https://seacom.com/', '#E31B23', 'Carrier/IP transit/backbone layer.'),
  ('broadband-infraco', 'Broadband Infraco', 'backhaul', 'https://www.infraco.co.za/', '#007A3D', 'National wholesale backbone for rural aggregation.'),
  ('link-africa', 'Link Africa', 'backhaul', 'https://linkafrica.co.za/', '#F5B400', 'Municipal duct/metro route validation layer.'),
  ('zoom-fibre', 'Zoom Fibre', 'fno', 'https://zoomfibre.co.za/', '#00A3E0', 'Selected estate/suburb coverage source.'),
  ('lightstruck', 'Lightstruck', 'fno', 'https://www.lightstruck.co.za/', '#5B2CFF', 'Selected Cape/estate coverage source.')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  operator_type = EXCLUDED.operator_type,
  website_url = EXCLUDED.website_url,
  brand_color = EXCLUDED.brand_color,
  notes = EXCLUDED.notes,
  updated_at = NOW();

INSERT INTO fno_atlas_sources (operator_id, source_name, source_url, source_type, access_method, priority)
SELECT o.id, s.source_name, s.source_url, s.source_type, s.access_method, s.priority
FROM (VALUES
  ('frogfoot', 'Frogfoot official coverage', 'https://www.frogfoot.co.za/coverage/', 'official_map', 'playwright', 10),
  ('vumatel', 'Vumatel official website', 'https://vumatel.co.za/', 'official_map', 'playwright', 20),
  ('openserve', 'Openserve fibre coverage', 'https://openserve.co.za/connect/home/fibre', 'official_map', 'playwright', 20),
  ('fibertime', 'Fibertime website', 'https://fibertime.com/', 'official_map', 'playwright', 30),
  ('net99', 'Net Nine Nine website', 'https://netninenine.co.za/', 'official_map', 'playwright', 30),
  (NULL, 'Atomic coverage aggregator', 'https://www.atomic.co.za/coverage/', 'partner_aggregator', 'playwright', 40),
  (NULL, '28East coverage API docs', 'https://docs.api.coverage.28east.co.za/documentation', 'partner_aggregator', 'commercial_api', 50),
  (NULL, 'Telcotech coverage API', 'https://www.telcotech.co/CoverageAPI', 'partner_aggregator', 'commercial_api', 50)
) AS s(slug, source_name, source_url, source_type, access_method, priority)
LEFT JOIN fno_atlas_operators o ON o.slug = s.slug
ON CONFLICT DO NOTHING;

COMMENT ON TABLE fno_atlas_coverage_areas IS
  'Source-backed FNO/backhaul coverage polygons for FNO Atlas. Do not store hand-drawn concept markers here.';
COMMENT ON TABLE fno_atlas_project_overlays IS
  'Computed project-to-FNO evidence, refreshed from real coverage geometries and project/drop coordinates.';
