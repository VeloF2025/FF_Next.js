-- Rollback 505: restore the pre-fix update_poi_received().
--
-- WARNING: the restored body contains the 42803 grouping bug and makes GRN
-- creation against a purchase order fail again. Only run this to get back to
-- the exact prior state.

CREATE OR REPLACE FUNCTION update_poi_received()
RETURNS TRIGGER AS $$
BEGIN
    -- Update PO item received quantity
    IF NEW.po_item_id IS NOT NULL THEN
        UPDATE purchase_order_items
        SET
            quantity_received = (
                SELECT COALESCE(SUM(quantity_accepted), 0)
                FROM goods_receipt_items
                WHERE po_item_id = NEW.po_item_id
            ),
            status = CASE
                WHEN (SELECT COALESCE(SUM(quantity_accepted), 0) FROM goods_receipt_items WHERE po_item_id = NEW.po_item_id) >= quantity_ordered THEN 'received'
                WHEN (SELECT COALESCE(SUM(quantity_accepted), 0) FROM goods_receipt_items WHERE po_item_id = NEW.po_item_id) > 0 THEN 'partially_received'
                ELSE 'pending'
            END
        WHERE id = NEW.po_item_id;

        -- Update PO status based on items
        UPDATE purchase_orders
        SET status = (
            SELECT CASE
                WHEN COUNT(*) = COUNT(CASE WHEN status = 'received' THEN 1 END) THEN 'received'
                WHEN COUNT(CASE WHEN status IN ('received', 'partially_received') THEN 1 END) > 0 THEN 'partially_received'
                ELSE status
            END
            FROM purchase_order_items
            WHERE purchase_order_id = (SELECT purchase_order_id FROM purchase_order_items WHERE id = NEW.po_item_id)
        )
        WHERE id = (SELECT purchase_order_id FROM purchase_order_items WHERE id = NEW.po_item_id);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
