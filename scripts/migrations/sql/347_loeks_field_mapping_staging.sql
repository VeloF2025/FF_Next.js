-- 346_loeks_field_mapping_staging.sql
-- Staging table for Loeks Ellis field-captured property↔DR↔ONT serial mappings
-- for the Mohadin project (PRJ-1761242661257).
-- Source: Google Drive folder 1e8NBEirNd1W8WHruuRhrSoPcN8NCRUpX (PONs 17-32).
-- Workflow: stage + review (see scripts/imports/mohadin-loeks/). NEVER writes
-- to drops directly — apply is a separate, reviewed bulk update.

CREATE TABLE IF NOT EXISTS loeks_field_mappings (
  id                BIGSERIAL PRIMARY KEY,
  pon_no            INT  NOT NULL,
  source_sheet_id   TEXT NOT NULL,
  source_row_index  INT  NOT NULL,
  property_number   TEXT,
  dr_number         TEXT,
  ont_serial        TEXT,
  gizzu_serial      TEXT,
  dwelling_label    TEXT,
  notes_raw         TEXT,
  pre_provision     BOOLEAN NOT NULL DEFAULT FALSE,
  needs_dr          BOOLEAN NOT NULL DEFAULT FALSE,
  cross_pon_hint    TEXT,
  extracted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  match_status      TEXT,
  match_drop_id     UUID,
  match_notes       TEXT,
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       UUID,
  applied_at        TIMESTAMPTZ,
  apply_status      TEXT,
  apply_error       TEXT,
  CONSTRAINT loeks_field_mappings_row_uq UNIQUE (source_sheet_id, source_row_index)
);

CREATE INDEX IF NOT EXISTS loeks_field_mappings_dr_idx
  ON loeks_field_mappings (dr_number) WHERE dr_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS loeks_field_mappings_ont_idx
  ON loeks_field_mappings (ont_serial) WHERE ont_serial IS NOT NULL;
CREATE INDEX IF NOT EXISTS loeks_field_mappings_property_idx
  ON loeks_field_mappings (property_number) WHERE property_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS loeks_field_mappings_match_status_idx
  ON loeks_field_mappings (match_status);
CREATE INDEX IF NOT EXISTS loeks_field_mappings_pon_idx
  ON loeks_field_mappings (pon_no);

COMMENT ON TABLE loeks_field_mappings IS
  'Staging table for Loeks Ellis field-captured property↔DR↔ONT mappings (Mohadin PONs 17-32). Source: Google Drive folder 1e8NBEirNd1W8WHruuRhrSoPcN8NCRUpX. Import via scripts/imports/mohadin-loeks/import.ts. Never updates drops directly — review match_status, then apply via reconcile.sql.';
