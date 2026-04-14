-- Migration 301: Expand ticket_category CHECK to cover PP Data + OLT mismatch tags
--
-- Context: After the April-11 two-axis taxonomy refactor (migrations 277-279),
-- maintenance_tickets.type only accepts discipline values (civils / optical /
-- activations / maintenance / dev_ops / unspecified). The PP Data and OLT
-- mismatch ticket creation flows used to send old values like 'pre_provision'
-- and 'serial_mismatch' as the type, which the post-refactor API rejects.
--
-- To keep those tags visible in NOC (badge + filter + search) without
-- re-introducing the dropped sub_type column, we repurpose ticket_category as
-- the T2 tag for PP/OLT sub-kinds. The existing T1 values (maintenance, snag,
-- hse_incident, dev_ops, sales_lead, unspecified) stay valid.
--
-- Safe to re-run — DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT.

ALTER TABLE maintenance_tickets
  DROP CONSTRAINT IF EXISTS maintenance_tickets_ticket_category_check;

ALTER TABLE maintenance_tickets
  ADD CONSTRAINT maintenance_tickets_ticket_category_check
  CHECK (ticket_category IS NULL OR ticket_category IN (
    -- T1 operational categories (original from migration 277)
    'maintenance',
    'snag',
    'hse_incident',
    'dev_ops',
    'sales_lead',
    'unspecified',
    -- T2 sub-type tags restored for PP Data + OLT mismatch flows
    'pre_provision',
    'fault_repair',
    'modification',
    'ont_swap',
    'new_installation',
    'serial_mismatch',
    'olt_investigation'
  ));
