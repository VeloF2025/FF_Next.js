-- Migration 302: Backfill ticket_category + discipline for legacy PP/OLT tickets
--
-- Before PR #1250, PP Data and OLT Mismatch ticket creation was broken and
-- defaulted to type='maintenance' with NULL ticket_category. This migration
-- tags those legacy tickets so they appear in the new NOC category filters
-- and search.
--
-- Rules:
--   • source='pp_data'     + ticket_category IS NULL → category=pre_provision,   type=activations
--   • source='olt_mismatch'+ ticket_category IS NULL → category=serial_mismatch, type=activations
--
-- Rationale for type=activations: PP Data and OLT Mismatch work is always
-- activation-discipline work (ONT provisioning on the Activate module).
-- Pre-fix they defaulted to 'maintenance' because the old taxonomy lacked an
-- activations discipline path.
--
-- Safe to re-run — WHERE clauses exclude already-backfilled rows.

BEGIN;

-- PP Data: pre_provision is the only valid category for this source
UPDATE maintenance_tickets
SET ticket_category = 'pre_provision',
    type = 'activations',
    updated_at = NOW()
WHERE source = 'pp_data'
  AND ticket_category IS NULL;

-- OLT Mismatch: serial_mismatch is the investigation axis
UPDATE maintenance_tickets
SET ticket_category = 'serial_mismatch',
    type = 'activations',
    updated_at = NOW()
WHERE source = 'olt_mismatch'
  AND ticket_category IS NULL;

COMMIT;

-- Verification (informational, no error if different):
--   SELECT source, ticket_category, type, COUNT(*)
--   FROM maintenance_tickets
--   WHERE source IN ('pp_data','olt_mismatch')
--   GROUP BY source, ticket_category, type;
