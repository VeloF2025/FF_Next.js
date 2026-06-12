-- Migration 414: per-DR three-way reconciliation ledger view
-- (version = max(DB max 412, file max 413) + 1.)
--
-- Audit rec #3 (activations-pipeline-logic-audit-2026-06-10). Adds ONE ADDITIVE
-- read-only view that, for the first time, puts the WA-scanned / OES / 1Map / drops
-- serials, the lifecycle status, and the payment/deduction status side-by-side on a
-- SINGLE row per DR, and classifies the three-way conflicts explicitly. Today the
-- only comparisons are pairwise and live in different tabs (WA↔OES nightly report,
-- OES↔1Map OLT investigate, WA↔1Map only at ACK time) — a unit where the three
-- sources hold three different serials is never detected as one conflict.
--
-- Nothing existing is touched (lowest-risk extension shape). This view is the
-- foundation for the remaining audit recs: #2 expected-recovery wiring, #4 unified
-- OLT classifier, #5 actionable nightly worklist.
--
--   v_dr_reconciliation_ledger — one row per DR (drop_number).
--
-- ── Spine (EXTENDS, does not duplicate, v_dr_installation_status) ─────────────
-- v_dr_installation_status is itself spined on dr_photo_unified_reviews (one row
-- per DR, UNIQUE on drop_number). Coverage was verified against the live DB on
-- 2026-06-12: every drop_number present in oes_activations / ft_billing_deductions
-- / olt_mismatch_records ALSO exists in dr_photo_unified_reviews (0 orphans), so no
-- deducted / OES-only / mismatch DR is invisible by spining here. We reuse the base
-- view's installation-status logic (activation_status / overall_status) and join
-- back to dr_photo_unified_reviews (1:1) only for the raw serial columns it does
-- not expose — this keeps the install-status logic single-sourced.
--
-- ── Join keys (raw drop_number; index-friendly) ──────────────────────────────
-- drop_number is verified clean (UPPER(TRIM(x)) = x for 100% of rows) in the spine
-- and in every child EXCEPT a handful of SOW dupes in drops (~100/180k). All child
-- tables carry a btree index on the raw drop_number, so we join raw `=` and hit the
-- index. (UPPER+TRIM normalisation is reserved for SERIAL values below, where dirty
-- variants do exist.) oes_activations and drops are UNIQUE on drop_number → safe
-- LEFT JOIN. olt_mismatch_records (1767 rows / 1717 DRs) and ft_billing_deductions
-- (5625 rows / 1250 DRs) are multi-row per DR → LATERAL ... LIMIT 1 by recency.
--
-- ── Serial comparison (UPPER+TRIM, empty→NULL) ───────────────────────────────
-- The three audited legs are WA-scanned (dr_photo_unified_reviews.ont_serial_scanned),
-- OES (oes_activations.serial_number, the network truth) and 1Map
-- (dr_photo_unified_reviews.onemap_ont_serial, the serial fetched from 1Map at
-- intake — 80% populated, far better per-DR coverage than the 1.7k mismatch log).
-- drops.ont_serial is surfaced as a fourth (our internal SOW/drops record).
-- A conflict = ≥2 DISTINCT serial-shaped values across the four.
-- SHAPE NORMALISER: each leg counts only if UPPER(TRIM(x)) matches ^[A-Z0-9]{6,}$.
-- Several sources store the raw DataMatrix/ISO-15434 envelope ('[)>…\x1DS<serial>…')
-- or '-' placeholders instead of the parsed serial; without this filter those read
-- as bogus distinct serials and falsely trip serial_other_dr (e.g. a DR whose WA,
-- OES and drops serials all agree but whose onemap snapshot holds the envelope).
-- STALE-SNAPSHOT GUARD: onemap_ont_serial is a point-in-time intake snapshot. Once
-- its olt_mismatch_records row is fixed/resolved, 1Map was corrected but the snapshot
-- is not refreshed, so it would falsely read as a conflict. We therefore drop the
-- 1Map leg from the conflict count when onemap_fix_status IN ('fixed','resolved').
-- The raw onemap_serial is still surfaced unchanged for transparency.
--
-- ── recon_class (most-specific first, ELSE-safe) ─────────────────────────────
--   serial_other_dr     — serials disagree across sources (distinct_serial_count>1)
--                         OR the 1Map record is explicitly flagged serial_other_dr.
--   wa_no_oes           — a genuine WA field submission exists but no OES activation
--                         (submitted, never activated). "Genuine" = wa_received_at /
--                         submitted_date / whatsapp_submitted_at present (bare
--                         OES-only unified rows do NOT count — same rule the
--                         deduction verifier uses for FT Note 2).
--   oes_no_1map         — activated on OES but the 1Map reconciliation is OPEN
--                         (fix_status not_found / empty_serial / pending /
--                         needs_(re)investigation / escalated). The note-2 root cause.
--   deducted_but_active — FT deducted the DR yet OES shows it Active and 1Map is fine
--                         and serials agree: a pure dispute candidate (money conflict).
--   all_agree           — activated, serials agree, 1Map clean (null/fixed/resolved),
--                         no deduction-vs-active conflict.
--   no_evidence         — ELSE (e.g. INVALID_DR, bare row with neither OES nor a
--                         genuine WA submission).
--
-- Offline context (is_offline / offline_since) is taken free from the drops join;
-- the heavy offline_devices snapshot table (479k rows, empty snapshot_timestamp) is
-- intentionally NOT joined here — audit rec #2 will add its recovered_at when built.

