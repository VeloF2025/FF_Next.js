-- Migration 226: Add serial_mismatch to ticket type check constraint
-- Part of ticket creation standardization audit
-- Includes legacy types (fault, installation) for backward compatibility

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
    'serial_mismatch'
  ));

COMMIT;
