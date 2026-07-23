-- 449: H&S contractor schema reconciliation (goal D6, PR-3)
--
-- Live hs_* schema was created out-of-band in Jan 2026 and drifted from both
-- the legacy migration chain and the code. This migration is ADDITIVE-ONLY
-- against the live DB (expand-contract; every statement guarded):
--
--  1. hs_contractor_documents — defined by migration 113 but never applied
--     live; every contractor-documents endpoint 500s on it. Created here with
--     uuid contractor references (live contractors.id/users.id are uuid; the
--     legacy INTEGER refs in 113 predate the uuid cutover).
--  2. hs_contractor_compliance — code (compliance PUT upsert, gateService)
--     writes training_records/notes/score-breakdown/gate columns that live
--     lacks, and upserts ON CONFLICT (contractor_id) which needs the unique
--     index (verified: no duplicate contractor_id rows live).
--  3. hs_checklist_items — unique natural key (template_id, item_text) so the
--     migration-450 seed can be idempotent (verified: no duplicates live).
--
-- Rollback: rollback_449_hs_contractor_schema_reconciliation.sql

BEGIN;

-- 1. Contractor H&S documents (uuid refs; columns the routes actually use)
CREATE TABLE IF NOT EXISTS hs_contractor_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  document_type VARCHAR(100) NOT NULL,
  document_number VARCHAR(100),
  file_url TEXT,
  file_name VARCHAR(255),
  issue_date DATE,
  expiry_date DATE,
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'valid', 'expired', 'rejected', 'expiring_soon')),
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hs_contractor_docs_contractor
  ON hs_contractor_documents(contractor_id);
CREATE INDEX IF NOT EXISTS idx_hs_contractor_docs_expiry
  ON hs_contractor_documents(expiry_date)
  WHERE status NOT IN ('rejected');

COMMENT ON TABLE hs_contractor_documents IS
  'H&S documents uploaded for contractors (policies, insurance, certificates)';

-- 2. Compliance columns the code writes/reads but live lacks
ALTER TABLE hs_contractor_compliance
  ADD COLUMN IF NOT EXISTS training_records JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS document_score INTEGER,
  ADD COLUMN IF NOT EXISTS incident_score INTEGER,
  ADD COLUMN IF NOT EXISTS training_score INTEGER,
  ADD COLUMN IF NOT EXISTS corrective_action_score INTEGER,
  ADD COLUMN IF NOT EXISTS audit_score INTEGER,
  ADD COLUMN IF NOT EXISTS is_gate_approved BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS gate_blockers JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS gate_warnings JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMPTZ;

-- Upsert target for compliance PUT (no duplicate contractor_id rows exist)
CREATE UNIQUE INDEX IF NOT EXISTS hs_contractor_compliance_contractor_id_key
  ON hs_contractor_compliance(contractor_id);

-- 3. Natural key for the idempotent checklist seed (migration 450)
CREATE UNIQUE INDEX IF NOT EXISTS hs_checklist_items_template_text_key
  ON hs_checklist_items(template_id, item_text);

COMMIT;
