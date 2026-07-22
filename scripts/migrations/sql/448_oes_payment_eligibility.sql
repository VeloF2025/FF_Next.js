-- 448: capture Fibertime's new per-DR billing columns from the daily OES report.
-- Since ~2026-07-21 the per-site OES xlsx carries two extra columns:
--   14. "Payment Eligibility"   — 'Eligible' | 'Not Eligible' | 'PAID - Invoiced on YYYY-MM-DD'
--   15. "Not Eligible Reason"   — semicolon-joined FT note descriptions,
--                                 e.g. 'Note 4 - SN mismatch (Field App vs OES)'
-- Stored verbatim (raw FT vocabulary, no CHECK) — FT owns the value space.
-- Purely additive; safe to apply before the code deploy.

BEGIN;

ALTER TABLE oes_activations ADD COLUMN IF NOT EXISTS payment_eligibility TEXT;
ALTER TABLE oes_activations ADD COLUMN IF NOT EXISTS not_eligible_reason TEXT;

COMMENT ON COLUMN oes_activations.payment_eligibility IS
  'FT daily OES col 14: Eligible | Not Eligible | PAID - Invoiced on <date>. NULL when the site file predates the column.';
COMMENT ON COLUMN oes_activations.not_eligible_reason IS
  'FT daily OES col 15: semicolon-joined FT note reasons; NULL unless Not Eligible.';

COMMIT;
