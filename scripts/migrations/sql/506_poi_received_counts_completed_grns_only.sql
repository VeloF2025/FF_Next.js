-- Migration 506: a draft GRN must not consume PO quantity.
--
-- update_poi_received() (migration 051, grouping bug fixed in 505) set
-- purchase_order_items.quantity_received to SUM(quantity_accepted) over every
-- goods_receipt_items row, regardless of the GRN's status. A draft therefore
-- consumed PO quantity the instant it was typed: an abandoned draft ate the
-- line forever, and confirming a full delivery was reported as an over-receipt
-- because the draft had already claimed it.
--
-- Received quantity now counts COMPLETED GRNs only, and is recomputed when
-- either side changes: a receipt line (insert/update/delete) or a GRN's status.
--
-- Scope note on the backfill at the bottom: 795 PO lines carry a received
-- quantity with no GRN behind them at all — those come from the Odoo/Sage sync
-- and from imports. Recomputing every line would wipe them. The backfill is
-- therefore restricted to lines that actually have goods_receipt_items pointing
-- at them, which is the only population these triggers ever touch.

-- ---------------------------------------------------------------------------
-- One recompute primitive; both triggers call it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recompute_poi_received(p_po_item_id uuid)
RETURNS void AS $$
DECLARE
    v_received   numeric;
    v_po_id      uuid;
    v_new_status text;
BEGIN
    IF p_po_item_id IS NULL THEN
        RETURN;
    END IF;

    SELECT COALESCE(SUM(i.quantity_accepted), 0)
      INTO v_received
      FROM goods_receipt_items i
      JOIN goods_receipt_notes g ON g.id = i.grn_id
     WHERE i.po_item_id = p_po_item_id
       AND g.status = 'completed';

    UPDATE purchase_order_items
       SET quantity_received = v_received,
           status = CASE
               WHEN quantity_ordered > 0 AND v_received >= quantity_ordered THEN 'received'
               WHEN v_received > 0 THEN 'partially_received'
               ELSE 'pending'
           END
     WHERE id = p_po_item_id
    RETURNING purchase_order_id INTO v_po_id;

    IF v_po_id IS NULL THEN
        RETURN;
    END IF;

    -- Roll the line statuses up to the PO. NULL means "leave the PO alone".
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
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Receipt lines: recompute on insert, update and DELETE (delete previously left
-- the column stale high, since the old trigger did not fire on it).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_poi_received()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM recompute_poi_received(OLD.po_item_id);
        RETURN OLD;
    END IF;

    PERFORM recompute_poi_received(NEW.po_item_id);

    -- A line re-pointed at a different PO line has to release the old one.
    IF TG_OP = 'UPDATE' AND OLD.po_item_id IS DISTINCT FROM NEW.po_item_id THEN
        PERFORM recompute_poi_received(OLD.po_item_id);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_gri_poi_update ON goods_receipt_items;
CREATE TRIGGER tr_gri_poi_update
    AFTER INSERT OR UPDATE OR DELETE ON goods_receipt_items
    FOR EACH ROW
    EXECUTE FUNCTION update_poi_received();

-- ---------------------------------------------------------------------------
-- GRN status: draft → completed is what actually consumes PO quantity, and
-- completed → anything else releases it again.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_poi_received_for_grn()
RETURNS TRIGGER AS $$
DECLARE
    r record;
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        FOR r IN
            SELECT DISTINCT po_item_id
              FROM goods_receipt_items
             WHERE grn_id = NEW.id
               AND po_item_id IS NOT NULL
        LOOP
            PERFORM recompute_poi_received(r.po_item_id);
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_grn_status_poi ON goods_receipt_notes;
CREATE TRIGGER tr_grn_status_poi
    AFTER UPDATE OF status ON goods_receipt_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_poi_received_for_grn();

-- ---------------------------------------------------------------------------
-- Backfill — GRN-linked lines only. See the scope note at the top.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT DISTINCT po_item_id
          FROM goods_receipt_items
         WHERE po_item_id IS NOT NULL
    LOOP
        PERFORM recompute_poi_received(r.po_item_id);
    END LOOP;
END;
$$;
