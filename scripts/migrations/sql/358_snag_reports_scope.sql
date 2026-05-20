ALTER TABLE snag_reports
  ADD COLUMN scope            TEXT NOT NULL DEFAULT 'project',
  ADD COLUMN scope_zone_no    INT,
  ADD COLUMN scope_pon_no     INT,
  ADD COLUMN scope_poles      TEXT[],
  ADD COLUMN scope_from_date  DATE,
  ADD COLUMN scope_to_date    DATE,
  ADD COLUMN scope_severities TEXT[],
  ADD COLUMN scope_categories TEXT[],
  ADD COLUMN pdf_url          TEXT,
  ADD COLUMN generated_by     UUID REFERENCES users(id),
  ADD COLUMN generated_at     TIMESTAMPTZ;

ALTER TABLE snag_reports DROP CONSTRAINT snag_reports_source_check;
ALTER TABLE snag_reports
  ADD CONSTRAINT snag_reports_source_check
  CHECK (source IN ('tqr', 'works_qa', 'scope'));

ALTER TABLE snag_reports
  ADD CONSTRAINT snag_reports_scope_requires_pdf
  CHECK (source <> 'scope' OR (pdf_url IS NOT NULL AND generated_at IS NOT NULL));

CREATE INDEX snag_reports_scope_idx
  ON snag_reports (project_id, scope, scope_zone_no, scope_pon_no);

CREATE INDEX snag_reports_generated_at_idx
  ON snag_reports (generated_at DESC)
  WHERE source = 'scope';
