DROP TABLE IF EXISTS snag_report_seq;
DROP INDEX IF EXISTS snag_reports_generated_at_idx;
DROP INDEX IF EXISTS snag_reports_scope_idx;
ALTER TABLE snag_reports DROP CONSTRAINT IF EXISTS snag_reports_scope_requires_pdf;
ALTER TABLE snag_reports DROP CONSTRAINT IF EXISTS snag_reports_source_check;
ALTER TABLE snag_reports
  ADD CONSTRAINT snag_reports_source_check
  CHECK (source IN ('tqr', 'works_qa'));
ALTER TABLE snag_reports
  DROP COLUMN IF EXISTS generated_at,
  DROP COLUMN IF EXISTS generated_by,
  DROP COLUMN IF EXISTS pdf_url,
  DROP COLUMN IF EXISTS scope_categories,
  DROP COLUMN IF EXISTS scope_severities,
  DROP COLUMN IF EXISTS scope_to_date,
  DROP COLUMN IF EXISTS scope_from_date,
  DROP COLUMN IF EXISTS scope_poles,
  DROP COLUMN IF EXISTS scope_pon_no,
  DROP COLUMN IF EXISTS scope_zone_no,
  DROP COLUMN IF EXISTS scope;
