-- Migration: 163_olt_auto_detect.sql
-- Purpose: Support automated OLT mismatch detection from OES data
-- Date: 2026-02-07

-- Track detection source on existing mismatch records
ALTER TABLE olt_mismatch_records
  ADD COLUMN IF NOT EXISTS detection_source VARCHAR(20) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS oes_batch_id UUID,
  ADD COLUMN IF NOT EXISTS onemap_source VARCHAR(20);

COMMENT ON COLUMN olt_mismatch_records.detection_source IS 'How the mismatch was detected: manual (Excel import) or auto (OES import)';
COMMENT ON COLUMN olt_mismatch_records.oes_batch_id IS 'OES import batch that triggered auto-detection';
COMMENT ON COLUMN olt_mismatch_records.onemap_source IS 'Where 1Map data came from: cache or api';

-- Index on onemap_properties for JOIN performance
CREATE INDEX IF NOT EXISTS idx_onemap_properties_drop_number
  ON onemap_properties(drop_number);

-- Queue for 1Map API lookups on cache misses
CREATE TABLE IF NOT EXISTS olt_onemap_lookup_queue (
  id SERIAL PRIMARY KEY,
  drop_number VARCHAR(20) NOT NULL,
  oes_serial VARCHAR(50) NOT NULL,
  oes_batch_id UUID NOT NULL,
  team VARCHAR(50),
  status VARCHAR(20) DEFAULT 'pending',
  onemap_serial VARCHAR(50),
  onemap_ups_serial VARCHAR(50),
  mismatch_type VARCHAR(30),
  error_message TEXT,
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_olt_lookup_queue_status
  ON olt_onemap_lookup_queue(status) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_olt_lookup_queue_batch
  ON olt_onemap_lookup_queue(oes_batch_id);

-- Auto-detect run tracking
CREATE TABLE IF NOT EXISTS olt_auto_detect_runs (
  id SERIAL PRIMARY KEY,
  oes_batch_id UUID NOT NULL,
  total_oes_rows INTEGER NOT NULL,
  cache_hits INTEGER DEFAULT 0,
  cache_misses INTEGER DEFAULT 0,
  matches INTEGER DEFAULT 0,
  mismatches_note2 INTEGER DEFAULT 0,
  mismatches_note4 INTEGER DEFAULT 0,
  ups_swaps INTEGER DEFAULT 0,
  duplicates_skipped INTEGER DEFAULT 0,
  api_lookups_queued INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'running',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_olt_auto_detect_runs_batch
  ON olt_auto_detect_runs(oes_batch_id);

-- Verify
DO $$
BEGIN
  RAISE NOTICE '=== Migration 163 Complete ===';
  RAISE NOTICE 'Added detection_source, oes_batch_id, onemap_source to olt_mismatch_records';
  RAISE NOTICE 'Created olt_onemap_lookup_queue table';
  RAISE NOTICE 'Created olt_auto_detect_runs table';
  RAISE NOTICE 'Added index on onemap_properties(drop_number)';
END $$;
