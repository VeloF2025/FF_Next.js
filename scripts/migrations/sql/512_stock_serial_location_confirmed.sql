-- 512: distinguish a CONFIRMED physical location from an ASSUMED one.
--
-- The SharePoint workbook's tabs mean ALLOCATION — "these serials are earmarked
-- for this project" — but the importer has always written the tab into
-- stock_serials.current_location_id, which asserts physical presence.
--
-- Measured 2026-08-21: of 7,866 sheet-imported ONTs that have since been
-- installed, only 2,164 (27.5%) were installed on the project whose warehouse
-- the tab assigned. Mamelodi Pop1 was right 9% of the time; Tembelihle 0%.
-- So the location field has been carrying a claim that is wrong ~3 times in 4.
--
-- The claim is still useful (it is where the stock is MEANT to be, and the
-- handout flow needs somewhere to issue from), so it stays — but it is now
-- explicitly provisional until something physically confirms it.
--
-- FALSE for every existing row is correct: nothing in the system has ever
-- confirmed a physical location. Receiving (scan the carton in on arrival) is
-- what sets it TRUE.

ALTER TABLE stock_serials
  ADD COLUMN IF NOT EXISTS location_confirmed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN stock_serials.location_confirmed IS
  'TRUE only when a physical receipt confirmed current_location_id. FALSE means the location is assumed, typically from a SharePoint workbook tab that actually denotes allocation, not presence.';

-- Partial index: the interesting query is "what have we never confirmed",
-- which is the whole table today and should shrink toward nothing.
CREATE INDEX IF NOT EXISTS idx_stock_serials_unconfirmed_location
  ON stock_serials (current_location_id)
  WHERE location_confirmed = false AND current_location_id IS NOT NULL;
