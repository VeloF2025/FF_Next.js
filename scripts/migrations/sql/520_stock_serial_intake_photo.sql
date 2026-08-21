-- 520_stock_serial_intake_photo.sql
--
-- Lets a SINGLE unit be taken into stock when the sheet has never listed it,
-- on the evidence of a photograph of its label.
--
-- Field report 2026-08-21: two Gizzu serials (GU18W12V2601016741 and
-- ...745) were refused as "Serial number not found". They genuinely are not in
-- stock — the 2601 batch is there, 124 units, but its range runs ...037025 to
-- ...058200, and these two are from a consignment the workbook never listed.
--
-- Migration 515 already allows taking in unlisted stock, but only when a
-- CARTON payload corroborates it: nine serials plus a declared count that
-- cross-check each other. A Gizzu has no carton — it is handled one at a time —
-- so both paths were closed and a Gizzu the sheet lacks could not be issued at
-- all. Blocking it does not stop the handout; it stops the RECORD of it, which
-- is the failure this whole programme exists to unwind.
--
-- The photograph is the substitute for that cross-check. Be clear about what
-- it proves: NOT that the typed digits match the label — nobody reads it at
-- the moment of scanning — but that a real unit with a label existed, tied to
-- a named storeman at a known time, and that a human can check it afterwards.
-- It converts an unverifiable claim into an auditable one.

ALTER TABLE stock_serials
  ADD COLUMN IF NOT EXISTS intake_photo_key text,
  ADD COLUMN IF NOT EXISTS intake_photo_url text;

COMMENT ON COLUMN stock_serials.intake_photo_key IS
  'VF Storage key of the label photo evidencing a single unlisted unit. Set by the app for single-serial field intake; carton intake corroborates itself and leaves it NULL. Unique: one photo cannot stand for two units.';

-- ONE PHOTO, ONE UNIT.
--
-- Without this, the same key could be attached to any number of serials and
-- the audit trail would be a single photograph backing an arbitrary number of
-- supposedly distinct units — which is exactly the accountability the feature
-- claims to provide. The app refuses a reused key within a request; this
-- refuses it across requests too, and is the only thing that actually holds.
--
-- Partial, because carton intake and every ordinary serial leave it NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_serials_intake_photo_key
  ON stock_serials (intake_photo_key)
  WHERE intake_photo_key IS NOT NULL;

-- The audit query: single-unit intakes, which are the ones resting on a photo.
CREATE INDEX IF NOT EXISTS idx_stock_serials_intake_photo
  ON stock_serials (intake_at)
  WHERE provenance = 'field_intake' AND intake_photo_key IS NOT NULL;
