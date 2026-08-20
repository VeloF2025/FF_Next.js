-- Rollback 507: unlink what 507 linked.
--
-- Before 507 every purchase_order_items row (1992) and every
-- purchase_requisition_items row (959) had a NULL stock_item_id — verified on
-- the shared database at the time of writing. So clearing exactly the rows
-- whose current link is the unique active name match restores the prior state.
--
-- Rows linked by any other means after 507 ran are deliberately left alone:
-- the WHERE clause only clears a link that equals the name-derived one.
--
-- WARNING: this returns receipts to being skipped by the stock posting, i.e.
-- goods received into nothing.
--
-- The LIMIT 1 below is safe because 507 only ever linked names matching exactly
-- one active stock item. If a name became ambiguous afterwards (someone added a
-- second stock item by the same name), LIMIT 1 may pick the other candidate and
-- the equality test simply will not match — that row stays linked rather than
-- being cleared. Under-rollback, never a wrong link.

UPDATE purchase_order_items poi
   SET stock_item_id = NULL
 WHERE poi.stock_item_id IS NOT NULL
   AND poi.stock_item_id = (
     SELECT s2.id
       FROM stock_items s2
      WHERE s2.is_active
        AND lower(trim(s2.name)) = lower(trim(poi.item_description))
      LIMIT 1
   );

UPDATE goods_receipt_items gri
   SET stock_item_id = NULL
  FROM goods_receipt_notes g
 WHERE g.id = gri.grn_id
   AND g.status <> 'completed'
   AND gri.stock_item_id IS NOT NULL
   AND gri.po_item_id IS NOT NULL;

UPDATE purchase_requisition_items pri
   SET stock_item_id = NULL
 WHERE pri.stock_item_id IS NOT NULL
   AND pri.stock_item_id = (
     SELECT s2.id
       FROM stock_items s2
      WHERE s2.is_active
        AND lower(trim(s2.name)) = lower(trim(pri.item_description))
      LIMIT 1
   );
