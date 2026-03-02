-- Migration 231: Tool Check Out / Check In system
-- Tracks which manager has which tool/asset/PPE, where it went, and when it's due back

BEGIN;

-- Add serial_number to stock_items for unit-level tracking
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS serial_number TEXT;

-- Tool checkouts table
CREATE TABLE IF NOT EXISTS tool_checkouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id UUID NOT NULL,
  serial_number TEXT NOT NULL,
  checked_out_by UUID NOT NULL,
  job_site_id UUID,
  job_site_name TEXT,
  expected_return_date DATE NOT NULL,
  checked_out_at TIMESTAMPTZ DEFAULT NOW(),
  checked_in_at TIMESTAMPTZ,
  checked_in_by UUID,
  condition_notes TEXT,
  status TEXT NOT NULL DEFAULT 'checked_out'
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tool_checkouts_stock_item ON tool_checkouts(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_tool_checkouts_status ON tool_checkouts(status);
CREATE INDEX IF NOT EXISTS idx_tool_checkouts_checked_out_by ON tool_checkouts(checked_out_by);
CREATE INDEX IF NOT EXISTS idx_tool_checkouts_expected_return ON tool_checkouts(expected_return_date);
CREATE INDEX IF NOT EXISTS idx_tool_checkouts_active ON tool_checkouts(stock_item_id, status) WHERE status = 'checked_out';

COMMIT;
