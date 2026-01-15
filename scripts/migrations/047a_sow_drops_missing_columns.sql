-- Migration: 047a_drops_missing_columns.sql
-- PRD: PRD-047-project-import-system
-- Description: Add missing columns to drops table for complete Excel field mapping
-- Date: 2026-01-15
-- Target: public.drops table (not sow_drops view, not onemap.drops)

-- Add missing columns that the data processor expects but DB doesn't have
-- Note: drops already has: cable_length, pole_number, latitude, longitude, address, zone_code, pon_code
ALTER TABLE public.drops ADD COLUMN IF NOT EXISTS cable_type VARCHAR(50);
ALTER TABLE public.drops ADD COLUMN IF NOT EXISTS cable_spec VARCHAR(100);
ALTER TABLE public.drops ADD COLUMN IF NOT EXISTS cable_capacity VARCHAR(20);
ALTER TABLE public.drops ADD COLUMN IF NOT EXISTS start_point VARCHAR(100);
ALTER TABLE public.drops ADD COLUMN IF NOT EXISTS end_point VARCHAR(100);
ALTER TABLE public.drops ADD COLUMN IF NOT EXISTS municipality VARCHAR(100);
ALTER TABLE public.drops ADD COLUMN IF NOT EXISTS pon_no INTEGER;
ALTER TABLE public.drops ADD COLUMN IF NOT EXISTS zone_no INTEGER;
ALTER TABLE public.drops ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);
ALTER TABLE public.drops ADD COLUMN IF NOT EXISTS raw_data JSONB;

-- Add comments for documentation
COMMENT ON COLUMN drops.cable_type IS 'Cable type from Excel "type" column (e.g., Cable)';
COMMENT ON COLUMN drops.cable_spec IS 'Fibre specification from Excel "spec" column (e.g., SM/G657A2)';
COMMENT ON COLUMN drops.cable_capacity IS 'Fibre count from Excel "cblcpty" column (e.g., 1F)';
COMMENT ON COLUMN drops.start_point IS 'Start feature from Excel "strtfeat" column (e.g., LAW.P.A002)';
COMMENT ON COLUMN drops.end_point IS 'End feature/ONT from Excel "endfeat" column (e.g., LAW.ONT.DR1737348)';
COMMENT ON COLUMN drops.raw_data IS 'Original Excel row data as JSON for reference';

-- Add index for common PON/Zone queries
CREATE INDEX IF NOT EXISTS idx_drops_pon_zone ON drops(project_id, pon_no, zone_no);

-- Verification query (run after migration)
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'drops' ORDER BY ordinal_position;
