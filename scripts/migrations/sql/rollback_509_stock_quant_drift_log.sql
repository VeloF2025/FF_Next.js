-- Rollback 509. The table is append-only diagnostics; dropping it loses the
-- drift history but affects no issue, return or accountability path.
DROP INDEX IF EXISTS idx_stock_quant_drift_log_item_location;
DROP TABLE IF EXISTS stock_quant_drift_log;
