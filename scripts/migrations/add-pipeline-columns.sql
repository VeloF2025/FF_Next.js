-- Migration: Add POC Validation and Building columns for 2-stage pipeline
-- Run: psql $DATABASE_URL -f scripts/migrations/add-pipeline-columns.sql

-- Insert POC Validation column (after Approved, position 3)
INSERT INTO wishlist_columns (name, color, wip_limit, position)
VALUES ('POC Validation', '#f59e0b', 2, 3)
ON CONFLICT (name) DO NOTHING;

-- Insert Building column (after POC Validation, position 4)
INSERT INTO wishlist_columns (name, color, wip_limit, position)
VALUES ('Building', '#8b5cf6', 1, 4)
ON CONFLICT (name) DO NOTHING;

-- Update positions of existing columns to make room
UPDATE wishlist_columns SET position = 5 WHERE name = 'Done' AND position < 5;

-- Add poc_status and harness_run_id fields to wishlist_items
ALTER TABLE wishlist_items
ADD COLUMN IF NOT EXISTS poc_status VARCHAR(20) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS poc_run_id VARCHAR(100) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS harness_run_id VARCHAR(100) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS pr_url VARCHAR(500) DEFAULT NULL;

-- Add constraint for poc_status
DO $$
BEGIN
  ALTER TABLE wishlist_items
  ADD CONSTRAINT chk_poc_status
  CHECK (poc_status IS NULL OR poc_status IN ('pending', 'running', 'passed', 'failed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN wishlist_items.poc_status IS 'POC validation status: pending, running, passed, failed';
COMMENT ON COLUMN wishlist_items.poc_run_id IS 'POC loop run identifier';
COMMENT ON COLUMN wishlist_items.harness_run_id IS 'Full harness run identifier';
COMMENT ON COLUMN wishlist_items.pr_url IS 'Pull request URL when harness completes';
