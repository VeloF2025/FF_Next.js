-- Rollback 506: back to counting every GRN line regardless of status.
--
-- WARNING: this restores the behaviour where a draft GRN consumes PO quantity,
-- which makes confirming a full delivery fail as an over-receipt. It also drops
-- DELETE handling again. Run it only to return to the exact prior state.
--
-- The quantity_received values written by 506's backfill are NOT restored to
-- their previous numbers; the loop at the bottom recomputes them under the old
-- draft-counting rule, which is what the prior trigger would have produced.

DROP TRIGGER IF EXISTS tr_grn_status_poi ON goods_receipt_notes;
DROP FUNCTION IF EXISTS update_poi_received_for_grn();

CREATE OR REPLACE FUNCTION update_poi_received()
RETURNS TRIGGER AS $$
DECLARE
    v_po_id      uuid;
    v_new_status text;
BEGIN
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

        SELECT purchase_order_id INTO v_po_id
        FROM purchase_order_items
        WHERE id = NEW.po_item_id;

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

DROP TRIGGER IF EXISTS tr_gri_poi_update ON goods_receipt_items;
CREATE TRIGGER tr_gri_poi_update
    AFTER INSERT OR UPDATE ON goods_receipt_items
    FOR EACH ROW
    EXECUTE FUNCTION update_poi_received();

DROP FUNCTION IF EXISTS recompute_poi_received(uuid);

-- Restore the draft-counting numbers on GRN-linked lines only.
UPDATE purchase_order_items poi
SET quantity_received = COALESCE((
        SELECT SUM(i.quantity_accepted)
        FROM goods_receipt_items i
        WHERE i.po_item_id = poi.id), 0),
    status = CASE
        WHEN COALESCE((SELECT SUM(i.quantity_accepted) FROM goods_receipt_items i WHERE i.po_item_id = poi.id), 0) >= poi.quantity_ordered THEN 'received'
        WHEN COALESCE((SELECT SUM(i.quantity_accepted) FROM goods_receipt_items i WHERE i.po_item_id = poi.id), 0) > 0 THEN 'partially_received'
        ELSE 'pending'
    END
WHERE EXISTS (SELECT 1 FROM goods_receipt_items i WHERE i.po_item_id = poi.id);
