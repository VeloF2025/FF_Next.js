-- Migration 410: field-stock accountability — issued-but-unaccounted exceptions view
-- (version = max(DB max 409, file max 409) + 1.)
--
-- Tier 3.1 of the Stores Accountability rollout. Adds ONE ADDITIVE read-only view
-- consumed by the Procurement → Field Stock → Exceptions tab. Nothing existing is
-- touched (lowest-risk extension shape). Also feeds the later auto-block (Tier 3.2)
-- and weekly WA digest (Tier 3.3) features.
--
--   v_holder_stock_exceptions — one row per HELD serial (a serial still attributed
--     to a field holder), classified by cross-checking the serial against OES and
--     WhatsApp activation evidence. This is the cross-SYSTEM check that
--     v_holder_accountability.unaccounted_count (a pure accounting identity:
--     issued − consumed − returned − held) does NOT perform.
--
-- ── Held set ────────────────────────────────────────────────────────────────
-- A "held" serial = stock_serials.holder_id IS NOT NULL AND status IN
-- ('issued','installed'). 'issued' is the normal in-field state (matches the
-- v_holder_held_aging / v_holder_project_breakdown held definition). 'installed'
-- is included defensively: if the install path ever fails to clear holder_id, the
-- serial is a custody-not-cleared exception we want to surface (today 0 such rows).
--
-- ── Age basis (mirrors migration 409) ───────────────────────────────────────
-- held_since = most-recent ISSUE picking that lists the serial, falling back to
-- stock_serials.created_at for serials promoted outside the picking flow.
--   stock_serials → stock_picking_lines (serial_ids @> ARRAY[serial.id])
--                 → stock_pickings (picking_type='issue', latest created_at)
--
-- ── Activation evidence (UPPER+TRIM serial join; documented gotcha) ──────────
-- WA  evidence: dr_photo_unified_reviews.ont_serial_scanned → its drop_number.
-- OES evidence: oes_activations.serial_number              → its drop_number.
-- Both joined via UPPER(TRIM(serial_number)) on BOTH sides (case/whitespace
-- variants exist — see functional indexes in migration 174). LATERAL ... LIMIT 1
-- keeps it one row per serial (neither source is unique on serial_number).
-- NOTE: OES/WA activation evidence is ONT-centric. UPS (Gizzu, GU18%) serials have
-- no activation source, so a held UPS surfaces as recent_/aged_no_evidence by item
-- type — item_code is exposed so a human distinguishes ONT from UPS.
--
-- ── Classification (most-specific first) ─────────────────────────────────────
--   cross_dr_conflict     — WA drop AND OES drop both present and DISAGREE
--                           (the serial_other_dr pattern: serial activated under a
--                           different DR than where it was WhatsApp-scanned).
--   installed_not_cleared — has WA or OES evidence but is STILL held (should have
--                           been consumed/cleared from the holder).
--   aged_no_evidence      — held 30+ days with NO activation evidence anywhere
--                           (genuine loss / recovery candidate; feeds auto-block).
--   recent_no_evidence    — held <30 days, no evidence (normal in-field; the API
--                           excludes this from the default exceptions list).
-- The 30-day boundary mirrors the v_holder_held_aging 31_plus bucket
-- (held_since <= NOW() - INTERVAL '30 days').

BEGIN;

CREATE OR REPLACE VIEW v_holder_stock_exceptions AS
WITH held AS (
  SELECT
    s.id            AS serial_id,
    s.serial_number,
    s.status,
    s.holder_id,
    s.stock_item_id,
    s.created_at    AS serial_created_at
  FROM stock_serials s
  WHERE s.holder_id IS NOT NULL
    AND s.status IN ('issued', 'installed')
),
enriched AS (
  SELECT
    h.serial_id,
    h.serial_number,
    h.status,
    h.holder_id,
    h.stock_item_id,
    -- Age basis: most-recent issue picking (project + held_since), else serial age.
    COALESCE(iss.picking_created_at, h.serial_created_at) AS held_since,
    iss.project_id,
    -- WA activation evidence (one row per serial)
    wa.drop_number  AS wa_drop,
    -- OES activation evidence (one row per serial)
    oes.drop_number      AS oes_drop,
    oes.status           AS oes_status,
    oes.activation_date  AS oes_activation_date
  FROM held h
  LEFT JOIN LATERAL (
    SELECT p.created_at AS picking_created_at, p.project_id
    FROM stock_picking_lines pl
    JOIN stock_pickings p ON p.id = pl.picking_id
    WHERE pl.serial_ids @> ARRAY[h.serial_id]::uuid[]
      AND p.picking_type = 'issue'
    ORDER BY p.created_at DESC
    LIMIT 1
  ) iss ON true
  LEFT JOIN LATERAL (
    SELECT dr.drop_number
    FROM dr_photo_unified_reviews dr
    WHERE UPPER(TRIM(dr.ont_serial_scanned)) = UPPER(TRIM(h.serial_number))
    ORDER BY dr.updated_at DESC NULLS LAST
    LIMIT 1
  ) wa ON true
  LEFT JOIN LATERAL (
    -- A serial can appear under multiple drops via swaps (oes_activations is NOT
    -- unique on serial_number). Pick the most-recent ACTIVATION — activation_date
    -- is the authoritative recency signal; created_at (ingest time) only breaks
    -- ties — so cross_dr_conflict compares against the current activation, not a
    -- stale backfilled row.
    SELECT oa.drop_number, oa.status, oa.activation_date
    FROM oes_activations oa
    WHERE UPPER(TRIM(oa.serial_number)) = UPPER(TRIM(h.serial_number))
    ORDER BY oa.activation_date DESC NULLS LAST, oa.created_at DESC NULLS LAST
    LIMIT 1
  ) oes ON true
)
SELECT
  e.serial_id,
  e.serial_number,
  e.status,
  e.holder_id,
  hd.holder_type,
  hd.name              AS holder_name,
  e.stock_item_id,
  si.item_code,
  si.name              AS item_name,
  e.project_id,
  pr.project_name,
  e.held_since,
  FLOOR(EXTRACT(EPOCH FROM (NOW() - e.held_since)) / 86400)::int AS held_days,
  e.wa_drop,
  e.oes_drop,
  e.oes_status,
  e.oes_activation_date,
  CASE
    WHEN e.wa_drop IS NOT NULL AND e.oes_drop IS NOT NULL
         AND UPPER(TRIM(e.wa_drop)) <> UPPER(TRIM(e.oes_drop))
      THEN 'cross_dr_conflict'
    WHEN e.wa_drop IS NOT NULL OR e.oes_drop IS NOT NULL
      THEN 'installed_not_cleared'
    WHEN e.held_since <= NOW() - INTERVAL '30 days'
      THEN 'aged_no_evidence'
    ELSE 'recent_no_evidence'
  END AS exception_class
FROM enriched e
-- INNER JOIN is safe: stock_serials.holder_id has FK stock_serials_holder_id_fkey
-- → stock_holders(id), so a held serial can never reference a missing holder (0
-- orphans confirmed). No held row is silently dropped here.
JOIN stock_holders hd ON hd.id = e.holder_id
LEFT JOIN stock_items si ON si.id = e.stock_item_id
LEFT JOIN projects pr ON pr.id = e.project_id;

INSERT INTO migrations (version, name, executed_at)
VALUES ('410', 'field_stock_stock_exceptions', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
