-- 464: safety library — MSDS/chemical register + SWP/method-statement library
--      (H&S docs-vs-module alignment audit, rec #6)
--
-- Two gaps from the 2026-07-25 audit, closed by one table:
--   * No chemical/MSDS register. Ethyl alcohol, IPA, engine oil, anti-freeze,
--     expanding foam filler and unleaded 95 recur in ALL FOUR client folders,
--     with no home in the module and no way to record a hazard class or a
--     storage location.
--   * No SWP / method-statement content type. Around 20 named procedures
--     ("Working at Heights", "Trenching and Excavation", ...) all landed in the
--     generic `other` document type, invisible to any review cadence.
--
-- Shape decision (Hein, 2026-07-27): ONE table with a content_type
-- discriminator plus nullable chemical-only columns, rather than two dedicated
-- tables or new hs_contractor_documents.document_type values.
--
-- Why not document_type values: hs_contractor_documents.contractor_id is NOT
-- NULL and there is no Velocity Fibre row in `contractors` (12 subcontractors
-- only) — these are VELOCITY's own procedures and safety data sheets, so
-- filing them there would have required inventing a placeholder contractor,
-- and would still have carried no hazard class or storage location.
--
-- project_id is nullable: NULL = applies company-wide, mirroring how
-- hs_risk_register (migration 113) and hs_appointment_letters (455) already
-- model Velocity-own artifacts.
--
-- No seed data. The recurring chemicals are known, but a GHS hazard
-- classification must be transcribed from the actual safety data sheet, not
-- guessed at — an entry with an invented hazard class is worse than no entry.
--
-- Idempotent: safe to run against live and to re-run under the deploy's
-- run-pending-migrations.sh. Rollback: rollback_464_hs_safety_library.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS hs_safety_library (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type     varchar(24) NOT NULL,
  title            text NOT NULL,
  -- the procedure/SDS reference as it appears on the document itself
  reference        varchar(80),
  version          varchar(24),
  -- NULL = applies company-wide (mirrors hs_risk_register)
  project_id       uuid REFERENCES projects(id) ON DELETE SET NULL,
  file_url         text,
  file_name        varchar(255),
  effective_date   date,
  -- next scheduled review of the procedure / re-check of the data sheet
  review_date      date,
  notes            text,
  -- inactive = superseded, kept for the audit trail rather than deleted
  is_active        boolean NOT NULL DEFAULT true,
  -- ----- MSDS-only columns (NULL for every other content type) -----
  supplier         varchar(160),
  ghs_hazard_class varchar(120),
  storage_location text,
  -- -----------------------------------------------------------------
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_safety_library_content_type_check
    CHECK (content_type IN ('msds', 'swp', 'method_statement', 'jsa')),
  -- Keeps the one-table discriminator honest: a method statement has no
  -- supplier or hazard class, so those columns must stay NULL unless the row
  -- really is a safety data sheet.
  CONSTRAINT hs_safety_library_chemical_fields_msds_only
    CHECK (
      content_type = 'msds'
      OR (supplier IS NULL AND ghs_hazard_class IS NULL AND storage_location IS NULL)
    ),
  CONSTRAINT hs_safety_library_review_after_effective
    CHECK (review_date IS NULL OR effective_date IS NULL OR review_date >= effective_date),
  CONSTRAINT hs_safety_library_title_not_blank
    CHECK (btrim(title) <> '')
);

CREATE INDEX IF NOT EXISTS hs_safety_library_content_type_idx
  ON hs_safety_library (content_type);
CREATE INDEX IF NOT EXISTS hs_safety_library_project_idx
  ON hs_safety_library (project_id);
CREATE INDEX IF NOT EXISTS hs_safety_library_review_idx
  ON hs_safety_library (review_date) WHERE is_active;

COMMIT;
