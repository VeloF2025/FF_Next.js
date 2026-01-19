-- ============================================================
-- Migration 090: Rename Remaining Ticket Tables to Maintenance
-- ============================================================
-- This migration completes the ticketing -> maintenance rename
-- by renaming the auxiliary tables that weren't in migration 089.
--
-- Tables being renamed:
--   1. ticket_statuses -> maintenance_statuses
--   2. ticket_activities -> maintenance_activities
--   3. ticket_history -> maintenance_history
--   4. ticket_tags -> maintenance_tags
--   5. ticket_assignment_history -> maintenance_assignment_history
--   6. ticket_billing -> maintenance_billing
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Rename ticket_statuses to maintenance_statuses
-- ============================================================
ALTER TABLE IF EXISTS ticket_statuses RENAME TO maintenance_statuses;

-- Rename indexes on maintenance_statuses
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ticket_statuses_pkey') THEN
    ALTER INDEX ticket_statuses_pkey RENAME TO maintenance_statuses_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ticket_statuses_code_key') THEN
    ALTER INDEX ticket_statuses_code_key RENAME TO maintenance_statuses_code_key;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ticket_statuses_code') THEN
    ALTER INDEX idx_ticket_statuses_code RENAME TO idx_maintenance_statuses_code;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ticket_statuses_parent') THEN
    ALTER INDEX idx_ticket_statuses_parent RENAME TO idx_maintenance_statuses_parent;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ticket_statuses_active') THEN
    ALTER INDEX idx_ticket_statuses_active RENAME TO idx_maintenance_statuses_active;
  END IF;
END $$;

-- ============================================================
-- 2. Rename ticket_activities to maintenance_activities
-- ============================================================
ALTER TABLE IF EXISTS ticket_activities RENAME TO maintenance_activities;

-- Rename indexes on maintenance_activities
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ticket_activities_pkey') THEN
    ALTER INDEX ticket_activities_pkey RENAME TO maintenance_activities_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ticket_activities_ticket') THEN
    ALTER INDEX idx_ticket_activities_ticket RENAME TO idx_maintenance_activities_ticket;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ticket_activities_type') THEN
    ALTER INDEX idx_ticket_activities_type RENAME TO idx_maintenance_activities_type;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ticket_activities_created') THEN
    ALTER INDEX idx_ticket_activities_created RENAME TO idx_maintenance_activities_created;
  END IF;
END $$;

-- Rename foreign key constraint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_activities_ticket_id_fkey') THEN
    ALTER TABLE maintenance_activities RENAME CONSTRAINT ticket_activities_ticket_id_fkey TO maintenance_activities_ticket_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ticket_activities_ticket') THEN
    ALTER TABLE maintenance_activities RENAME CONSTRAINT fk_ticket_activities_ticket TO fk_maintenance_activities_ticket;
  END IF;
END $$;

-- ============================================================
-- 3. Rename ticket_history to maintenance_history
-- ============================================================
ALTER TABLE IF EXISTS ticket_history RENAME TO maintenance_history;

-- Rename indexes on maintenance_history
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ticket_history_pkey') THEN
    ALTER INDEX ticket_history_pkey RENAME TO maintenance_history_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ticket_history_ticket') THEN
    ALTER INDEX idx_ticket_history_ticket RENAME TO idx_maintenance_history_ticket;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ticket_history_action') THEN
    ALTER INDEX idx_ticket_history_action RENAME TO idx_maintenance_history_action;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ticket_history_changed_at') THEN
    ALTER INDEX idx_ticket_history_changed_at RENAME TO idx_maintenance_history_changed_at;
  END IF;
END $$;

-- Rename foreign key constraint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_history_ticket_id_fkey') THEN
    ALTER TABLE maintenance_history RENAME CONSTRAINT ticket_history_ticket_id_fkey TO maintenance_history_ticket_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ticket_history_ticket') THEN
    ALTER TABLE maintenance_history RENAME CONSTRAINT fk_ticket_history_ticket TO fk_maintenance_history_ticket;
  END IF;
END $$;

-- ============================================================
-- 4. Rename ticket_tags to maintenance_tags
-- ============================================================
ALTER TABLE IF EXISTS ticket_tags RENAME TO maintenance_tags;

-- Rename indexes on maintenance_tags
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ticket_tags_pkey') THEN
    ALTER INDEX ticket_tags_pkey RENAME TO maintenance_tags_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ticket_tags_name_key') THEN
    ALTER INDEX ticket_tags_name_key RENAME TO maintenance_tags_name_key;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ticket_tags_name') THEN
    ALTER INDEX idx_ticket_tags_name RENAME TO idx_maintenance_tags_name;
  END IF;
END $$;

-- ============================================================
-- 5. Rename ticket_assignment_history to maintenance_assignment_history
-- ============================================================
ALTER TABLE IF EXISTS ticket_assignment_history RENAME TO maintenance_assignment_history;

-- Rename indexes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ticket_assignment_history_pkey') THEN
    ALTER INDEX ticket_assignment_history_pkey RENAME TO maintenance_assignment_history_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ticket_assignment_history_ticket') THEN
    ALTER INDEX idx_ticket_assignment_history_ticket RENAME TO idx_maintenance_assignment_history_ticket;
  END IF;
END $$;

-- Rename foreign key constraint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_assignment_history_ticket_id_fkey') THEN
    ALTER TABLE maintenance_assignment_history RENAME CONSTRAINT ticket_assignment_history_ticket_id_fkey TO maintenance_assignment_history_ticket_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ticket_assignment_history_ticket') THEN
    ALTER TABLE maintenance_assignment_history RENAME CONSTRAINT fk_ticket_assignment_history_ticket TO fk_maintenance_assignment_history_ticket;
  END IF;
END $$;

-- ============================================================
-- 6. Rename ticket_billing to maintenance_billing
-- ============================================================
ALTER TABLE IF EXISTS ticket_billing RENAME TO maintenance_billing;

-- Rename indexes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ticket_billing_pkey') THEN
    ALTER INDEX ticket_billing_pkey RENAME TO maintenance_billing_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ticket_billing_ticket') THEN
    ALTER INDEX idx_ticket_billing_ticket RENAME TO idx_maintenance_billing_ticket;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ticket_billing_status') THEN
    ALTER INDEX idx_ticket_billing_status RENAME TO idx_maintenance_billing_status;
  END IF;
END $$;

-- Rename foreign key constraint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_billing_ticket_id_fkey') THEN
    ALTER TABLE maintenance_billing RENAME CONSTRAINT ticket_billing_ticket_id_fkey TO maintenance_billing_ticket_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ticket_billing_ticket') THEN
    ALTER TABLE maintenance_billing RENAME CONSTRAINT fk_ticket_billing_ticket TO fk_maintenance_billing_ticket;
  END IF;
END $$;

-- ============================================================
-- Update table comments
-- ============================================================
COMMENT ON TABLE maintenance_statuses IS 'Status definitions for maintenance tickets';
COMMENT ON TABLE maintenance_activities IS 'Activity log for maintenance tickets';
COMMENT ON TABLE maintenance_history IS 'Change history/audit trail for maintenance tickets';
COMMENT ON TABLE maintenance_tags IS 'Tags for categorizing maintenance tickets';
COMMENT ON TABLE maintenance_assignment_history IS 'Assignment history for maintenance tickets';
COMMENT ON TABLE maintenance_billing IS 'Billing information for maintenance tickets';

COMMIT;
