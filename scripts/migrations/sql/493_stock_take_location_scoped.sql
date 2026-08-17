-- 493_stock_take_location_scoped.sql
-- Make stock takes location-scoped and safe to approve.
--
-- Before this, initialize_stock_take_lines() copied stock_items.qty_available
-- (a cross-warehouse aggregate) into expected_quantity and copied the take's
-- (frequently NULL) location_id onto every line. A NULL location then crashed
-- the approval INSERT into stock_quants (location_id is NOT NULL) and made the
-- decrease branch's `WHERE location_id = NULL` match zero rows.
--
-- This rewrite:
--   * requires the take to have a location before lines can be initialized;
--   * derives expected_quantity from stock_quants AT THAT LOCATION (the real
--     on-hand for the location being counted), not the global aggregate.
-- CREATE OR REPLACE only — no data migration. The two historical takes are
-- both cancelled, so no rows depend on the old behaviour.

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

  -- One line per active item (respecting the optional category filter), with
  -- expected_quantity = the summed on-hand for that item at the take's location.
  -- Items with no stock at the location get expected 0, so unexpected stock
  -- found during the count still produces a positive variance.
  INSERT INTO stock_take_lines (
    stock_take_id, stock_item_id, location_id, warehouse_id, expected_quantity, expected_value
  )
  SELECT
    take_id,
    si.id,
    take_record.location_id,
    take_record.warehouse_id,
    COALESCE(sq.qty, 0),
    COALESCE(sq.qty, 0) * COALESCE(si.standard_cost, 0)
  FROM stock_items si
  LEFT JOIN (
    SELECT stock_item_id, SUM(quantity) AS qty
    FROM stock_quants
    WHERE location_id = take_record.location_id
    GROUP BY stock_item_id
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
