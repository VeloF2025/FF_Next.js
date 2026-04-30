-- Rollback for migration 326_payslips.sql
--
-- WARNING: dropping the payslips table loses all imported financial data.
-- Run only on dev / before any real HR uploads in production.

DELETE FROM role_permissions WHERE permission_key IN ('payslips', 'payslips.import');
DELETE FROM access_permissions WHERE key IN ('payslips', 'payslips.import');

DROP INDEX IF EXISTS idx_payslips_period;
DROP INDEX IF EXISTS idx_payslips_retention_scan;
DROP INDEX IF EXISTS idx_payslips_staff_active;
DROP TABLE IF EXISTS payslips;
