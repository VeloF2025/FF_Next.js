-- Migration: 061_qa_review_history.sql
-- Description: Create table for storing historical QA reviews from Excel import
-- Date: 2026-01-16

-- Create qa_review_history table
CREATE TABLE IF NOT EXISTS qa_review_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number VARCHAR(50) NOT NULL,
  project VARCHAR(50),
  review_date DATE,
  reviewer VARCHAR(100),

  -- 10-step QA checklist (mapped from Excel's 12 steps)
  step_01_house_photo BOOLEAN,
  step_02_cable_from_pole BOOLEAN,
  step_03_cable_entry_outside BOOLEAN,
  step_04_cable_entry_inside BOOLEAN,
  step_05_wall_installation BOOLEAN,
  step_06_ont_back BOOLEAN,
  step_07_power_meter BOOLEAN,
  step_08_final_installation BOOLEAN,
  step_09_green_lights BOOLEAN,
  step_10_signature BOOLEAN,

  -- Original Excel step values (for reference)
  excel_step_08_ont_barcode BOOLEAN,  -- ONT Barcode scanned
  excel_step_09_ups_serial BOOLEAN,   -- UPS Serial scanned

  -- Summary fields
  completed_photos INTEGER,
  outstanding_photos INTEGER,
  pass_fail VARCHAR(10),
  percent_complete VARCHAR(10),
  comment TEXT,

  -- Metadata
  source VARCHAR(50) DEFAULT 'excel_import',
  source_sheet VARCHAR(100),
  imported_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Unique constraint to prevent duplicates
  UNIQUE(drop_number, review_date, reviewer)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_qa_review_history_drop ON qa_review_history(drop_number);
CREATE INDEX IF NOT EXISTS idx_qa_review_history_project ON qa_review_history(project);
CREATE INDEX IF NOT EXISTS idx_qa_review_history_date ON qa_review_history(review_date);
CREATE INDEX IF NOT EXISTS idx_qa_review_history_reviewer ON qa_review_history(reviewer);

-- Add comment
COMMENT ON TABLE qa_review_history IS 'Historical QA reviews imported from VF_QA__Activations_Tracker.xlsx';
COMMENT ON COLUMN qa_review_history.excel_step_08_ont_barcode IS 'Original Excel Step 8: ONT Barcode scanned (not a photo step)';
COMMENT ON COLUMN qa_review_history.excel_step_09_ups_serial IS 'Original Excel Step 9: UPS Serial scanned (not a photo step)';
