-- Migration: 109_qfield_import_tables.sql
-- Description: QField GeoPackage Import — tables for joints, cable spans,
--              zone/PON boundaries, POPs, and import job tracking
-- Created: 2026-02-13

-- ============================================================================
-- 1. JOINTS — dome joints, splice closures, splitters
-- ============================================================================

CREATE TABLE IF NOT EXISTS joints (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  joint_label VARCHAR(255) NOT NULL,
  joint_type VARCHAR(100),            -- Enclosure, Splitter
  cable_capacity VARCHAR(50),         -- 1:8F, 1:16F, 144F, 72F
  latitude NUMERIC,
  longitude NUMERIC,
  pon_no INTEGER,
  zone_no INTEGER,
  layer VARCHAR(100),
  status VARCHAR(50) DEFAULT 'planned',
  source VARCHAR(50) DEFAULT 'qfield',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, joint_label)
);

CREATE INDEX IF NOT EXISTS idx_joints_project ON joints(project_id);
CREATE INDEX IF NOT EXISTS idx_joints_zone_pon ON joints(zone_no, pon_no);

-- ============================================================================
-- 2. CABLE SPANS — cable run segments between joints/poles
-- ============================================================================

CREATE TABLE IF NOT EXISTS cable_spans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  span_label VARCHAR(255) NOT NULL,
  cable_size VARCHAR(50),             -- 24F, 96F, 144F, 288F
  span_type VARCHAR(100),             -- Distribution, Secondary Feeder, Primary Feeder
  pon_no INTEGER,
  zone_no INTEGER,
  length_meters NUMERIC,
  status VARCHAR(50) DEFAULT 'planned',
  geojson JSONB,                      -- MultiLineString geometry
  source VARCHAR(50) DEFAULT 'qfield',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, span_label)
);

CREATE INDEX IF NOT EXISTS idx_cable_spans_project ON cable_spans(project_id);

-- ============================================================================
-- 3. ZONE BOUNDARIES — zone polygon boundaries
-- ============================================================================

CREATE TABLE IF NOT EXISTS zone_boundaries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  zone_no INTEGER NOT NULL,
  geojson JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, zone_no)
);

-- ============================================================================
-- 4. PON BOUNDARIES — PON polygon boundaries
-- ============================================================================

CREATE TABLE IF NOT EXISTS pon_boundaries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pon_no INTEGER NOT NULL,
  zone_no INTEGER,
  pon_label VARCHAR(255),
  geojson JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, pon_no)
);

-- ============================================================================
-- 5. POPS — Point of Presence locations
-- ============================================================================

CREATE TABLE IF NOT EXISTS pops (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pop_label VARCHAR(255),
  geojson JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, pop_label)
);

-- ============================================================================
-- 6. QFIELD IMPORT JOBS — import job tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS qfield_import_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  qfield_project_id VARCHAR(100),
  status VARCHAR(50) DEFAULT 'pending',
  layer_counts JSONB DEFAULT '{}',
  records_created INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 7. ALTER EXISTING TABLES — source tracking + QField audit columns
-- ============================================================================

-- Add source tracking + QField audit columns to poles
ALTER TABLE poles ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'sow';
ALTER TABLE poles ADD COLUMN IF NOT EXISTS dome_joint VARCHAR(50);
ALTER TABLE poles ADD COLUMN IF NOT EXISTS type_of_join VARCHAR(50);
ALTER TABLE poles ADD COLUMN IF NOT EXISTS splitter VARCHAR(50);
ALTER TABLE poles ADD COLUMN IF NOT EXISTS slack_on_pole VARCHAR(50);
ALTER TABLE poles ADD COLUMN IF NOT EXISTS field_agent VARCHAR(255);
ALTER TABLE poles ADD COLUMN IF NOT EXISTS pole_planted VARCHAR(100);
ALTER TABLE poles ADD COLUMN IF NOT EXISTS audit_complete DATE;

-- Add source tracking to drops
ALTER TABLE drops ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'sow';

-- ============================================================================
-- 8. VERIFICATION — confirm all tables created successfully
-- ============================================================================

SELECT 'joints' AS table_name, count(*) AS row_count FROM joints
UNION ALL
SELECT 'cable_spans', count(*) FROM cable_spans
UNION ALL
SELECT 'zone_boundaries', count(*) FROM zone_boundaries
UNION ALL
SELECT 'pon_boundaries', count(*) FROM pon_boundaries
UNION ALL
SELECT 'pops', count(*) FROM pops
UNION ALL
SELECT 'qfield_import_jobs', count(*) FROM qfield_import_jobs;
