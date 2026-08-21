-- 515_stock_serial_field_intake.sql
--
-- Lets a storeman issue a serial the stock sheet has never listed, instead of
-- being refused at the scan step.
--
-- The problem this solves, from the field on 2026-08-21: a real Nokia carton
-- was scanned, its DataMatrix decoded all 9 serials correctly, and every one
-- came back "Serial number not found" because the SharePoint workbook does not
-- contain that consignment. The stock is physically on the shelf. Refusing the
-- handout does not stop it happening — it stops it being RECORDED, which is
-- how we ended up with 25,291 OES activations against 2 issue events.
--
-- So the serial is created on the spot, marked as having come from the field
-- rather than from the sheet, and reconciled when the sheet catches up.
--
--   provenance          'sheet'        — received from the workbook (the norm)
--                       'field_intake' — created because a carton was scanned
--                                        that the workbook did not list
--   source_confirmed_at  set when the sheet later lists a field_intake serial.
--                        NULL on a field_intake row means still unconfirmed —
--                        this is what the ageing report reads.
--   intake_carton_id     the carton's package id, so the 9 stay traceable as a
--                        box rather than as nine unrelated serials.
--   intake_by_staff_id / intake_at  who scanned it in, and when.
--
-- Deliberately NOT a separate table: a field_intake serial is a real serial
-- and must flow through custody, promotion and the mig-387 event triggers
-- exactly like any other. A parallel table would need every one of those paths
-- duplicated, and would drift.

ALTER TABLE stock_serials
  ADD COLUMN IF NOT EXISTS provenance text NOT NULL DEFAULT 'sheet',
  ADD COLUMN IF NOT EXISTS source_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS intake_carton_id text,
  ADD COLUMN IF NOT EXISTS intake_by_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS intake_at timestamptz;

-- Constrain to the two known values. Anything else is a bug, and a typo'd
-- provenance would silently exclude rows from the reconciliation report.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_serials_provenance_check'
  ) THEN
    ALTER TABLE stock_serials
      ADD CONSTRAINT stock_serials_provenance_check
      CHECK (provenance IN ('sheet', 'field_intake'));
  END IF;
END $$;

COMMENT ON COLUMN stock_serials.provenance IS
  'sheet = received from the SharePoint workbook; field_intake = created because a scanned carton was not in the workbook.';
COMMENT ON COLUMN stock_serials.source_confirmed_at IS
  'When the workbook caught up with a field_intake serial. NULL + field_intake = still unconfirmed.';

-- The ageing report's only query: unconfirmed field intake, oldest first.
-- Partial, because these are a tiny minority of a 28k+ row table.
CREATE INDEX IF NOT EXISTS idx_stock_serials_unconfirmed_intake
  ON stock_serials (intake_at)
  WHERE provenance = 'field_intake' AND source_confirmed_at IS NULL;

-- No backfill statement here on purpose. ADD COLUMN ... NOT NULL DEFAULT
-- 'sheet' already materialises 'sheet' on every existing row before the NOT
-- NULL is enforced, so an `UPDATE ... WHERE provenance IS NULL` could never
-- match anything. An earlier draft carried one and it was dead code.
