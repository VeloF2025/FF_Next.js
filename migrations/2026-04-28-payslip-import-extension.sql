-- migrations/2026-04-28-payslip-import-extension.sql
-- Phase 4 extension: casuals + skip tracking for the combined-PDF importer.
--
-- Two changes:
--   1. staff.employment_type — distinguishes 'permanent' from 'casual' so the
--      inline-create form on the importer can mark drop-in casuals without
--      polluting the permanent staff list. Existing rows default to permanent.
--   2. payslip_import_skips — audit trail for empCodes the importer couldn't
--      match (HR explicitly skipped). Lets us surface them on the next import
--      ("you skipped VF050 last month — still not matched") and resolve when
--      the staff record finally appears.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS employment_type VARCHAR(20) NOT NULL DEFAULT 'permanent';

ALTER TABLE staff
  DROP CONSTRAINT IF EXISTS staff_employment_type_check;

ALTER TABLE staff
  ADD CONSTRAINT staff_employment_type_check
  CHECK (employment_type IN ('permanent', 'casual'));

CREATE TABLE IF NOT EXISTS payslip_import_skips (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_period      CHAR(7) NOT NULL,           -- 'YYYY-MM'
  emp_code        VARCHAR(20) NOT NULL,
  emp_name        TEXT,
  raw_extracted   JSONB NOT NULL,             -- the ExtractedPayslipPage minus pdfBuffer
  reason          TEXT,                       -- free-form HR note (defaults to 'Skipped on import')
  skipped_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  skipped_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_payslip_id UUID REFERENCES payslips(id) ON DELETE SET NULL,
  CONSTRAINT payslip_import_skips_period_emp_unique
    UNIQUE (pay_period, emp_code)             -- one skip row per empCode per period
);

CREATE INDEX IF NOT EXISTS payslip_import_skips_unresolved_idx
  ON payslip_import_skips (pay_period)
  WHERE resolved_at IS NULL;
