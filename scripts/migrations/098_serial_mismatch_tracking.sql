-- Migration: 098_serial_mismatch_tracking.sql
-- Purpose: Add resolution tracking for serial mismatches in offline_devices
-- Date: 2026-01-20
--
-- When offline device serial doesn't match OES activation serial,
-- this tracks investigation status and resolution.
--
-- Mismatch scenarios:
-- 1. ONT was replaced but 1Map not updated
-- 2. Wrong ONT installed initially
-- 3. Data entry error in OES or offline report
-- 4. Theft/unauthorized swap (needs investigation)

-- Add resolution tracking columns to offline_devices
ALTER TABLE offline_devices
ADD COLUMN IF NOT EXISTS mismatch_status VARCHAR(50) DEFAULT NULL;
-- Values: 'pending_investigation', 'ticket_created', 'resolved', 'false_positive'

ALTER TABLE offline_devices
ADD COLUMN IF NOT EXISTS mismatch_resolution VARCHAR(100);
-- Values: 'ont_replaced', 'data_corrected', 'theft_confirmed', 'false_alarm', 'other'

ALTER TABLE offline_devices
ADD COLUMN IF NOT EXISTS mismatch_notes TEXT;

ALTER TABLE offline_devices
ADD COLUMN IF NOT EXISTS mismatch_ticket_id UUID;
-- FK to maintenance_tickets.id

ALTER TABLE offline_devices
ADD COLUMN IF NOT EXISTS mismatch_investigated_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE offline_devices
ADD COLUMN IF NOT EXISTS mismatch_investigated_by TEXT;

ALTER TABLE offline_devices
ADD COLUMN IF NOT EXISTS mismatch_resolved_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE offline_devices
ADD COLUMN IF NOT EXISTS mismatch_resolved_by TEXT;

-- Index for mismatch reports
CREATE INDEX IF NOT EXISTS idx_offline_mismatch_status
ON offline_devices(serial_mismatch, mismatch_status)
WHERE serial_mismatch = TRUE;

-- Update existing mismatches to pending_investigation
UPDATE offline_devices
SET mismatch_status = 'pending_investigation'
WHERE serial_mismatch = TRUE
  AND mismatch_status IS NULL;

-- Add foreign key to maintenance_tickets (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_offline_mismatch_ticket'
  ) THEN
    ALTER TABLE offline_devices
    ADD CONSTRAINT fk_offline_mismatch_ticket
    FOREIGN KEY (mismatch_ticket_id)
    REFERENCES maintenance_tickets(id)
    ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FK constraint skipped: %', SQLERRM;
END $$;

-- Add comments
COMMENT ON COLUMN offline_devices.mismatch_status IS 'pending_investigation | ticket_created | resolved | false_positive';
COMMENT ON COLUMN offline_devices.mismatch_resolution IS 'ont_replaced | data_corrected | theft_confirmed | false_alarm | other';
COMMENT ON COLUMN offline_devices.mismatch_ticket_id IS 'FK to maintenance_tickets for tracking';

-- Verification
DO $$
DECLARE
  col_count INTEGER;
  mismatch_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_name = 'offline_devices'
    AND column_name LIKE 'mismatch_%';

  SELECT COUNT(*) INTO mismatch_count
  FROM offline_devices
  WHERE serial_mismatch = TRUE;

  RAISE NOTICE '✅ Migration 098: Added % mismatch tracking columns', col_count;
  RAISE NOTICE '✅ Found % devices with serial mismatches', mismatch_count;
END $$;
