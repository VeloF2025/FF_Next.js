-- Rollback 508: unlink what 508 linked by item_code.
--
-- Clears only links that 508 could have been responsible for: the description
-- matches a unique active item_code AND matches no active stock item name.
--
-- The name exclusion is load-bearing. Many stock items carry a name identical
-- to their item_code, so a plain code-match test also matches rows that 507
-- linked by name — clearing those would undo 507 as well. 508 only ever touched
-- rows that were still NULL after 507, i.e. rows with no name match, so that is
-- exactly the set restored here.
--
-- WARNING: an unlinked line is skipped by the stock posting, i.e. goods
-- received into nothing.

UPDATE goods_receipt_items gri
   SET stock_item_id = NULL
  FROM goods_receipt_notes g, purchase_order_items poi
 WHERE g.id = gri.grn_id
   AND poi.id = gri.po_item_id
   AND g.status <> 'completed'
   AND gri.stock_item_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM stock_items sn
      WHERE sn.is_active AND lower(trim(sn.name)) = lower(trim(poi.item_description))
   )
   AND gri.stock_item_id = (
     SELECT s2.id
       FROM stock_items s2
      WHERE s2.is_active
        AND lower(trim(s2.item_code)) = lower(trim(poi.item_description))
      LIMIT 1
   );

UPDATE purchase_order_items poi
   SET stock_item_id = NULL
 WHERE poi.stock_item_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM stock_items sn
      WHERE sn.is_active AND lower(trim(sn.name)) = lower(trim(poi.item_description))
   )
   AND poi.stock_item_id = (
     SELECT s2.id
       FROM stock_items s2
      WHERE s2.is_active
        AND lower(trim(s2.item_code)) = lower(trim(poi.item_description))
      LIMIT 1
   );

UPDATE purchase_requisition_items pri
   SET stock_item_id = NULL
 WHERE pri.stock_item_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM stock_items sn
      WHERE sn.is_active AND lower(trim(sn.name)) = lower(trim(pri.item_description))
   )
   AND pri.stock_item_id = (
     SELECT s2.id
       FROM stock_items s2
      WHERE s2.is_active
        AND lower(trim(s2.item_code)) = lower(trim(pri.item_description))
      LIMIT 1
   );
