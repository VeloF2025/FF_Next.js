-- 517_eod_sheet_content_hash.sql
--
-- Stops the same paper sheet being recorded twice on the SCANNED path.
--
-- eod_install_sheets already has a unique index on photo_hash, but it is
-- PARTIAL (WHERE photo_hash IS NOT NULL) and the scanned path has no
-- photograph — so nothing constrained it. A double-tap on "Record this sheet",
-- or a storeman re-scanning the same page next week, inserted another sheet
-- plus a full set of entries and double-counted into the reconciliation stats.
--
-- content_hash identifies the sheet by what is actually on it: its date and
-- its exact set of ONT serials. A SELECT-then-INSERT check cannot close this —
-- two concurrent submissions (a flaky-network retry firing twice, which is the
-- likeliest real cause) can both see "no existing row" and both insert. Only a
-- constraint does, so the application treats the unique violation as the
-- answer rather than as an error.
--
-- Partial, like photo_hash: the VLM path leaves it NULL and is unaffected.

ALTER TABLE eod_install_sheets
  ADD COLUMN IF NOT EXISTS content_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_eod_sheets_content_hash
  ON eod_install_sheets (content_hash)
  WHERE content_hash IS NOT NULL;

COMMENT ON COLUMN eod_install_sheets.content_hash IS
  'sha256 of sheet_date + the sorted ONT serial set. Set on the scanned path only; NULL for VLM uploads, which dedupe on photo_hash.';
