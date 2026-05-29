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

-- accountability_issued_counter_drift / accountability_returned_counter_drift
-- REMOVED (Sprint E Track 4.5, mig 392): contractor_stock_accountability was dropped.
-- The live v_contractor_accountability view (mig 391) supersedes the counter table,
-- so there is no longer a stored counter to reconcile against.

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
