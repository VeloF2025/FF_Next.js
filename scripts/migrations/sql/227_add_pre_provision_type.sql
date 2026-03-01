-- Migration 227: Add pre_provision to ticket type check constraint
-- PP Data tickets default to this type instead of fault_repair

BEGIN;

ALTER TABLE maintenance_tickets DROP CONSTRAINT IF EXISTS maintenance_tickets_type_check;
ALTER TABLE maintenance_tickets ADD CONSTRAINT maintenance_tickets_type_check
  CHECK (type IN (
    'fault',
    'fault_repair',
    'new_installation',
    'installation',
    'modification',
    'ont_swap',
    'incident',
    'hse_incident',
    'hse_near_miss',
    'serial_mismatch',
    'pre_provision'
  ));

COMMIT;
