-- 509: append-only record of stock_quants disagreeing with the serial ledger.
--
-- Serial-tracked issues now trust the scanned serials, because stock_quants is
-- a 26-May-2026 Odoo opening-balance snapshot with no consumption postings —
-- it refused genuine handouts through 2026-07 and the flow lost its users.
--
-- Every disagreement is written here rather than raised, so the drift stays
-- measurable and can be watched shrinking once PWA receiving (Phase 2) starts
-- recording physical moves. Nothing reads this table at issue time.

CREATE TABLE IF NOT EXISTS stock_quant_drift_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  picking_line_id UUID        NOT NULL,
  stock_item_id   UUID        NOT NULL,
  location_id     UUID        NOT NULL,
  serials_counted INTEGER     NOT NULL,
  quants_on_hand  NUMERIC     NOT NULL,
  observed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_quant_drift_log_item_location
  ON stock_quant_drift_log (stock_item_id, location_id, observed_at DESC);
