-- 525_stock_take_init_only_stocked_items.sql
-- Initialize stock-take lines only for items actually stocked at the location.
--
-- Before this, initialize_stock_take_lines() created one line per ACTIVE stock
-- item (~300), regardless of whether the location held any — and Complete
-- requires every line counted, so counting 18 real items meant keying ~280
-- zeros. Field complaint: "ek moet deur hele lys gaan en 0 gaan insit".
--
-- Now only items with a non-zero summed on-hand at the take's location get a
-- line (the optional category filter still applies on top). Stock found during
-- the count that has no line is handled by the add-line API
-- (POST /api/procurement/stock-takes/[id]/lines with stock_item_id), which
-- creates a line with the location's expected quantity (usually 0), so the
-- positive-variance case is still covered.
--
-- CREATE OR REPLACE only — no data migration; existing takes keep their lines.

CREATE OR REPLACE FUNCTION initialize_stock_take_lines(take_id UUID)
RETURNS INT AS $$
DECLARE
  take_record RECORD;
  items_added INT := 0;
BEGIN
  SELECT * INTO take_record FROM stock_takes WHERE id = take_id;

  IF take_record IS NULL THEN
    RAISE EXCEPTION 'Stock take not found';
  END IF;

  IF take_record.location_id IS NULL THEN
    RAISE EXCEPTION 'Stock take % has no location; a location is required before initializing lines', take_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- One line per active item WITH stock at the take's location (non-zero summed
  -- on-hand, so negative quants still surface), respecting the optional
  -- category filter. expected_quantity = the location's real on-hand.
  INSERT INTO stock_take_lines (
    stock_take_id, stock_item_id, location_id, warehouse_id, expected_quantity, expected_value
  )
  SELECT
    take_id,
    si.id,
    take_record.location_id,
    take_record.warehouse_id,
    sq.qty,
    sq.qty * COALESCE(si.standard_cost, 0)
  FROM stock_items si
  JOIN (
    SELECT stock_item_id, SUM(quantity) AS qty
    FROM stock_quants
    WHERE location_id = take_record.location_id
    GROUP BY stock_item_id
    HAVING SUM(quantity) <> 0
  ) sq ON sq.stock_item_id = si.id
  WHERE si.is_active = true
    AND (take_record.category_id IS NULL OR si.category_id = take_record.category_id)
    AND NOT EXISTS (
      SELECT 1 FROM stock_take_lines stl
      WHERE stl.stock_take_id = take_id
        AND stl.stock_item_id = si.id
        AND stl.location_id = take_record.location_id
    );

  GET DIAGNOSTICS items_added = ROW_COUNT;

  UPDATE stock_takes
  SET total_items = items_added,
      updated_at = NOW()
  WHERE id = take_id;

  RETURN items_added;
END;
$$ LANGUAGE plpgsql;
