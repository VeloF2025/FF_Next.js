-- Migration 146: Stock Fuzzy Matching
-- Adds columns to boq_items for tracking stock match quality
-- and creates index for efficient unmatched item queries

-- Add stock match confidence and method columns
ALTER TABLE boq_items
ADD COLUMN IF NOT EXISTS stock_match_confidence NUMERIC(4,3),
ADD COLUMN IF NOT EXISTS stock_match_method VARCHAR(30);

-- Comment on new columns
COMMENT ON COLUMN boq_items.stock_match_confidence IS 'Confidence score (0-1) of the stock item match';
COMMENT ON COLUMN boq_items.stock_match_method IS 'How the stock item was matched: supplier_code, fuzzy_description, manual, exact_code';

-- Index for finding unmatched items efficiently
CREATE INDEX IF NOT EXISTS idx_boq_items_unmatched_stock
ON boq_items(boq_id) WHERE stock_item_id IS NULL;

-- Index for stock match auditing
CREATE INDEX IF NOT EXISTS idx_boq_items_stock_match
ON boq_items(stock_item_id, stock_match_method) WHERE stock_item_id IS NOT NULL;
