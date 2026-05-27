-- Reconcile queries for the Serial Master Register (Wave 1).
-- Each query is identified by a @name comment and an optional Tolerance comment.
-- The reconcile-serials.ts CLI parses these comments to know check names + tolerances.
-- Each query must return COUNT(*) AS drift_count.

-- @name assets_without_serial
-- Tolerance: 0
-- ONT/Gizzu assets (stock_item_id → FT-ONT/FT-GIZZU) that have no
-- corresponding stock_serials row (by serial_number + stock_item_id).
-- Prod schema correction (PR-7): assets has no asset_type column.
-- Identification is via assets.stock_item_id → stock_items.item_code.
SELECT COUNT(*) AS drift_count
FROM assets a
JOIN stock_items si ON si.id = a.stock_item_id
WHERE si.item_code IN ('FT-ONT', 'FT-GIZZU')
  AND a.serial_number IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM stock_serials ss
    WHERE ss.serial_number  = a.serial_number
      AND ss.stock_item_id  = a.stock_item_id
  );

-- @name issued_without_open_picking
-- Tolerance: 100
-- stock_serials in 'issued' state with no done picking that references them.
-- Prod schema: stock_picking_lines.serial_ids UUID[] (UNNEST to compare).
SELECT COUNT(*) AS drift_count
FROM stock_serials ss
WHERE ss.status = 'issued'
  AND NOT EXISTS (
    SELECT 1
    FROM   stock_picking_lines spl
    JOIN   stock_pickings      sp  ON sp.id = spl.picking_id
    WHERE  ss.id = ANY(spl.serial_ids)
      AND  sp.status = 'done'
  );

-- @name installed_serial_inconsistent_status
-- Tolerance: 100
-- Serials that have an installed_at_drop_id but whose status is not a post-install state.
SELECT COUNT(*) AS drift_count
FROM stock_serials ss
WHERE ss.installed_at_drop_id IS NOT NULL
  AND ss.status NOT IN ('installed', 'activated', 'returned', 'faulty', 'scrapped');

-- @name accountability_issued_counter_drift
-- Tolerance: 0
-- Contractor accountability counter differs from derived count from done pickings.
-- Derived count = total number of serial_ids issued across all done pickings for
-- that contractor (UNNEST the serial_ids array to count per-serial).
-- Only checks contractors that have at least one done picking.
SELECT COUNT(*) AS drift_count
FROM (
  SELECT
    sp.contractor_id,
    COALESCE(csa.total_issued_count, 0)         AS stored_count,
    COUNT(*)::integer                            AS derived_count
  FROM   stock_pickings           sp
  JOIN   stock_picking_lines      spl ON spl.picking_id = sp.id
                                      AND spl.serial_ids IS NOT NULL
                                      AND array_length(spl.serial_ids, 1) > 0
  JOIN   LATERAL unnest(spl.serial_ids) AS u(serial_id) ON TRUE
  LEFT   JOIN contractor_stock_accountability csa
           ON csa.contractor_id = sp.contractor_id
  WHERE  sp.status        = 'done'
    AND  sp.contractor_id IS NOT NULL
  GROUP  BY sp.contractor_id, csa.total_issued_count
  HAVING COALESCE(csa.total_issued_count, 0) <> COUNT(*)
) sub;

-- @name accountability_returned_counter_drift
-- Tolerance: 0
-- Contractor accountability returned counter differs from derived count.
-- Derived count = number of stock_return_lines with disposition='restock'.
-- Mirrors the trigger 5 write path exactly: Trigger 5 increments
-- total_returned_count ONLY when NEW.disposition='restock' (the
-- restock branch in emit_serial_event_on_return_disposition). Filtering
-- on srl.disposition rather than sr.status keeps reconcile and trigger
-- aligned regardless of return workflow timing — a line restocked while
-- the parent return is still 'inspected' (pre-accepted) is still credited.
SELECT COUNT(*) AS drift_count
FROM (
  SELECT
    sr.contractor_id,
    COALESCE(csa.total_returned_count, 0)        AS stored_count,
    COUNT(*)::integer                             AS derived_count
  FROM   stock_returns       sr
  JOIN   stock_return_lines  srl ON srl.return_id = sr.id
                                  AND srl.serial_id IS NOT NULL
                                  AND srl.disposition = 'restock'
  LEFT   JOIN contractor_stock_accountability csa
           ON csa.contractor_id = sr.contractor_id
  WHERE  sr.contractor_id IS NOT NULL
  GROUP  BY sr.contractor_id, csa.total_returned_count
  HAVING COALESCE(csa.total_returned_count, 0) <> COUNT(*)
) sub;

-- @name latest_event_matches_status
-- Tolerance: 0
-- For each serial that has at least one event, the current status must equal
-- the to_state of the most-recent event.
-- NOTE: id DESC is a deterministic tiebreaker — backfilled events (PR-5) share
-- identical occurred_at AND recorded_at within a single run, so ORDER BY without
-- id would be non-deterministic and could randomly flag drift on tolerance 0.
SELECT COUNT(*) AS drift_count
FROM (
  SELECT
    ss.id,
    ss.status,
    latest.to_state
  FROM stock_serials ss
  JOIN LATERAL (
    SELECT to_state
    FROM   stock_serial_events
    WHERE  serial_id = ss.id
    ORDER  BY occurred_at DESC, recorded_at DESC, id DESC
    LIMIT  1
  ) latest ON TRUE
  WHERE ss.status <> latest.to_state
) sub;
