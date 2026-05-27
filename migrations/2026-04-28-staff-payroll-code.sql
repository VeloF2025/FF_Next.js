-- migrations/2026-04-28-staff-payroll-code.sql
-- Add payroll_code to staff for matching combined-PDF payslip imports.
--
-- The HR-side combined-PDF importer reads VIP's "Velocity-payslips.pdf" exports.
-- Each page carries an Emp Code (e.g. VF002) — once HR maps an unmatched page to
-- a staff member, we persist that mapping here so future months auto-match.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS payroll_code VARCHAR(20);

CREATE UNIQUE INDEX IF NOT EXISTS staff_payroll_code_unique
  ON staff (payroll_code)
  WHERE payroll_code IS NOT NULL;