BEGIN;

CREATE OR REPLACE VIEW v_dr_reconciliation_ledger AS
WITH ledger AS (
  SELECT
    base.drop_number,
    r.project,

    -- raw serials (display, unchanged from source)
    r.ont_serial_scanned                              AS wa_serial,
    oa.serial_number                                  AS oes_serial,
    dp.ont_serial                                     AS drops_serial,
    r.onemap_ont_serial                               AS onemap_serial,

    -- normalised serials for comparison. Keep ONLY serial-shaped values
    -- (^[A-Z0-9]{6,}$) so raw DataMatrix/ISO-15434 envelopes ('[)>…\x1DS<serial>\x1D…',
    -- present in both onemap_ont_serial and ont_serial_scanned for Nokia scans),
    -- '-' placeholders and garbage scans drop to NULL instead of registering as a
    -- bogus distinct serial. Measured 2026-06-12: this rejects the 103 onemap
    -- envelopes + placeholders and loses ~0 real serials (1 hyphenated drops value).
    CASE WHEN UPPER(TRIM(r.ont_serial_scanned)) ~ '^[A-Z0-9]{6,}$'
         THEN UPPER(TRIM(r.ont_serial_scanned)) END   AS wa_serial_n,
    CASE WHEN UPPER(TRIM(oa.serial_number)) ~ '^[A-Z0-9]{6,}$'
         THEN UPPER(TRIM(oa.serial_number)) END       AS oes_serial_n,
    CASE WHEN UPPER(TRIM(dp.ont_serial)) ~ '^[A-Z0-9]{6,}$'
         THEN UPPER(TRIM(dp.ont_serial)) END          AS drops_serial_n,
    -- 1Map leg: ALSO dropped from the conflict count once its mismatch was
    -- fixed/resolved (the intake snapshot goes stale after 1Map is corrected).
    CASE WHEN om.fix_status IN ('fixed', 'resolved') THEN NULL
         WHEN UPPER(TRIM(r.onemap_ont_serial)) ~ '^[A-Z0-9]{6,}$'
         THEN UPPER(TRIM(r.onemap_ont_serial)) END    AS onemap_serial_cmp_n,

    -- lifecycle
    base.wa_submitted_at,
    (r.wa_received_at IS NOT NULL
       OR r.submitted_date IS NOT NULL
       OR r.whatsapp_submitted_at IS NOT NULL)        AS has_wa_submission,
    base.activation_status,
    base.overall_status,
    base.vlm_categorization_status,
    r.serial_verification_status,
    oa.status                                         AS oes_status,
    COALESCE(oa.activation_datetime, oa.activation_date::timestamptz) AS oes_activated_at,
    oa.ont_rx_sig_dbm,
    (oa.drop_number IS NOT NULL)                      AS has_oes_activation,

    -- payment / deduction
    oa.payment_status,
    oa.payment_week,
    oa.payment_note,
    ded.week_ending                                   AS latest_deduction_week,
    ded.deduction_note                                AS latest_deduction_note,
    ded.verdict                                       AS deduction_verdict,
    ded.resolution_status                             AS deduction_resolution_status,
    ded.dispute_outcome                               AS deduction_dispute_outcome,

    -- 1Map mismatch lifecycle
    om.fix_status                                     AS onemap_fix_status,
    om.wrong_onemap_serial,
    om.olt_serial                                     AS onemap_correct_serial,
    om.onemap_source,
    om.maintenance_ticket_id                          AS onemap_mismatch_ticket_id,
    om.resolved_at                                    AS onemap_mismatch_resolved_at,

    -- offline / billing context (free from the drops join)
    dp.is_offline,
    dp.offline_since,
    dp.invoiced
  FROM v_dr_installation_status base
  LEFT JOIN dr_photo_unified_reviews r ON r.drop_number = base.drop_number
  LEFT JOIN oes_activations oa         ON oa.drop_number = base.drop_number
  LEFT JOIN drops dp                   ON dp.drop_number = base.drop_number
  LEFT JOIN LATERAL (
    SELECT m.fix_status, m.wrong_onemap_serial, m.olt_serial, m.onemap_source,
           m.maintenance_ticket_id, m.resolved_at
    FROM olt_mismatch_records m
    WHERE m.drop_number = base.drop_number
    ORDER BY m.created_at DESC NULLS LAST
    LIMIT 1
  ) om ON true
  LEFT JOIN LATERAL (
    SELECT d.week_ending, d.deduction_note, d.verdict, d.resolution_status, d.dispute_outcome
    FROM ft_billing_deductions d
    WHERE d.dr_number = base.drop_number
    ORDER BY d.week_ending DESC NULLS LAST, d.created_at DESC NULLS LAST
    LIMIT 1
  ) ded ON true
),
classified AS (
  SELECT
    l.*,
    ( SELECT count(DISTINCT s)
      FROM unnest(ARRAY[l.wa_serial_n, l.oes_serial_n, l.drops_serial_n, l.onemap_serial_cmp_n]) AS s
      WHERE s IS NOT NULL
    )::int AS distinct_serial_count
  FROM ledger l
)
SELECT
  c.drop_number,
  c.project,

  -- serials side-by-side (raw)
  c.wa_serial,
  c.oes_serial,
  c.onemap_serial,
  c.drops_serial,
  c.distinct_serial_count,

  -- lifecycle
  c.wa_submitted_at,
  c.has_wa_submission,
  c.has_oes_activation,
  c.activation_status,
  c.overall_status,
  c.oes_status,
  c.oes_activated_at,
  c.vlm_categorization_status,
  c.serial_verification_status,
  c.ont_rx_sig_dbm,

  -- payment / deduction
  c.payment_status,
  c.payment_week,
  c.payment_note,
  c.latest_deduction_week,
  c.latest_deduction_note,
  c.deduction_verdict,
  c.deduction_resolution_status,
  c.deduction_dispute_outcome,

  -- 1Map mismatch lifecycle
  c.onemap_fix_status,
  c.wrong_onemap_serial,
  c.onemap_correct_serial,
  c.onemap_source,
  c.onemap_mismatch_ticket_id,
  c.onemap_mismatch_resolved_at,

  -- offline / billing context
  c.is_offline,
  c.offline_since,
  c.invoiced,

  -- three-way classification (most-specific first, ELSE-safe)
  CASE
    WHEN c.distinct_serial_count > 1
         OR c.onemap_fix_status = 'serial_other_dr'
      THEN 'serial_other_dr'
    WHEN c.has_wa_submission AND NOT c.has_oes_activation
      THEN 'wa_no_oes'
    WHEN c.has_oes_activation
         AND c.onemap_fix_status IN ('not_found', 'empty_serial', 'pending',
                                     'needs_investigation', 'needs_reinvestigation', 'escalated')
      THEN 'oes_no_1map'
    WHEN c.has_oes_activation
         AND c.payment_status = 'deducted'
         AND c.oes_status = 'Active'
      THEN 'deducted_but_active'
    WHEN c.has_oes_activation
         AND c.distinct_serial_count <= 1
         AND (c.onemap_fix_status IS NULL OR c.onemap_fix_status IN ('fixed', 'resolved'))
      THEN 'all_agree'
    ELSE 'no_evidence'
  END AS recon_class
FROM classified c;

COMMENT ON VIEW v_dr_reconciliation_ledger IS
  'Audit rec #3: per-DR three-way (WA/OES/1Map/drops) serial + lifecycle + payment '
  'reconciliation ledger. Additive read-only. recon_class classifies conflicts. '
  'See scripts/migrations/sql/414_dr_reconciliation_ledger_view.sql.';

INSERT INTO migrations (version, name, executed_at)
VALUES ('414', 'dr_reconciliation_ledger_view', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
