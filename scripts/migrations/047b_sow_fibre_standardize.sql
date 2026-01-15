-- Migration: 047b_fibre_segments_standardize.sql
-- PRD: PRD-047-project-import-system
-- Description: Standardize fibre_segments table columns for Excel import
-- Date: 2026-01-15
-- Target: fibre_segments table

-- Ensure all required columns exist for fibre import
ALTER TABLE fibre_segments ADD COLUMN IF NOT EXISTS segment_id VARCHAR(255);
ALTER TABLE fibre_segments ADD COLUMN IF NOT EXISTS cable_size VARCHAR(50);
ALTER TABLE fibre_segments ADD COLUMN IF NOT EXISTS layer VARCHAR(50);
ALTER TABLE fibre_segments ADD COLUMN IF NOT EXISTS pon_no INTEGER;
ALTER TABLE fibre_segments ADD COLUMN IF NOT EXISTS zone_no INTEGER;
ALTER TABLE fibre_segments ADD COLUMN IF NOT EXISTS length DECIMAL(10,2);
ALTER TABLE fibre_segments ADD COLUMN IF NOT EXISTS string_completed DECIMAL(10,2);
ALTER TABLE fibre_segments ADD COLUMN IF NOT EXISTS date_completed TIMESTAMP;
ALTER TABLE fibre_segments ADD COLUMN IF NOT EXISTS contractor VARCHAR(100);
ALTER TABLE fibre_segments ADD COLUMN IF NOT EXISTS is_complete BOOLEAN;
ALTER TABLE fibre_segments ADD COLUMN IF NOT EXISTS raw_data JSONB;

-- Add comments for documentation
COMMENT ON COLUMN fibre_segments.segment_id IS 'Segment ID from Excel "label" column (e.g., LAW.PF.288F.AGG.POP.01-MH.A001)';
COMMENT ON COLUMN fibre_segments.cable_size IS 'Cable size from Excel "cable size" column (e.g., 288F)';
COMMENT ON COLUMN fibre_segments.layer IS 'Layer type from Excel "layer" column (e.g., Primary Feeder)';
COMMENT ON COLUMN fibre_segments.string_completed IS 'String completed distance from Excel "String Com" column';
COMMENT ON COLUMN fibre_segments.date_completed IS 'Completion date from Excel "Date Comp" column';
COMMENT ON COLUMN fibre_segments.is_complete IS 'Completion status from Excel "Complete" column (Yes/No -> true/false)';

-- Add index for PON/Zone queries
CREATE INDEX IF NOT EXISTS idx_fibre_segments_pon_zone ON fibre_segments(project_id, pon_no, zone_no);

-- Verification query (run after migration)
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'fibre_segments' ORDER BY ordinal_position;
