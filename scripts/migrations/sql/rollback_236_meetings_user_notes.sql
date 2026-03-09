-- Rollback Migration 236: Remove user_notes column from meetings
-- Run AFTER rollback_237 if rolling back both
-- Safe to run multiple times (IF EXISTS guards)

-- Verify column exists before dropping (safety check)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'meetings' AND column_name = 'user_notes'
  ) THEN
    RAISE NOTICE 'Dropping user_notes column from meetings...';
  ELSE
    RAISE NOTICE 'meetings.user_notes column does not exist — rollback may have already run';
  END IF;
END $$;

ALTER TABLE meetings DROP COLUMN IF EXISTS user_notes;

-- Verify rollback succeeded
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'meetings' AND column_name = 'user_notes'
  ) THEN
    RAISE NOTICE 'Rollback 236 complete: meetings.user_notes dropped successfully';
  ELSE
    RAISE EXCEPTION 'Rollback 236 FAILED: meetings.user_notes still exists';
  END IF;
END $$;
