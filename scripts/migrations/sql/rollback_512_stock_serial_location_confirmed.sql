-- Rollback 512. Drops the confirmed/assumed distinction; current_location_id
-- reverts to carrying an unqualified claim.
DROP INDEX IF EXISTS idx_stock_serials_unconfirmed_location;
ALTER TABLE stock_serials DROP COLUMN IF EXISTS location_confirmed;
