-- Migration 274: Add sub_type column and expand type constraint
-- Context: Align NOC ticket system with T1/T2 category spec
-- Safety: Additive only — no tickets deleted, no types removed

-- 1. Expand type constraint to include missing types
ALTER TABLE maintenance_tickets DROP CONSTRAINT IF EXISTS maintenance_tickets_type_check;
ALTER TABLE maintenance_tickets ADD CONSTRAINT maintenance_tickets_type_check
  CHECK (type IN (
    'fault', 'fault_repair', 'installation', 'new_installation',
    'modification', 'ont_swap', 'incident', 'other',
    'hse_incident', 'hse_near_miss',
    'serial_mismatch', 'pre_provision', 'olt_investigation',
    'dev_ops', 'snag', 'internal_snag',
    'sales_lead', 'unspecified'
  ));

-- 2. Add sub_type column (T2 category)
ALTER TABLE maintenance_tickets
  ADD COLUMN IF NOT EXISTS sub_type VARCHAR(50);

-- 3. Add CHECK constraint on sub_type
ALTER TABLE maintenance_tickets DROP CONSTRAINT IF EXISTS maintenance_tickets_sub_type_check;
ALTER TABLE maintenance_tickets ADD CONSTRAINT maintenance_tickets_sub_type_check
  CHECK (sub_type IS NULL OR sub_type IN (
    'tera', 'internal',
    'offline', 'mismatch', 'no_entry', 'level',
    'incident', 'hse',
    'devops',
    'lead',
    'modification',
    'new', 'fault', 'mnt',
    'unspecified'
  ));

-- 4. Add index for dashboard filtering
CREATE INDEX IF NOT EXISTS idx_tickets_type_subtype
  ON maintenance_tickets (type, sub_type);

-- 5. Backfill sub_type for existing tickets (idempotent — only updates NULL sub_type)

-- Snags
UPDATE maintenance_tickets SET sub_type = 'tera'
  WHERE type = 'snag' AND sub_type IS NULL;

UPDATE maintenance_tickets SET sub_type = 'internal'
  WHERE type = 'internal_snag' AND sub_type IS NULL;

-- Non-Invoiceable
UPDATE maintenance_tickets SET sub_type = 'mismatch'
  WHERE type = 'olt_investigation' AND sub_type IS NULL;

UPDATE maintenance_tickets SET sub_type = 'mismatch'
  WHERE type = 'serial_mismatch' AND sub_type IS NULL;

-- Pre-provision subtypes (best-effort title matching)
UPDATE maintenance_tickets SET sub_type = 'offline'
  WHERE type = 'pre_provision' AND sub_type IS NULL
  AND (title ILIKE '%offline%' OR title ILIKE '%not online%');

UPDATE maintenance_tickets SET sub_type = 'no_entry'
  WHERE type = 'pre_provision' AND sub_type IS NULL
  AND (title ILIKE '%no entry%' OR title ILIKE '%not found in OES%' OR title ILIKE '%no OES%');

UPDATE maintenance_tickets SET sub_type = 'level'
  WHERE type = 'pre_provision' AND sub_type IS NULL
  AND (title ILIKE '%level%' OR title ILIKE '%rx %' OR title ILIKE '%signal%');

-- Remaining pre_provision defaults to 'offline' (most common)
UPDATE maintenance_tickets SET sub_type = 'offline'
  WHERE type = 'pre_provision' AND sub_type IS NULL;

-- DevOps
UPDATE maintenance_tickets SET sub_type = 'devops'
  WHERE type = 'dev_ops' AND sub_type IS NULL;

-- HSE
UPDATE maintenance_tickets SET sub_type = 'incident'
  WHERE type = 'hse_incident' AND sub_type IS NULL;

UPDATE maintenance_tickets SET sub_type = 'hse'
  WHERE type = 'hse_near_miss' AND sub_type IS NULL;

-- Fibertime
UPDATE maintenance_tickets SET sub_type = 'new'
  WHERE type IN ('new_installation', 'installation') AND sub_type IS NULL;

UPDATE maintenance_tickets SET sub_type = 'fault'
  WHERE type IN ('fault', 'fault_repair') AND sub_type IS NULL;

UPDATE maintenance_tickets SET sub_type = 'mnt'
  WHERE type = 'ont_swap' AND sub_type IS NULL;

-- Modification
UPDATE maintenance_tickets SET sub_type = 'modification'
  WHERE type = 'modification' AND sub_type IS NULL;

-- Incident (general)
UPDATE maintenance_tickets SET sub_type = 'incident'
  WHERE type = 'incident' AND sub_type IS NULL;

-- Anything still NULL gets 'unspecified'
UPDATE maintenance_tickets SET sub_type = 'unspecified'
  WHERE sub_type IS NULL;

-- 6. Normalize legacy type names (keep old values in constraint for safety)
-- fault → fault_repair
UPDATE maintenance_tickets SET type = 'fault_repair'
  WHERE type = 'fault';

-- installation → new_installation
UPDATE maintenance_tickets SET type = 'new_installation'
  WHERE type = 'installation';
