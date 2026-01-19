-- Migration: 088_barcode_extraction_tracking.sql
-- Purpose: Track extraction method (barcode vs VLM) for ONT serials
-- Date: 2026-01-19

-- Add columns to track extraction method
ALTER TABLE foto_ai_reviews
ADD COLUMN IF NOT EXISTS serial_extraction_method_step6 VARCHAR(20) DEFAULT 'vlm',
ADD COLUMN IF NOT EXISTS serial_extraction_method_step9 VARCHAR(20) DEFAULT 'vlm';

-- Add comments
COMMENT ON COLUMN foto_ai_reviews.serial_extraction_method_step6 IS 'How Step 6 ONT serial was extracted: barcode (high reliability) or vlm (OCR)';
COMMENT ON COLUMN foto_ai_reviews.serial_extraction_method_step9 IS 'How Step 9 ONT serial was extracted: barcode (high reliability) or vlm (OCR)';

-- Create index for querying by extraction method (for analytics)
CREATE INDEX IF NOT EXISTS idx_foto_ai_reviews_extraction_method
ON foto_ai_reviews(serial_extraction_method_step6, serial_extraction_method_step9);
