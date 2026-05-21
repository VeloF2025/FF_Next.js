-- Reconcile queries for the Serial Master Register (Wave 1).
-- Each query is identified by a @name comment and an optional Tolerance comment.
-- The reconcile-serials.ts CLI parses these comments to know check names + tolerances.
-- Each query must return COUNT(*) AS drift_count.

-- @name assets_without_serial
-- Tolerance: 0
-- ONT/Gizzu assets that have no corresponding stock_serials row (by serial_number).
SELECT COUNT(*) AS drift_count
FROM assets a
WHERE a.asset_type IN ('ont', 'gizzu')
  AND NOT EXISTS (
    SELECT 1 FROM stock_serials ss
    WHERE ss.serial_number = a.serial_number
  );

-- @name issued_without_open_picking
-- Tolerance: 100
-- stock_serials in 'issued' state with no done picking that references them.
SELECT COUNT(*) AS drift_count
FROM stock_serials ss
WHERE ss.status = 'issued'
  AND NOT EXISTS (
    SELECT 1
    FROM   stock_picking_lines spl
    JOIN   stock_pickings      sp  ON sp.id = spl.picking_id
    WHERE  spl.stock_serial_id = ss.id
      AND  sp.status           = 'done'
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
-- Only checks contractors that have at least one done picking.
SELECT COUNT(*) AS drift_count
FROM (
  SELECT
    sp.contractor_id,
    COALESCE(csa.total_issued_count, 0)                         AS stored_count,
    COUNT(DISTINCT spl.id)::integer                              AS derived_count
  FROM   stock_pickings           sp
  JOIN   stock_picking_lines      spl ON spl.picking_id = sp.id
                                      AND spl.stock_serial_id IS NOT NULL
  LEFT   JOIN contractor_stock_accountability csa
           ON csa.contractor_id = sp.contractor_id
  WHERE  sp.status        = 'done'
    AND  sp.contractor_id IS NOT NULL
  GROUP  BY sp.contractor_id, csa.total_issued_count
  HAVING COALESCE(csa.total_issued_count, 0) <> COUNT(DISTINCT spl.id)
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
