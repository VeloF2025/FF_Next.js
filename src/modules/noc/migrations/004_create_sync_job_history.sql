-- Migration 004: Create Sync Job History Table
-- 🟢 WORKING: Production-ready migration for tracking QContact sync job executions
--
-- Purpose: Track automatic periodic sync job executions for monitoring and debugging
--
-- Features:
-- - Job execution tracking (start, end, duration)
-- - Status tracking (success, failed, partial)
-- - Sync statistics (processed, success, failed counts)
-- - Error logging
-- - Idempotent design (safe to run multiple times)

-- Create sync_job_history table
CREATE TABLE IF NOT EXISTS sync_job_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Execution timing
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  duration_seconds DECIMAL(10,2),

  -- Status
  status VARCHAR(20) NOT NULL, -- 'success', 'failed', 'partial', 'running'

  -- Sync statistics
  total_processed INTEGER DEFAULT 0,
  total_success INTEGER DEFAULT 0,
  total_failed INTEGER DEFAULT 0,
  success_rate DECIMAL(5,4), -- 0.0000 to 1.0000

  -- Detailed stats
  inbound_processed INTEGER DEFAULT 0,
  inbound_success INTEGER DEFAULT 0,
  inbound_failed INTEGER DEFAULT 0,
  outbound_processed INTEGER DEFAULT 0,
  outbound_success INTEGER DEFAULT 0,
  outbound_failed INTEGER DEFAULT 0,

  -- Error tracking
  error_message TEXT,
  error_code VARCHAR(50),

  -- Sync options used
  sync_options JSONB, -- Store the sync request options

  -- Full sync result for debugging
  sync_result JSONB, -- Complete FullSyncResult

  created_at TIMESTAMP DEFAULT NOW(),

  CHECK (status IN ('success', 'failed', 'partial', 'running'))
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sync_job_history_started_at
  ON sync_job_history(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_job_history_status
  ON sync_job_history(status);

CREATE INDEX IF NOT EXISTS idx_sync_job_history_created_at
  ON sync_job_history(created_at DESC);

-- Add comments for documentation
COMMENT ON TABLE sync_job_history IS
  'Tracks execution history of automatic QContact sync jobs';

COMMENT ON COLUMN sync_job_history.status IS
  'Job execution status: success (all succeeded), failed (job error), partial (some failures), running (in progress)';

COMMENT ON COLUMN sync_job_history.success_rate IS
  'Success rate calculated as total_success / (total_success + total_failed)';

COMMENT ON COLUMN sync_job_history.sync_options IS
  'JSON object containing the sync request options used (start_date, end_date, etc.)';

COMMENT ON COLUMN sync_job_history.sync_result IS
  'Complete FullSyncResult object for debugging and analysis';
