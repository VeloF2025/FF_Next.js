-- Migration 264: Add missing performance indexes
-- Identified by performance audit 2026-03-30
-- These indexes address slow queries on frequently filtered columns

-- sow_poles: filtered by (project_id, sync_status) in pole tracker queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sow_poles_project_sync
  ON sow_poles(project_id, sync_status);

-- audit_logs: filtered by entity_type + entity_id in audit service (6 query branches)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs(entity_type, entity_id, created_at DESC);

-- audit_logs: filtered by performed_by for user activity queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_performer
  ON audit_logs(performed_by, created_at DESC);

-- rfq_notifications: polled repeatedly for pending notifications
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rfq_notifications_pending
  ON rfq_notifications(status, retry_count) WHERE status = 'pending';
