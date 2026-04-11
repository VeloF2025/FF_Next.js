-- Migration 278: Expand maintenance_tickets.type CHECK constraint to include
-- the 5 disciplines alongside the legacy 15-value vocabulary.
--
-- Context: PR 2 of the taxonomy refactor introduces the Category → Discipline
-- manual picker. It writes the picked discipline into `type` (one of civils /
-- optical / activations / maintenance / dev_ops) — but the existing constraint
-- (last touched by migration 274) only allows the old 15 values, so those
-- INSERTs would fail.
--
-- This migration is additive-only: every legacy type value still passes,
-- and the 5 new discipline values are added. PR 4 will later remove the
-- legacy values after the one-shot data migration runs. Safe to re-run.
--
-- Related: migrations 274, 277.

ALTER TABLE maintenance_tickets
  DROP CONSTRAINT IF EXISTS maintenance_tickets_type_check;

ALTER TABLE maintenance_tickets
  ADD CONSTRAINT maintenance_tickets_type_check
  CHECK (type IN (
    -- Legacy values from migration 274 (kept until PR 4)
    'fault', 'fault_repair', 'installation', 'new_installation',
    'modification', 'ont_swap', 'incident', 'other',
    'hse_incident', 'hse_near_miss',
    'serial_mismatch', 'pre_provision', 'olt_investigation',
    'dev_ops', 'snag', 'internal_snag',
    'sales_lead', 'unspecified',
    -- New discipline values (April-11 two-axis taxonomy)
    'civils', 'optical', 'activations', 'maintenance'
  ));
