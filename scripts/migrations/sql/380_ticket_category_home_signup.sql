-- Migration 380: Add home_installation_status + home_signup_not_done to ticket_category CHECK
--
-- Context: Migration 301 expanded maintenance_tickets.ticket_category to cover the
-- PP Data + OLT mismatch T2 sub-type tags. Since then the code added two more
-- sub-types to PP_OLT_SUBTYPES (src/modules/noc/constants/ticketCategories.ts) and
-- exposed them in the UI — the OLT Investigate "Home Sign-up Dispatch" option sends
-- ticket_category = 'home_installation_status' — but no migration extended the DB
-- constraint. Result: "new row for relation maintenance_tickets violates check
-- constraint maintenance_tickets_ticket_category_check" when dispatching home sign-up
-- tickets from the Activate OLT Report.
--
-- This re-syncs the constraint with PP_OLT_SUBTYPES. Safe to re-run.

ALTER TABLE maintenance_tickets
  DROP CONSTRAINT IF EXISTS maintenance_tickets_ticket_category_check;

ALTER TABLE maintenance_tickets
  ADD CONSTRAINT maintenance_tickets_ticket_category_check
  CHECK (ticket_category IS NULL OR ticket_category IN (
    -- T1 operational categories (migration 277)
    'maintenance',
    'snag',
    'hse_incident',
    'dev_ops',
    'sales_lead',
    'unspecified',
    -- T2 sub-type tags (migration 301)
    'pre_provision',
    'fault_repair',
    'modification',
    'ont_swap',
    'new_installation',
    'serial_mismatch',
    'olt_investigation',
    -- T2 sub-type tags added by this migration (PP/OLT home sign-up flows)
    'home_installation_status',
    'home_signup_not_done'
  ));
