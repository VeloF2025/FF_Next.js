-- Migration 508: link the remaining PO lines by stock item CODE.
--
-- 507 linked lines whose item_description names a stock item. It left 1108
-- lines behind, and most of them do not hold a name at all — they hold a code:
-- cons-cab-clip, dress-hook-2way, cab-deadend-4.50-6.19-mini. Those descriptions
-- came in from BOQ-style imports where the code landed in the description field.
--
-- 314 of them are exactly one active stock item's item_code. No active code is
-- duplicated in stock_items, so the match cannot be ambiguous, but the same
-- count = 1 guard as 507 is applied anyway rather than relying on that.
--
-- The other 794 lines (120 distinct codes) exist in neither stock_items nor
-- material_catalog. They need catalogue entries created before they can ever
-- receive into stock; 442 of them sit on POs that are still open. Inventing
-- those entries from a bare code is a business decision, not a migration's, so
-- they are deliberately left unlinked.
--
-- Only currently-NULL rows are touched, so a link set by 507 or by hand is
-- never overwritten and re-running is a no-op.

UPDATE purchase_order_items poi
   SET stock_item_id = si.id
  FROM stock_items si
 WHERE poi.stock_item_id IS NULL
   AND si.is_active
   AND lower(trim(si.item_code)) = lower(trim(poi.item_description))
   AND (
     SELECT count(*)
       FROM stock_items s2
      WHERE s2.is_active
        AND lower(trim(s2.item_code)) = lower(trim(poi.item_description))
   ) = 1;

-- Requisition lines behind them, so a PR converted to a PO after this carries
-- the link forward.
UPDATE purchase_requisition_items pri
   SET stock_item_id = si.id
  FROM stock_items si
 WHERE pri.stock_item_id IS NULL
   AND si.is_active
   AND lower(trim(si.item_code)) = lower(trim(pri.item_description))
   AND (
     SELECT count(*)
       FROM stock_items s2
      WHERE s2.is_active
        AND lower(trim(s2.item_code)) = lower(trim(pri.item_description))
   ) = 1;

-- Receipt lines on GRNs that have not completed yet pick the link up from their
-- PO line. Completed GRNs are left alone: back-filling them would not move any
-- stock, only misrepresent what was received at the time.
UPDATE goods_receipt_items gri
   SET stock_item_id = poi.stock_item_id
  FROM purchase_order_items poi, goods_receipt_notes g
 WHERE gri.po_item_id = poi.id
   AND g.id = gri.grn_id
   AND gri.stock_item_id IS NULL
   AND poi.stock_item_id IS NOT NULL
   AND g.status <> 'completed';
