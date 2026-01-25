-- Migration 118: Pipeline Service Authorities & Enhancements
-- Description: Add service authorities database, compulsory services flag, and lease/cession tracking
-- Created: 2026-01-25

-- ============================================================================
-- 1. SERVICE AUTHORITIES DATABASE
-- ============================================================================
-- Stores contact details for each service provider per region/municipality

CREATE TABLE IF NOT EXISTS pipeline_service_authorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Service Type Link
  approval_type_id UUID REFERENCES pipeline_approval_types(id) ON DELETE CASCADE,

  -- Location (where this authority operates)
  province VARCHAR(100),
  municipality VARCHAR(100),
  region VARCHAR(100),  -- Sub-area if applicable

  -- Authority Details
  authority_name VARCHAR(255) NOT NULL,
  department VARCHAR(255),

  -- Contact Information
  contact_name VARCHAR(255),
  contact_title VARCHAR(100),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  contact_mobile VARCHAR(50),

  -- Physical Address
  physical_address TEXT,
  postal_address TEXT,

  -- Office Details
  office_hours VARCHAR(100),
  website VARCHAR(500),

  -- Processing Info
  typical_turnaround_days INTEGER,
  application_fee DECIMAL(10,2),
  notes TEXT,

  -- Status
  is_active BOOLEAN DEFAULT true,
  verified_at TIMESTAMP WITH TIME ZONE,
  verified_by UUID REFERENCES staff(id),

  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES staff(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by UUID REFERENCES staff(id)
);

-- Indexes for fast search
CREATE INDEX IF NOT EXISTS idx_service_auth_type ON pipeline_service_authorities(approval_type_id);
CREATE INDEX IF NOT EXISTS idx_service_auth_province ON pipeline_service_authorities(province);
CREATE INDEX IF NOT EXISTS idx_service_auth_municipality ON pipeline_service_authorities(municipality);
CREATE INDEX IF NOT EXISTS idx_service_auth_active ON pipeline_service_authorities(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_service_auth_search ON pipeline_service_authorities
  USING gin(to_tsvector('english', authority_name || ' ' || COALESCE(department, '') || ' ' || COALESCE(municipality, '')));

-- ============================================================================
-- 2. UPDATE APPROVAL TYPES - ADD COMPULSORY FLAG
-- ============================================================================

ALTER TABLE pipeline_approval_types ADD COLUMN IF NOT EXISTS
  is_compulsory BOOLEAN DEFAULT false;
ALTER TABLE pipeline_approval_types ADD COLUMN IF NOT EXISTS
  condition_type VARCHAR(50); -- 'rural_only', 'urban_only', null = always applies

-- Add generic municipal service types for compulsory tracking
INSERT INTO pipeline_approval_types (code, name, category, description, is_compulsory, default_required, typical_duration_days, display_order)
VALUES
  ('municipal_roads_stormwater', 'Municipal Roads & Stormwater', 'municipal', 'Municipal roads and stormwater infrastructure approval', true, true, 60, 100),
  ('municipal_water_sanitation', 'Municipal Water & Sanitation', 'municipal', 'Municipal water and sanitation infrastructure approval', true, true, 60, 101),
  ('municipal_electricity', 'Municipal Electricity', 'municipal', 'Municipal electricity infrastructure approval', true, true, 60, 102)
ON CONFLICT (code) DO UPDATE SET
  is_compulsory = true,
  default_required = true;

-- Mark existing services as compulsory
UPDATE pipeline_approval_types SET is_compulsory = true, default_required = true
WHERE code IN (
  'wayleave_eskom',
  'wayleave_transnet',
  'wayleave_sasol',
  'wayleave_air_products',
  'wayleave_rand_water'
);

-- Mark Tribal Authority as conditional (rural only)
UPDATE pipeline_approval_types
SET is_compulsory = true, default_required = true, condition_type = 'rural_only'
WHERE code = 'traditional_council';

-- ============================================================================
-- 3. ADD LEASE & CESSION FIELDS TO PROJECTS
-- ============================================================================

-- Lease Agreement tracking
ALTER TABLE pipeline_projects ADD COLUMN IF NOT EXISTS
  lease_agreement_status VARCHAR(30) DEFAULT 'not_started';
ALTER TABLE pipeline_projects ADD COLUMN IF NOT EXISTS
  lease_agreement_date DATE;
ALTER TABLE pipeline_projects ADD COLUMN IF NOT EXISTS
  lease_agreement_document_url VARCHAR(500);
ALTER TABLE pipeline_projects ADD COLUMN IF NOT EXISTS
  lease_agreement_notes TEXT;

-- Cession tracking
ALTER TABLE pipeline_projects ADD COLUMN IF NOT EXISTS
  cession_status VARCHAR(30) DEFAULT 'not_started';
ALTER TABLE pipeline_projects ADD COLUMN IF NOT EXISTS
  cession_date DATE;
ALTER TABLE pipeline_projects ADD COLUMN IF NOT EXISTS
  cession_document_url VARCHAR(500);
ALTER TABLE pipeline_projects ADD COLUMN IF NOT EXISTS
  cession_notes TEXT;

-- Rural project flag (for conditional services like Tribal Authority)
ALTER TABLE pipeline_projects ADD COLUMN IF NOT EXISTS
  is_rural BOOLEAN DEFAULT false;

-- ============================================================================
-- 4. LINK APPROVALS TO AUTHORITIES
-- ============================================================================

ALTER TABLE pipeline_project_approvals ADD COLUMN IF NOT EXISTS
  service_authority_id UUID REFERENCES pipeline_service_authorities(id) ON DELETE SET NULL;

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

DO $$
DECLARE
  auth_count INTEGER;
  compulsory_count INTEGER;
BEGIN
  -- Check table was created
  SELECT COUNT(*) INTO auth_count FROM information_schema.tables
  WHERE table_name = 'pipeline_service_authorities';

  -- Count compulsory types
  SELECT COUNT(*) INTO compulsory_count
  FROM pipeline_approval_types
  WHERE is_compulsory = true;

  RAISE NOTICE 'Migration 118: Service authorities table created: %', (auth_count > 0);
  RAISE NOTICE 'Migration 118: Compulsory approval types: %', compulsory_count;
END $$;
