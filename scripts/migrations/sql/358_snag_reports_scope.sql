ALTER TABLE snag_reports
  ADD COLUMN IF NOT EXISTS scope            TEXT NOT NULL DEFAULT 'project',
  ADD COLUMN IF NOT EXISTS scope_zone_nos   INT[],
  ADD COLUMN IF NOT EXISTS scope_pon_nos    INT[],
  ADD COLUMN IF NOT EXISTS scope_poles      TEXT[],
  ADD COLUMN IF NOT EXISTS scope_from_date  DATE,
  ADD COLUMN IF NOT EXISTS scope_to_date    DATE,
  ADD COLUMN IF NOT EXISTS scope_severities TEXT[],
  ADD COLUMN IF NOT EXISTS scope_categories TEXT[],
  ADD COLUMN IF NOT EXISTS pdf_url          TEXT,
  ADD COLUMN IF NOT EXISTS generated_by     UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS generated_at     TIMESTAMPTZ;

ALTER TABLE snag_reports DROP CONSTRAINT IF EXISTS snag_reports_source_check;
ALTER TABLE snag_reports
  ADD CONSTRAINT snag_reports_source_check
  CHECK (source IN ('tqr', 'works_qa', 'scope'));

ALTER TABLE snag_reports
  DROP CONSTRAINT IF EXISTS snag_reports_scope_requires_pdf;
ALTER TABLE snag_reports
  ADD CONSTRAINT snag_reports_scope_requires_pdf
  CHECK (source <> 'scope' OR (pdf_url IS NOT NULL AND generated_at IS NOT NULL));

CREATE INDEX IF NOT EXISTS snag_reports_scope_idx
  ON snag_reports (project_id, scope);

CREATE INDEX IF NOT EXISTS snag_reports_generated_at_idx
  ON snag_reports (generated_at DESC)
  WHERE source = 'scope';

-- Per-(project, day) counter for generating SCOPE-<code>-<YYYYMMDD>-<seq> report numbers.
-- The reportNumberGenerator service uses INSERT ... ON CONFLICT DO UPDATE on this table
-- under an advisory lock to guarantee distinct sequence values when two managers click
-- "Generate" simultaneously.
CREATE TABLE IF NOT EXISTS snag_report_seq (
  project_id  UUID NOT NULL,
  date_part   TEXT NOT NULL,
  last_seq    INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, date_part)
);
