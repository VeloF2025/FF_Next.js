-- Rollback 453: H&S PPE catalogue + issuance register
--
-- Drops issuance (child) before catalogue (parent). No other consumer.

BEGIN;

DROP TABLE IF EXISTS hs_ppe_issuance;
DROP TABLE IF EXISTS hs_ppe_catalogue;

DELETE FROM schema_migrations WHERE filename = '453_hs_ppe_register.sql';

COMMIT;
