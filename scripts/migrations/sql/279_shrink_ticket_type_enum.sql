-- Migration 279: Shrink maintenance_tickets.type to the 5-discipline vocabulary
--
-- PR 4/4 in the April-11 two-axis taxonomy refactor.
--
-- Depends on migrations 277 + 278 which:
--   • Added ticket_category (the T1 axis) to maintenance_tickets
--   • Expanded the type CHECK to include the 5 discipline values
--
-- What this migration does:
--
--   1. One-shot UPDATE — rewrites every legacy type value to its equivalent
--      discipline. Rules agreed in the April-11 planning session:
--
--      Legacy value           → Discipline
--      ─────────────────────────────────────
--      fault_repair / fault   → maintenance
--      modification           → maintenance
--      incident               → maintenance
--      hse_incident           → maintenance   (T1 still on ticket_category)
--      hse_near_miss          → maintenance   (T1 still on ticket_category)
--      serial_mismatch        → maintenance
--      pre_provision          → maintenance
--      olt_investigation      → maintenance
--      sales_lead             → maintenance   (T1 still on ticket_category)
--      new_installation       → activations
--      installation           → activations
--      ont_swap               → activations
--      snag                   → civils        (default — per-ticket classifier
--      internal_snag          → civils         not applied retroactively)
--      other                  → unspecified
--
--      Values that are already disciplines stay as-is:
--        civils / optical / activations / maintenance / dev_ops / unspecified
--
--   2. Shrinks the CHECK constraint to only the 5 disciplines + unspecified.
--
--   3. Drops the legacy sub_type column (migration 274's T2 axis, superseded
--      by ticket_category from migration 277).
--
-- Safe to re-run — the UPDATE WHERE clause is idempotent after the first run
-- because the shrunk constraint prevents any legacy values from being
-- re-inserted.

-- ---------------------------------------------------------------------------
-- 1. Rewrite legacy type values to disciplines
-- ---------------------------------------------------------------------------

UPDATE maintenance_tickets
SET type = 'maintenance'
WHERE type IN (
  'fault_repair', 'fault',
  'modification',
  'incident',
  'hse_incident', 'hse_near_miss',
  'serial_mismatch',
  'pre_provision',
  'olt_investigation',
  'sales_lead'
);

UPDATE maintenance_tickets
SET type = 'activations'
WHERE type IN ('new_installation', 'installation', 'ont_swap');

UPDATE maintenance_tickets
SET type = 'civils'
WHERE type IN ('snag', 'internal_snag');

UPDATE maintenance_tickets
SET type = 'unspecified'
WHERE type = 'other';

-- ---------------------------------------------------------------------------
-- 2. Shrink the CHECK constraint — only the 5 disciplines + unspecified
-- ---------------------------------------------------------------------------

ALTER TABLE maintenance_tickets
  DROP CONSTRAINT IF EXISTS maintenance_tickets_type_check;

ALTER TABLE maintenance_tickets
  ADD CONSTRAINT maintenance_tickets_type_check
  CHECK (type IN (
    'civils',
    'optical',
    'activations',
    'maintenance',
    'dev_ops',
    'unspecified'
  ));

-- ---------------------------------------------------------------------------
-- 3. Drop the legacy sub_type column (superseded by ticket_category)
-- ---------------------------------------------------------------------------

ALTER TABLE maintenance_tickets
  DROP COLUMN IF EXISTS sub_type;
