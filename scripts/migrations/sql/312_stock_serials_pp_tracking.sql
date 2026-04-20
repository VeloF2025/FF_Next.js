-- Migration 312: Add PP (pre-provision) tracking to stock_serials
-- (renamed from 270_ — collision with 270_create_teams_table.sql)
-- Tracks if a serial has ever appeared in the OES PP DATA report

ALTER TABLE stock_serials ADD COLUMN IF NOT EXISTS pp_flagged BOOLEAN DEFAULT FALSE;
ALTER TABLE stock_serials ADD COLUMN IF NOT EXISTS pp_flagged_at TIMESTAMPTZ;
ALTER TABLE stock_serials ADD COLUMN IF NOT EXISTS pp_resolution_status TEXT;
CREATE INDEX IF NOT EXISTS idx_stock_serials_pp ON stock_serials (pp_flagged) WHERE pp_flagged = TRUE;

-- Backfill from existing oes_pp_data
UPDATE stock_serials
SET pp_flagged = TRUE,
    pp_flagged_at = pp.created_at,
    pp_resolution_status = pp.resolution_status
FROM oes_pp_data pp, stock_items si
WHERE stock_serials.stock_item_id = si.id
  AND si.item_code = 'FT-ONT'
  AND UPPER(TRIM(pp.serial_number)) = UPPER(TRIM(stock_serials.serial_number))
  AND stock_serials.pp_flagged = FALSE;
