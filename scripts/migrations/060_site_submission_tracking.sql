-- Migration 060: Site Submission Tracking & OES Reconciliation
-- Created: 2026-01-16
-- Purpose: Track DR submissions from WA Monitor against drops table, prepare for OES import

-- ============================================
-- PHASE 1: Add site_submitted columns to drops
-- ============================================

ALTER TABLE drops ADD COLUMN IF NOT EXISTS site_submitted BOOLEAN DEFAULT false;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS site_submitted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS site_submitted_by VARCHAR(50); -- phone number
ALTER TABLE drops ADD COLUMN IF NOT EXISTS site_submitted_project VARCHAR(100); -- WA group project
ALTER TABLE drops ADD COLUMN IF NOT EXISTS site_project_mismatch BOOLEAN DEFAULT false;

-- OES reconciliation columns
ALTER TABLE drops ADD COLUMN IF NOT EXISTS oes_confirmed BOOLEAN DEFAULT false;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS oes_confirmed_at TIMESTAMP WITH TIME ZONE;

-- Indexes for queries
CREATE INDEX IF NOT EXISTS idx_drops_site_submitted ON drops(site_submitted) WHERE site_submitted = true;
CREATE INDEX IF NOT EXISTS idx_drops_oes_confirmed ON drops(oes_confirmed) WHERE oes_confirmed = true;

-- ============================================
-- PHASE 2: OES Import Tables
-- ============================================

-- Import batch tracking
CREATE TABLE IF NOT EXISTS oes_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename VARCHAR(255),
  report_date DATE,
  total_rows INTEGER,
  matched_drops INTEGER,
  unmatched_drops INTEGER,
  imported_by VARCHAR(100),
  imported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- OES activations data
CREATE TABLE IF NOT EXISTS oes_activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number VARCHAR(20) NOT NULL,
  drop_id UUID REFERENCES drops(id),
  serial_number VARCHAR(50),
  activation_date DATE,
  olt_address VARCHAR(100),
  ont_rx_sig_dbm DECIMAL(6,3),
  link_budget_ont_olt_db DECIMAL(6,3),
  olt_rx_sig_dbm DECIMAL(6,3),
  link_budget_olt_ont_db DECIMAL(6,3),
  status VARCHAR(50),
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  current_ont_rx DECIMAL(10,6),
  team VARCHAR(50),
  import_batch_id UUID REFERENCES oes_import_batches(id),
  imported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for OES queries
CREATE INDEX IF NOT EXISTS idx_oes_drop_number ON oes_activations(drop_number);
CREATE INDEX IF NOT EXISTS idx_oes_drop_id ON oes_activations(drop_id);
CREATE INDEX IF NOT EXISTS idx_oes_serial ON oes_activations(serial_number);
CREATE INDEX IF NOT EXISTS idx_oes_activation_date ON oes_activations(activation_date);
CREATE INDEX IF NOT EXISTS idx_oes_team ON oes_activations(team);
CREATE INDEX IF NOT EXISTS idx_oes_import_batch ON oes_activations(import_batch_id);

-- ============================================
-- PHASE 3: Backfill existing submissions
-- ============================================

-- Backfill site_submitted from existing qa_photo_reviews
UPDATE drops d
SET
  site_submitted = true,
  site_submitted_at = q.created_at,
  site_submitted_by = q.sender_phone
FROM qa_photo_reviews q
WHERE d.drop_number = q.drop_number
  AND d.site_submitted IS NOT TRUE;
