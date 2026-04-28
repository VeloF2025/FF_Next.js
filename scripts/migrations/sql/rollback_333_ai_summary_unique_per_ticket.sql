-- Rollback for migration 333 — drop the unique partial index.

DROP INDEX IF EXISTS uq_maintenance_activities_ai_summary_per_ticket;
