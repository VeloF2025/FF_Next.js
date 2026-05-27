-- Rollback for migration 352: maintenance_tickets.resolution_path.
-- Data-destructive — only run if you also revert the resolutionPathClassifier
-- and the CreateTicketPayload contract.

BEGIN;

DROP INDEX IF EXISTS idx_maintenance_tickets_resolution_path;
ALTER TABLE maintenance_tickets DROP CONSTRAINT IF EXISTS maintenance_tickets_resolution_path_check;
ALTER TABLE maintenance_tickets DROP COLUMN IF EXISTS resolution_path;

COMMIT;
