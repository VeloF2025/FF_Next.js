-- 516_eod_sheet_source.sql
--
-- Distinguishes a sheet whose serials were SCANNED off the paper from one whose
-- serials were read by the VLM out of a photograph.
--
-- Both describe the same physical document — the "HOME DROP AND ACTIVATION -
-- EQUIPMENT ALLOCATION FORM" — so they share eod_install_sheets rather than
-- getting a table each. But their accuracy differs enough that a reconciler
-- must be able to tell them apart: measured on the 21 sheets captured in May
-- 2026, the VLM extracted 190 of 224 ONT serials (85%). A barcode read of the
-- same sticker column is effectively exact.
--
-- 'vlm'     — serials extracted from a photo (the existing upload path)
-- 'scanned' — serials read from the stickers with the stores PWA scanner
--
-- Existing rows are all 'vlm': the scanner path did not exist before this.

ALTER TABLE eod_install_sheets
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'vlm';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'eod_install_sheets_source_check'
  ) THEN
    ALTER TABLE eod_install_sheets
      ADD CONSTRAINT eod_install_sheets_source_check
      CHECK (source IN ('vlm', 'scanned'));
  END IF;
END $$;

COMMENT ON COLUMN eod_install_sheets.source IS
  'vlm = serials read from a photo by the VLM; scanned = serials read from the barcode stickers in the stores PWA.';

CREATE INDEX IF NOT EXISTS idx_eod_sheets_source ON eod_install_sheets (source);
