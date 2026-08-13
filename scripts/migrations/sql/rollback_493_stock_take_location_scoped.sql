-- rollback_493_stock_take_location_scoped.sql
-- Restore the pre-493 initialize_stock_take_lines(): expected_quantity from the
-- global stock_items.qty_available aggregate, no location requirement.
-- (Restores the known-buggy behaviour — only for emergency rollback.)

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

  INSERT INTO stock_take_lines (stock_take_id, stock_item_id, location_id, warehouse_id, expected_quantity, expected_value)
  SELECT
    take_id,
    si.id,
    take_record.location_id,
    take_record.warehouse_id,
    COALESCE(si.qty_available, 0),
    COALESCE(si.qty_available, 0) * COALESCE(si.standard_cost, 0)
  FROM stock_items si
  WHERE si.is_active = true
    AND (take_record.category_id IS NULL OR si.category_id = take_record.category_id)
    AND NOT EXISTS (
      SELECT 1 FROM stock_take_lines stl
      WHERE stl.stock_take_id = take_id
        AND stl.stock_item_id = si.id
        AND COALESCE(stl.location_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(take_record.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

  GET DIAGNOSTICS items_added = ROW_COUNT;

  UPDATE stock_takes
  SET total_items = items_added,
      updated_at = NOW()
  WHERE id = take_id;

  RETURN items_added;
END;
$$ LANGUAGE plpgsql;
