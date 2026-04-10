-- Migration: Fix legacy QContact ticket types
-- Ticket: VF-20260409-009 — QContact tickets not showing because they have
-- invalid type values 'fault' and 'installation' that don't match TicketType enum
-- The NOC UI filters by enum values, so these tickets are invisible

BEGIN;

-- Fix 'fault' → 'fault_repair' (the correct enum value)
UPDATE maintenance_tickets
SET type = 'fault_repair'
WHERE type = 'fault';

-- Fix 'installation' → 'new_installation' (the correct enum value)
UPDATE maintenance_tickets
SET type = 'new_installation'
WHERE type = 'installation';

COMMIT;
