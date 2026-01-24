-- Migration: 125_olt_mismatch_records.sql
-- Purpose: Store individual OLT mismatch records from Excel imports
-- Date: 2026-01-24

-- Create table to store each mismatch record from OLT imports
-- This allows tracking DRs that don't exist in offline_devices
CREATE TABLE IF NOT EXISTS olt_mismatch_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_id UUID REFERENCES olt_report_imports(id) ON DELETE CASCADE,
  drop_number VARCHAR(20) NOT NULL,
  olt_serial VARCHAR(50),           -- Correct serial from OLT (column B)
  wrong_onemap_serial VARCHAR(50),  -- Wrong serial in 1Map (column V)
  row_index INTEGER,                -- Row in Excel for reference

  -- Fix tracking
  fix_status VARCHAR(20) DEFAULT 'pending', -- pending, fixed, skipped, not_found
  fix_attempted_at TIMESTAMPTZ,
  fix_result TEXT,
  fix_old_value VARCHAR(50),        -- What was in 1Map before fix
  fix_by UUID REFERENCES users(id),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT olt_mismatch_records_status_check
    CHECK (fix_status IN ('pending', 'fixed', 'skipped', 'not_found', 'empty_serial'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_olt_mismatch_drop ON olt_mismatch_records(drop_number);
CREATE INDEX IF NOT EXISTS idx_olt_mismatch_status ON olt_mismatch_records(fix_status);
CREATE INDEX IF NOT EXISTS idx_olt_mismatch_import ON olt_mismatch_records(import_id);

COMMENT ON TABLE olt_mismatch_records IS 'Individual mismatch records from Nokia OLT Excel imports';
COMMENT ON COLUMN olt_mismatch_records.olt_serial IS 'Correct ONT serial from Nokia OLT report';
COMMENT ON COLUMN olt_mismatch_records.wrong_onemap_serial IS 'Wrong serial currently in 1Map that needs fixing';

-- Verify
DO $$
BEGIN
  RAISE NOTICE '=== Migration 125 Complete ===';
  RAISE NOTICE 'Created olt_mismatch_records table for individual mismatch tracking';
END $$;
