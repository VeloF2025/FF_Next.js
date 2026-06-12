-- Rollback for migration 414: per-DR three-way reconciliation ledger view.
-- The view is an ADDITIVE read-only companion (nothing read it before this PR),
-- so a plain DROP is clean — no consumer is left dangling once the PR is reverted.

BEGIN;

DROP VIEW IF EXISTS v_dr_reconciliation_ledger;

DELETE FROM migrations WHERE version = '414';

COMMIT;
