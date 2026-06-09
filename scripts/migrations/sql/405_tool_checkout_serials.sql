-- Migration 405: tool checkout serial tracking — create stock_item_serials + align tool_checkouts
-- Purpose: the deployed tool book-out APIs (/api/stock/serials, /api/stock/checkout,
--          /api/stock/checkin, /api/stock/serial-history) read/write stock_item_serials
--          and tool_checkouts.serial_id / project_id. The stock_item_serials table from
--          neon/migrations/20260302_tool_checkout_system.sql was never applied to the
--          shared Supabase DB — tool_checkouts there came from the older
--          231_tool_checkouts.sql shape — so every serials/checkout/checkin call 500s
--          ("relation stock_item_serials does not exist"). This migration creates the
--          missing table and adds the columns the deployed APIs expect.
-- Fully idempotent — safe to re-run.

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

-- Live tool_checkouts predates the serial-tracking design: add the columns the
-- deployed checkout/checkin APIs insert/update. serial_id stays nullable because
-- the older /api/stock-items/checkout path inserts rows without one.
ALTER TABLE tool_checkouts
  ADD COLUMN IF NOT EXISTS serial_id UUID REFERENCES stock_item_serials(id),
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- tool_checkouts is empty on the shared DB today (0 rows). If rows exist at
-- apply time, ADD COLUMN ... DEFAULT NOW() fills them with the apply-time
-- timestamp; align created_at with the row's real checkout time instead.
UPDATE tool_checkouts SET created_at = checked_out_at
WHERE checked_out_at IS NOT NULL AND created_at > checked_out_at;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_serial_checkout') THEN
    ALTER TABLE stock_item_serials
      ADD CONSTRAINT fk_serial_checkout
      FOREIGN KEY (current_checkout_id) REFERENCES tool_checkouts(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_serials_stock_item ON stock_item_serials(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_serials_status ON stock_item_serials(status);
CREATE INDEX IF NOT EXISTS idx_checkouts_serial ON tool_checkouts(serial_id);
