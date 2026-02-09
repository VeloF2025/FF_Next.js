-- Migration 170: Contractor Verification System
-- Adds tables for director/staff tracking and verification audit trail

-- ==================== CONTRACTOR DIRECTORS ====================
CREATE TABLE IF NOT EXISTS contractor_directors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  id_number VARCHAR(13),
  id_type VARCHAR(20) DEFAULT 'sa_id',
  id_valid BOOLEAN,
  id_date_of_birth DATE,
  id_gender VARCHAR(20),
  id_citizenship VARCHAR(50),
  cipc_matched BOOLEAN,
  cipc_director_status VARCHAR(50),
  cipc_appointment_date DATE,
  criminal_check_status VARCHAR(20),
  criminal_check_date TIMESTAMPTZ,
  criminal_check_clear BOOLEAN,
  id_photo_verified BOOLEAN,
  id_photo_verified_date TIMESTAMPTZ,
  pep_sanctions_clear BOOLEAN,
  pep_sanctions_date TIMESTAMPTZ,
  is_primary BOOLEAN DEFAULT false,
  role VARCHAR(20) DEFAULT 'director',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contractor_directors_contractor
  ON contractor_directors(contractor_id);
CREATE INDEX IF NOT EXISTS idx_contractor_directors_id_number
  ON contractor_directors(id_number);

-- ==================== CONTRACTOR VERIFICATIONS ====================
CREATE TABLE IF NOT EXISTS contractor_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id VARCHAR(255) NOT NULL,
  director_id UUID REFERENCES contractor_directors(id) ON DELETE SET NULL,
  verification_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  input_data JSONB,
  result_data JSONB,
  api_cost_cents INTEGER,
  api_provider VARCHAR(100),
  api_request_id VARCHAR(255),
  verified_by VARCHAR(255),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contractor_verifications_contractor
  ON contractor_verifications(contractor_id);
CREATE INDEX IF NOT EXISTS idx_contractor_verifications_director
  ON contractor_verifications(director_id);
CREATE INDEX IF NOT EXISTS idx_contractor_verifications_type
  ON contractor_verifications(verification_type);

-- ==================== ADD COLUMNS TO CONTRACTORS ====================
ALTER TABLE contractors
  ADD COLUMN IF NOT EXISTS cipc_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS cipc_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cipc_company_status VARCHAR(100),
  ADD COLUMN IF NOT EXISTS verification_bundle VARCHAR(50);
