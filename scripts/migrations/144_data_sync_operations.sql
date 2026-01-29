-- =============================================================================
-- Migration 144: Data Sync Operations Log
-- =============================================================================
-- Unified operations log for tracking all sync/import operations that don't
-- already have their own batch tables (QField sync, OLT imports, etc.)
-- Also used by the History tab to show a combined timeline.
-- =============================================================================

-- Operations log for sync types that don't have their own batch table
CREATE TABLE IF NOT EXISTS data_sync_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type VARCHAR(50) NOT NULL,       -- 'qfield_sync', 'olt_import', 'oes_import', 'arch_import', 'qcontact_sync'
  status VARCHAR(20) NOT NULL DEFAULT 'running',  -- 'running', 'success', 'partial', 'failed'
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_seconds DECIMAL(10,2),
  details JSONB DEFAULT '{}',                -- flexible: { projects_synced, records, layers, errors, filename }
  error_message TEXT,
  triggered_by VARCHAR(100),                 -- 'manual', 'cron', 'oes_import_webhook', etc.
  source_batch_id UUID,                      -- optional FK to oes_import_batches, offline_import_batches, etc.
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying by type and time (history tab)
CREATE INDEX IF NOT EXISTS idx_dso_type_started ON data_sync_operations(operation_type, started_at DESC);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_dso_status ON data_sync_operations(status);

-- Index for looking up by source batch
CREATE INDEX IF NOT EXISTS idx_dso_source_batch ON data_sync_operations(source_batch_id) WHERE source_batch_id IS NOT NULL;
