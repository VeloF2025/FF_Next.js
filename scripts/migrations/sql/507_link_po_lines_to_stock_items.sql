-- Migration 507: link existing PO lines to their stock items.
--
-- purchase_order_items.stock_item_id is null on all 1992 rows. The requisition
-- form is free text with no item picker, so the link was never captured, and it
-- stayed null through PR → PO → GRN. A receipt line without a stock_item_id is
-- skipped by both postGrnReceiptLines and the stock trigger, so goods were
-- being received into nothing.
--
-- 884 of those lines name exactly one active stock item; none name more than
-- one. Those are linked here by exact, case- and whitespace-insensitive name
-- match. The remaining 1108 name no stock item at all — they need catalogue
-- entries created before they can ever receive into stock, which is a business
-- data task, not something this migration should invent.
--
-- Only rows that are currently NULL are touched, so an existing link is never
-- overwritten, and re-running is a no-op.

UPDATE purchase_order_items poi
   SET stock_item_id = si.id
  FROM stock_items si
 WHERE poi.stock_item_id IS NULL
   AND si.is_active
   AND lower(trim(si.name)) = lower(trim(poi.item_description))
   -- Only when the name identifies exactly one active stock item.
   AND (
     SELECT count(*)
       FROM stock_items s2
      WHERE s2.is_active
        AND lower(trim(s2.name)) = lower(trim(poi.item_description))
   ) = 1;

-- Receipt lines on GRNs that have not been completed yet: take the link from
-- the PO line now that it has one, so a draft typed before this migration can
-- still receive into stock when it is confirmed.
--
-- Completed GRNs are deliberately excluded. Their stock postings already
-- happened (or didn't) under the old linkage; back-filling them would not move
-- any stock, it would only misrepresent what was received at the time.
UPDATE goods_receipt_items gri
   SET stock_item_id = poi.stock_item_id
  FROM purchase_order_items poi, goods_receipt_notes g
 WHERE gri.po_item_id = poi.id
   AND g.id = gri.grn_id
   AND gri.stock_item_id IS NULL
   AND poi.stock_item_id IS NOT NULL
   AND g.status <> 'completed';

-- Same treatment for the requisition lines behind them, so a PR converted to a
-- PO after this migration carries the link forward (convert-to-po already
-- copies stock_item_id — it only ever had null to copy).
UPDATE purchase_requisition_items pri
   SET stock_item_id = si.id
  FROM stock_items si
 WHERE pri.stock_item_id IS NULL
   AND si.is_active
   AND lower(trim(si.name)) = lower(trim(pri.item_description))
   AND (
     SELECT count(*)
       FROM stock_items s2
      WHERE s2.is_active
        AND lower(trim(s2.name)) = lower(trim(pri.item_description))
   ) = 1;
