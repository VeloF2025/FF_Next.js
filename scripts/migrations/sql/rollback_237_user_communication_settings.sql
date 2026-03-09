-- Rollback Migration 237: Drop user_communication_settings table
-- Run BEFORE rollback_236 if rolling back both
-- Safe to run multiple times (IF EXISTS guards)

-- Verify table exists before dropping (safety check)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_communication_settings') THEN
    RAISE NOTICE 'Dropping user_communication_settings table...';
  ELSE
    RAISE NOTICE 'user_communication_settings table does not exist — rollback may have already run';
  END IF;
END $$;

DROP TABLE IF EXISTS user_communication_settings;

-- Verify rollback succeeded
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_communication_settings') THEN
    RAISE NOTICE 'Rollback 237 complete: user_communication_settings dropped successfully';
  ELSE
    RAISE EXCEPTION 'Rollback 237 FAILED: user_communication_settings still exists';
  END IF;
END $$;
