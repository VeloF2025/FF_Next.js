-- Rollback for migration 409: field-stock accountability aging + project breakdown.
-- Both views are ADDITIVE companions (nothing reads them before this PR), so a
-- plain DROP is clean — no consumer is left dangling once the PR is also reverted.

BEGIN;

DROP VIEW IF EXISTS v_holder_project_breakdown;
DROP VIEW IF EXISTS v_holder_held_aging;

DELETE FROM migrations WHERE version = '409';

COMMIT;
