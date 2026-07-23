-- Rollback for 449_hs_contractor_schema_reconciliation.sql
-- Drops only what 449 added. Data in the added columns/table is lost on
-- rollback — acceptable: nothing wrote them before 449.

BEGIN;

DROP INDEX IF EXISTS hs_checklist_items_template_text_key;
DROP INDEX IF EXISTS hs_contractor_compliance_contractor_id_key;

ALTER TABLE hs_contractor_compliance
  DROP COLUMN IF EXISTS calculated_at,
  DROP COLUMN IF EXISTS gate_warnings,
  DROP COLUMN IF EXISTS gate_blockers,
  DROP COLUMN IF EXISTS is_gate_approved,
  DROP COLUMN IF EXISTS audit_score,
  DROP COLUMN IF EXISTS corrective_action_score,
  DROP COLUMN IF EXISTS training_score,
  DROP COLUMN IF EXISTS incident_score,
  DROP COLUMN IF EXISTS document_score,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS training_records;

DROP TABLE IF EXISTS hs_contractor_documents;

COMMIT;
