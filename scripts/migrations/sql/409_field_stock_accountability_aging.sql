-- Migration 409: field-stock accountability — aging buckets + per-project breakdown
-- (version = max(DB max 407, file max 408) + 1.)
--
-- Tier 2 of the Stores Accountability rollout. Adds two ADDITIVE companion views
-- consumed by the Procurement → Field Stock → Accountability tab. The existing
-- v_holder_accountability view is NOT touched (lowest-risk extension shape):
--
--   v_holder_held_aging       — per holder, days-held bucket counts (0-7 / 8-30 /
--                               30+) + oldest-held timestamp/age. The list + detail
--                               APIs LEFT JOIN this on holder_id.
--   v_holder_project_breakdown — per (holder, project) held-serial count + value,
--                               for the holder detail drawer.
--
-- ── Aging join path (documented) ────────────────────────────────────────────
-- A held unit's age basis is the moment it entered the holder's custody:
--   • Serial-tracked units: the most-recent ISSUE picking that lists the serial.
--     stock_serials (holder_id set, status='issued')
--       → stock_picking_lines  (serial_ids @> ARRAY[serial.id])
--       → stock_pickings        (picking_type='issue', latest created_at)
--     Falls back to stock_serials.created_at when no issuing picking is found
--     (legacy serials promoted outside the picking flow).
--   • Non-serial (bulk) lines: stock_custody.created_at directly — bulk custody
--     carries no serial→picking link, so the custody row's own creation is the
--     best-available age basis (spec: "falling back to stock_custody.created_at
--     for bulk lines").
-- Bucket boundaries partition cleanly: age ≤ 7d → 0_7; 7d < age ≤ 30d → 8_30;
-- age > 30d → 31_plus.
--
-- ── Project join path (documented) ──────────────────────────────────────────
-- Held SERIAL stock is attributed to the project of its most-recent issuing
-- picking (stock_pickings.project_id), via the same serial→line→picking chain.
-- project_id is NULL for legacy issues (the PWA only began stamping it in this
-- PR) → those roll up under a NULL project ("Unassigned" in the UI). Bulk custody
-- is intentionally excluded from the project breakdown: it has no serial→picking
-- link, so per-project attribution of an aggregated quantity would be a guess.

BEGIN;

-- ── v_holder_held_aging ───────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_holder_held_aging AS
WITH held_units AS (
  -- Serial-tracked held units: one row per held serial, aged by issuing picking.
  -- units=1 — each issued serial is one held unit (matches the serial custody
  -- quantity that v_holder_accountability.held_count sums).
  SELECT
    s.holder_id,
    COALESCE(iss.created_at, s.created_at) AS held_since,
    1::numeric AS units
  FROM stock_serials s
  LEFT JOIN LATERAL (
    SELECT p.created_at
    FROM stock_picking_lines pl
    JOIN stock_pickings p ON p.id = pl.picking_id
    WHERE pl.serial_ids @> ARRAY[s.id]::uuid[]
      AND p.picking_type = 'issue'
    ORDER BY p.created_at DESC
    LIMIT 1
  ) iss ON true
  WHERE s.holder_id IS NOT NULL
    AND s.status = 'issued'

  UNION ALL

  -- Non-serial (bulk) held lines: one row per non-empty custody line, aged by
  -- the custody row's creation timestamp. units=quantity so the bucket totals
  -- reconcile with v_holder_accountability.held_count (which SUMs custody
  -- quantity) — not one-per-line, which understated bulk lines with qty > 1.
  SELECT
    sc.holder_id,
    sc.created_at AS held_since,
    sc.quantity AS units
  FROM stock_custody sc
  JOIN stock_items si ON si.id = sc.stock_item_id
  WHERE sc.quantity > 0
    AND COALESCE(si.tracking_type, '') <> 'serial'
)
SELECT
  h.id AS holder_id,
  COALESCE(SUM(hu.units) FILTER (
    WHERE hu.held_since > NOW() - INTERVAL '7 days'
  ), 0) AS held_age_0_7,
  COALESCE(SUM(hu.units) FILTER (
    WHERE hu.held_since <= NOW() - INTERVAL '7 days'
      AND hu.held_since >  NOW() - INTERVAL '30 days'
  ), 0) AS held_age_8_30,
  COALESCE(SUM(hu.units) FILTER (
    WHERE hu.held_since <= NOW() - INTERVAL '30 days'
  ), 0) AS held_age_31_plus,
  MIN(hu.held_since) AS oldest_held_at,
  COALESCE(
    FLOOR(EXTRACT(EPOCH FROM (NOW() - MIN(hu.held_since))) / 86400)::int,
    0
  ) AS oldest_held_days
FROM stock_holders h
LEFT JOIN held_units hu ON hu.holder_id = h.id
GROUP BY h.id;

-- ── v_holder_project_breakdown ────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_holder_project_breakdown AS
SELECT
  s.holder_id,
  iss.project_id,
  pr.project_name,
  COUNT(*) AS held_count,
  COALESCE(SUM(si.standard_cost), 0) AS held_value
FROM stock_serials s
-- LEFT JOIN LATERAL (not inner): a held serial promoted outside the picking flow
-- has no issuing picking → iss.project_id is NULL → it rolls up under the NULL
-- ("Unassigned") group rather than vanishing from the breakdown.
LEFT JOIN LATERAL (
  SELECT p.project_id
  FROM stock_picking_lines pl
  JOIN stock_pickings p ON p.id = pl.picking_id
  WHERE pl.serial_ids @> ARRAY[s.id]::uuid[]
    AND p.picking_type = 'issue'
  ORDER BY p.created_at DESC
  LIMIT 1
) iss ON true
LEFT JOIN projects pr ON pr.id = iss.project_id
LEFT JOIN stock_items si ON si.id = s.stock_item_id
WHERE s.holder_id IS NOT NULL
  AND s.status = 'issued'
GROUP BY s.holder_id, iss.project_id, pr.project_name;

INSERT INTO migrations (version, name, executed_at)
VALUES ('409', 'field_stock_accountability_aging', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
