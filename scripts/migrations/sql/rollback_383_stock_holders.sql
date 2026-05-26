-- rollback_383_stock_holders.sql
BEGIN;
DROP TABLE IF EXISTS stock_holders;   -- cascades its indexes
DELETE FROM migrations WHERE version = '383';
COMMIT;
