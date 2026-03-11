-- Migration 228: Link OLT mismatch records to maintenance tickets
-- Adds maintenance_ticket_id column and 'olt_mismatch' source

ALTER TABLE olt_mismatch_records
  ADD COLUMN IF NOT EXISTS maintenance_ticket_id UUID;

CREATE INDEX IF NOT EXISTS idx_olt_mismatch_maintenance_ticket
  ON olt_mismatch_records(maintenance_ticket_id)
  WHERE maintenance_ticket_id IS NOT NULL;

-- Add 'olt_mismatch' to the maintenance_tickets source CHECK constraint
ALTER TABLE maintenance_tickets DROP CONSTRAINT IF EXISTS tickets_source_check;
ALTER TABLE maintenance_tickets ADD CONSTRAINT tickets_source_check
  CHECK (source = ANY(ARRAY[
    'qcontact','whatsapp','email','construction','internal','whatsapp_outbound',
    'adhoc','weekly_report','ad_hoc','incident','revenue','ont_swap','manual',
    'offline_report','qa_review','hse_report','wa_maintenance','pp_data','olt_mismatch'
  ]));

-- Add 'olt_mismatch' to the ticket type CHECK (serial_mismatch already exists but add olt_investigation)
ALTER TABLE maintenance_tickets DROP CONSTRAINT IF EXISTS maintenance_tickets_type_check;
ALTER TABLE maintenance_tickets ADD CONSTRAINT maintenance_tickets_type_check
  CHECK (type IN ('fault', 'fault_repair', 'installation', 'new_installation', 'modification', 'ont_swap', 'incident', 'other', 'hse_incident', 'hse_near_miss', 'serial_mismatch', 'pre_provision', 'olt_investigation'));
