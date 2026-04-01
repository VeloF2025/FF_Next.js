-- Migration 267: EOD Install Sheet tables
-- End-of-Day install sheet upload and 3-way reconciliation (EOD ↔ WA DRs ↔ OES)

BEGIN;

-- Header table: one record per physical form
CREATE TABLE eod_install_sheets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_date      DATE NOT NULL,
  technician_name TEXT,
  technician_id   TEXT,
  photo_url       TEXT,
  photo_hash      TEXT,
  entry_count     INT NOT NULL DEFAULT 0,
  vlm_raw_json    JSONB,
  uploaded_by     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_eod_sheets_date ON eod_install_sheets (sheet_date);
CREATE INDEX idx_eod_sheets_technician ON eod_install_sheets (technician_name);
CREATE UNIQUE INDEX idx_eod_sheets_photo_hash ON eod_install_sheets (photo_hash) WHERE photo_hash IS NOT NULL;

-- Entry table: one row per installation line on the form (max 10 per sheet)
CREATE TABLE eod_install_sheet_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id        UUID NOT NULL REFERENCES eod_install_sheets(id) ON DELETE CASCADE,
  row_number      INT NOT NULL,
  ont_serial      TEXT,
  gizzu_serial    TEXT,
  dr_number       TEXT,
  pon_number      TEXT,
  address         TEXT,
  match_status    TEXT NOT NULL DEFAULT 'pending',
  matched_dr_id   UUID,
  matched_oes_id  UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_eod_entries_sheet ON eod_install_sheet_entries (sheet_id);
CREATE INDEX idx_eod_entries_dr ON eod_install_sheet_entries (dr_number);
CREATE INDEX idx_eod_entries_serial ON eod_install_sheet_entries (ont_serial);
CREATE INDEX idx_eod_entries_match ON eod_install_sheet_entries (match_status);

COMMIT;
