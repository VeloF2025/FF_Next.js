-- Migration 173: Link PP Data records to maintenance tickets
-- Adds maintenance_ticket_id column to oes_pp_data for tracking investigation tickets

ALTER TABLE oes_pp_data
  ADD COLUMN IF NOT EXISTS maintenance_ticket_id UUID;

CREATE INDEX IF NOT EXISTS idx_oes_pp_data_maintenance_ticket
  ON oes_pp_data(maintenance_ticket_id)
  WHERE maintenance_ticket_id IS NOT NULL;

-- Add 'pp_data' to the maintenance_tickets source CHECK constraint
ALTER TABLE maintenance_tickets DROP CONSTRAINT IF EXISTS tickets_source_check;
ALTER TABLE maintenance_tickets ADD CONSTRAINT tickets_source_check
  CHECK (source = ANY(ARRAY[
    'qcontact','whatsapp','email','construction','internal','whatsapp_outbound',
    'adhoc','weekly_report','ad_hoc','incident','revenue','ont_swap','manual',
    'offline_report','qa_review','hse_report','wa_maintenance','pp_data'
  ]));
