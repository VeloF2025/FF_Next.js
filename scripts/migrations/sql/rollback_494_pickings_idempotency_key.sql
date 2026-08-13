-- rollback_494_pickings_idempotency_key.sql
DROP INDEX IF EXISTS uniq_stock_pickings_idempotency;
ALTER TABLE stock_pickings DROP COLUMN IF EXISTS idempotency_key;
