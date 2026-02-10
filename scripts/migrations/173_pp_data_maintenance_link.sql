-- Migration 173: Link PP Data records to maintenance tickets
-- Adds maintenance_ticket_id column to oes_pp_data for tracking investigation tickets

ALTER TABLE oes_pp_data
  ADD COLUMN IF NOT EXISTS maintenance_ticket_id UUID;

CREATE INDEX IF NOT EXISTS idx_oes_pp_data_maintenance_ticket
  ON oes_pp_data(maintenance_ticket_id)
  WHERE maintenance_ticket_id IS NOT NULL;
