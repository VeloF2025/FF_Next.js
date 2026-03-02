-- Tool Check Out / Check In System
-- Migration: 20260302_tool_checkout_system
-- Description: Adds serial number tracking and checkout/checkin workflow for Tools/Assets/PPE

-- Stock item serial numbers (per-unit tracking)
CREATE TABLE IF NOT EXISTS stock_item_serials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id UUID NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  serial_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available', -- available | checked_out | retired
  current_checkout_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(stock_item_id, serial_number)
);

-- Tool checkout records
CREATE TABLE IF NOT EXISTS tool_checkouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id UUID NOT NULL REFERENCES stock_items(id),
  serial_id UUID NOT NULL REFERENCES stock_item_serials(id),
  serial_number TEXT NOT NULL,
  checked_out_by UUID NOT NULL REFERENCES users(id),
  project_id UUID REFERENCES projects(id),
  job_site_name TEXT, -- fallback if no project selected
  expected_return_date DATE NOT NULL,
  checked_out_at TIMESTAMPTZ DEFAULT NOW(),
  checked_in_at TIMESTAMPTZ,
  checked_in_by UUID REFERENCES users(id),
  condition_notes TEXT,
  status TEXT NOT NULL DEFAULT 'checked_out', -- checked_out | returned
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add FK from serials -> checkout
ALTER TABLE stock_item_serials
  ADD CONSTRAINT fk_serial_checkout
  FOREIGN KEY (current_checkout_id) REFERENCES tool_checkouts(id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_serials_stock_item ON stock_item_serials(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_serials_status ON stock_item_serials(status);
CREATE INDEX IF NOT EXISTS idx_checkouts_serial ON tool_checkouts(serial_id);
CREATE INDEX IF NOT EXISTS idx_checkouts_checked_out_by ON tool_checkouts(checked_out_by);
CREATE INDEX IF NOT EXISTS idx_checkouts_status ON tool_checkouts(status);
CREATE INDEX IF NOT EXISTS idx_checkouts_return_date ON tool_checkouts(expected_return_date) WHERE status = 'checked_out';
CREATE INDEX IF NOT EXISTS idx_checkouts_overdue ON tool_checkouts(expected_return_date)
  WHERE status = 'checked_out' AND expected_return_date < CURRENT_DATE;
