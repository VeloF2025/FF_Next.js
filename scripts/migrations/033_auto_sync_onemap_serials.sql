-- Migration 033: Auto-sync OneMap serials when DR is submitted to WA Monitor
-- Description: Creates a trigger function that automatically syncs ONT and UPS serials
--              from OneMap (via dr-photo-api) when a new drop is inserted into qa_photo_reviews
-- Date: 2026-01-13

-- ============================================================================
-- TRIGGER FUNCTION: Auto-sync OneMap serials on new qa_photo_reviews insert
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_sync_onemap_serials()
RETURNS TRIGGER AS $$
DECLARE
  v_api_url TEXT := 'http://100.96.203.105:8003'; -- dr-photo-api URL
  v_response TEXT;
  v_ont_barcode TEXT;
  v_ups_serial TEXT;
BEGIN
  -- Only proceed if drop_number exists
  IF NEW.drop_number IS NULL OR NEW.drop_number = '' THEN
    RETURN NEW;
  END IF;

  -- Attempt to fetch serial data from dr-photo-api using pg_cron or http extension
  -- NOTE: This requires the http extension to be installed
  -- If http extension is not available, this will be handled by application layer instead

  -- For now, we'll use a simpler approach: insert a pending sync record
  -- that the application can process
  INSERT INTO onemap_sync_queue (
    drop_number,
    status,
    created_at
  ) VALUES (
    NEW.drop_number,
    'pending',
    NOW()
  )
  ON CONFLICT (drop_number) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SYNC QUEUE TABLE: Track pending OneMap syncs
-- ============================================================================

CREATE TABLE IF NOT EXISTS onemap_sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_onemap_sync_queue_status ON onemap_sync_queue(status);
CREATE INDEX idx_onemap_sync_queue_created_at ON onemap_sync_queue(created_at);

-- ============================================================================
-- TRIGGER: Auto-sync on qa_photo_reviews insert
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_auto_sync_onemap_serials ON qa_photo_reviews;

CREATE TRIGGER trigger_auto_sync_onemap_serials
  AFTER INSERT ON qa_photo_reviews
  FOR EACH ROW
  EXECUTE FUNCTION auto_sync_onemap_serials();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE onemap_sync_queue IS
  'Queue for pending OneMap serial synchronization requests.
   Populated automatically when new drops are inserted into qa_photo_reviews.';

COMMENT ON FUNCTION auto_sync_onemap_serials() IS
  'Trigger function that adds drop to sync queue when new qa_photo_review is inserted.';

COMMENT ON TRIGGER trigger_auto_sync_onemap_serials ON qa_photo_reviews IS
  'Automatically queue OneMap serial sync when new drop is submitted to WA Monitor.';
