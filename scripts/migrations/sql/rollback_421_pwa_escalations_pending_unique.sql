-- Rollback 421: drop the pending-escalation partial unique index.
DROP INDEX IF EXISTS pwa_escalations_site_step_pending_uq;
