-- Migration 505: fix update_poi_received() aggregate grouping error
--
-- The PO-status branch of the trigger selected a bare `status` column inside an
-- aggregate query with no GROUP BY:
--
--     SELECT CASE ... ELSE status END FROM purchase_order_items WHERE ...
--
-- Postgres rejects that at plan time with 42803 ("column must appear in the
-- GROUP BY clause"), so EVERY insert into goods_receipt_items carrying a
-- po_item_id failed. Net effect: creating a GRN against a purchase order was
-- impossible ("Failed to create GRN", 500 on POST /api/procurement/grn).
--
-- The intent of `ELSE status` was "leave the PO status unchanged". This version
-- expresses that by computing the target status into a variable and skipping the
-- UPDATE when there is nothing to change.

CREATE OR REPLACE FUNCTION update_poi_received()
RETURNS TRIGGER AS $$
DECLARE
    v_po_id      uuid;
    v_new_status text;
BEGIN
    IF NEW.po_item_id IS NOT NULL THEN
        -- Update PO item received quantity
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

        SELECT purchase_order_id INTO v_po_id
        FROM purchase_order_items
        WHERE id = NEW.po_item_id;

        -- Roll the item statuses up to the PO. NULL means "leave the PO alone".
        SELECT CASE
            WHEN COUNT(*) = 0 THEN NULL
            WHEN COUNT(*) = COUNT(*) FILTER (WHERE status = 'received') THEN 'received'
            WHEN COUNT(*) FILTER (WHERE status IN ('received', 'partially_received')) > 0 THEN 'partially_received'
            ELSE NULL
        END INTO v_new_status
        FROM purchase_order_items
        WHERE purchase_order_id = v_po_id;

        IF v_new_status IS NOT NULL THEN
            UPDATE purchase_orders
            SET status = v_new_status,
                updated_at = NOW()
            WHERE id = v_po_id
              AND status IS DISTINCT FROM v_new_status;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
