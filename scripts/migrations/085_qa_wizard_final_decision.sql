-- Migration: 085_qa_wizard_final_decision.sql
-- Purpose: Add QA Wizard fields to foto_ai_reviews for 5-phase workflow
-- Date: 2026-01-18

-- Add final decision tracking
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS qa_decision TEXT CHECK (qa_decision IN ('PASS', 'FAIL', 'REWORK_NEEDED'));
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS qa_decision_reasons JSONB DEFAULT '[]';
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS qa_decision_at TIMESTAMP;
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS qa_decision_by TEXT;
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS qa_decision_notes TEXT;

-- Add VLM extracted data fields
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS vlm_power_meter_dbm DECIMAL(5,2);
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS vlm_power_meter_status TEXT CHECK (vlm_power_meter_status IN ('pass', 'fail_high', 'fail_low', 'manual', 'pending'));
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS vlm_ont_serial_step6 TEXT;
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS vlm_ont_serial_step9 TEXT;
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS vlm_dr_number_step9 TEXT;

-- Add serial validation status (3-way check result)
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS serial_validation_status TEXT CHECK (serial_validation_status IN ('match', 'mismatch', 'partial', 'manual', 'pending'));
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS serial_validation_details JSONB DEFAULT '{}';

-- Add phase tracking for wizard progress
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS qa_phase TEXT DEFAULT 'prerequisites' CHECK (qa_phase IN ('prerequisites', 'photo_review', 'data_validation', 'final_decision', 'feedback', 'completed'));
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS prerequisites_passed BOOLEAN;
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS prerequisites_checked_at TIMESTAMP;
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS photo_review_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS photo_review_completed_at TIMESTAMP;
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS data_validation_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS data_validation_completed_at TIMESTAMP;

-- Add reference to OneMap synced serials (from drops table)
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS onemap_ont_serial TEXT;
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS onemap_ups_serial TEXT;

-- Add step coverage tracking
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS step_coverage JSONB DEFAULT '{}';
ALTER TABLE foto_ai_reviews ADD COLUMN IF NOT EXISTS missing_steps INTEGER[] DEFAULT '{}';

-- Create index for phase filtering
CREATE INDEX IF NOT EXISTS idx_foto_ai_reviews_qa_phase ON foto_ai_reviews(qa_phase);
CREATE INDEX IF NOT EXISTS idx_foto_ai_reviews_qa_decision ON foto_ai_reviews(qa_decision);

-- Add comments for documentation
COMMENT ON COLUMN foto_ai_reviews.qa_decision IS 'Final QA decision: PASS, FAIL, or REWORK_NEEDED';
COMMENT ON COLUMN foto_ai_reviews.qa_decision_reasons IS 'Array of fail reason codes: MISSING_PHOTOS, MISSING_SERIAL, SERIAL_MISMATCH, DR_NUMBER_MISMATCH, POWER_OUT_OF_RANGE, DISCARDED_CRITICAL';
COMMENT ON COLUMN foto_ai_reviews.vlm_power_meter_dbm IS 'VLM-extracted power meter reading in dBm. Valid range: -18 to -24 dBm';
COMMENT ON COLUMN foto_ai_reviews.serial_validation_status IS '3-way ONT serial check result: Step 6 + Step 9 + OneMap';
COMMENT ON COLUMN foto_ai_reviews.qa_phase IS 'Current phase in 5-phase QA wizard workflow';
