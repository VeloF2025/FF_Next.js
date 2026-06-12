-- Rollback for migration 410: field-stock issued-but-unaccounted exceptions view.
-- The view is an ADDITIVE read-only companion (nothing reads it before this PR),
-- so a plain DROP is clean — no consumer is left dangling once the PR is reverted.

BEGIN;

DROP VIEW IF EXISTS v_holder_stock_exceptions;

DELETE FROM migrations WHERE version = '410';

COMMIT;
