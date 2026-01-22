-- Migration: 111_vf_sequence_system.sql
-- Purpose: Create VF ticket numbering system with atomic sequence generation
-- Format: VF-YYYYMMDD-NNN (e.g., VF-20260122-001)

-- ============================================================================
-- 1. Daily sequence tracking table
-- ============================================================================
CREATE TABLE IF NOT EXISTS maintenance_ticket_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_date DATE NOT NULL UNIQUE,
  last_sequence INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_maintenance_ticket_sequences_date
  ON maintenance_ticket_sequences(sequence_date);

COMMENT ON TABLE maintenance_ticket_sequences IS 'Daily sequence tracking for VF ticket UIDs';

-- ============================================================================
-- 2. Atomic VF UID generator function (collision-free)
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_vf_ticket_uid()
RETURNS TEXT AS $$
DECLARE
  today DATE := CURRENT_DATE;
  date_str TEXT;
  seq_num INTEGER;
  result TEXT;
BEGIN
  -- Format date as YYYYMMDD
  date_str := TO_CHAR(today, 'YYYYMMDD');

  -- Atomically get and increment sequence for today
  INSERT INTO maintenance_ticket_sequences (sequence_date, last_sequence)
  VALUES (today, 1)
  ON CONFLICT (sequence_date)
  DO UPDATE SET
    last_sequence = maintenance_ticket_sequences.last_sequence + 1,
    updated_at = NOW()
  RETURNING last_sequence INTO seq_num;

  -- Format as VF-YYYYMMDD-NNN
  result := 'VF-' || date_str || '-' || LPAD(seq_num::TEXT, 3, '0');

  RETURN result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_vf_ticket_uid() IS 'Atomically generates collision-free VF-YYYYMMDD-NNN ticket UIDs';

-- ============================================================================
-- 3. VF UID generator for specific date (used during migration)
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_vf_ticket_uid_for_date(target_date DATE)
RETURNS TEXT AS $$
DECLARE
  date_str TEXT;
  seq_num INTEGER;
  result TEXT;
BEGIN
  -- Format date as YYYYMMDD
  date_str := TO_CHAR(target_date, 'YYYYMMDD');

  -- Atomically get and increment sequence for the target date
  INSERT INTO maintenance_ticket_sequences (sequence_date, last_sequence)
  VALUES (target_date, 1)
  ON CONFLICT (sequence_date)
  DO UPDATE SET
    last_sequence = maintenance_ticket_sequences.last_sequence + 1,
    updated_at = NOW()
  RETURNING last_sequence INTO seq_num;

  -- Format as VF-YYYYMMDD-NNN
  result := 'VF-' || date_str || '-' || LPAD(seq_num::TEXT, 3, '0');

  RETURN result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_vf_ticket_uid_for_date(DATE) IS 'Generates VF UID for a specific date (for migration/backdating)';

-- ============================================================================
-- 4. Migration audit table (for rollback capability)
-- ============================================================================
CREATE TABLE IF NOT EXISTS maintenance_ticket_uid_migrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES maintenance_tickets(id) ON DELETE CASCADE,
  old_ticket_uid VARCHAR(50) NOT NULL,
  new_ticket_uid VARCHAR(50) NOT NULL,
  migrated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  migrated_by UUID
);

CREATE INDEX IF NOT EXISTS idx_uid_migrations_old
  ON maintenance_ticket_uid_migrations(old_ticket_uid);
CREATE INDEX IF NOT EXISTS idx_uid_migrations_new
  ON maintenance_ticket_uid_migrations(new_ticket_uid);
CREATE INDEX IF NOT EXISTS idx_uid_migrations_ticket
  ON maintenance_ticket_uid_migrations(ticket_id);

COMMENT ON TABLE maintenance_ticket_uid_migrations IS 'Audit trail for FF to VF ticket UID migrations';

-- ============================================================================
-- 5. Add new columns to maintenance_tickets
-- ============================================================================
ALTER TABLE maintenance_tickets
  ADD COLUMN IF NOT EXISTS excel_row_reference VARCHAR(100);

ALTER TABLE maintenance_tickets
  ADD COLUMN IF NOT EXISTS original_logged_date DATE;

COMMENT ON COLUMN maintenance_tickets.excel_row_reference IS 'Reference to source row in master Excel sheet';
COMMENT ON COLUMN maintenance_tickets.original_logged_date IS 'Original date when ticket was logged (for VF numbering consistency)';

-- ============================================================================
-- 6. Create index for VF ticket UID pattern
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_vf_uid
  ON maintenance_tickets(ticket_uid)
  WHERE ticket_uid LIKE 'VF-%';

-- ============================================================================
-- Verification
-- ============================================================================
DO $$
BEGIN
  -- Test the function
  RAISE NOTICE 'Testing generate_vf_ticket_uid()...';
  RAISE NOTICE 'Generated UID: %', generate_vf_ticket_uid();
  RAISE NOTICE 'Migration 111_vf_sequence_system completed successfully';
END $$;
