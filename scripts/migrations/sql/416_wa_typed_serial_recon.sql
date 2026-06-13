-- Migration 416: feed TYPED WhatsApp serials into the three-way recon (audit rec #5, part A)
-- (version = max(DB 415, file 415) + 1.)
--
-- Until now a serial only reached v_dr_reconciliation_ledger's WA leg via the photo
-- SCAN (dr_photo_unified_reviews.ont_serial_scanned) or the 1Map intake snapshot
-- (onemap_ont_serial). A serial a technician merely TYPES into the activation message
-- — e.g. "DR1747382 S/N:ALCLB48E394B 5245 Simelane street" — was stored verbatim in
-- wa_original_text but never parsed into a column the recon reads, so recon saw NO WA
-- serial for that DR (measured live 2026-06-13: 22 such DRs, scanned IS NULL yet a
-- parseable ONT serial sits in wa_original_text). This migration:
--   1. adds three ADDITIVE nullable columns to dr_photo_unified_reviews to hold the
--      parsed typed serials (populated out-of-band by the extract-wa-typed-serials cron
--      via waTypedSerialExtractor.ts — never in this migration / never a trigger), and
--   2. extends v_dr_reconciliation_ledger so the WA leg FALLS BACK to the typed serial
--      when no photo scan exists.
--
-- WA-leg semantics change (the only behavioural change): `wa_serial` was the raw
-- ont_serial_scanned; it is now the first serial-SHAPED value among scanned → typed
-- (same ^[A-Z0-9]{6,}$ shape filter the other legs use). Two new columns expose the
-- provenance: `wa_typed_serial` (the raw typed value, surfaced even when a scan also
-- exists so a scan≠typed disagreement stays visible to a human) and `wa_serial_source`
-- ('scanned' | 'typed' | NULL). The typed value is used ONLY as a fallback (scanned
-- wins when present), so a tech's typo can never silently overwrite a real scan nor
-- manufacture a scanned-vs-typed serial_other_dr. distinct_serial_count counts the
-- fallback value, so for the 22 gap rows the WA leg now participates in recon
-- (agreement → all_agree confirmation; disagreement with OES → serial_other_dr).
--
-- Everything else is byte-for-byte the migration-414 view (spine, joins, the other
-- three legs, the stale-1Map-snapshot guard, recon_class). Additive + CREATE OR
-- REPLACE only — no existing column is renamed or retyped, so all existing consumers
-- (pages/api/system/olt-report/ledger.ts, recoveryCandidatesSql.ts, the OLT Ledger tab)
-- keep working; the gated live-DB integration test recomputes its conflict from the
-- view's own `wa_serial`, so folding the typed fallback into `wa_serial` keeps it green.

BEGIN;

-- 1. Parsed typed-serial columns + a processing marker (NULL = not yet scanned by the
--    cron; lets the cron self-backfill once then only touch new rows). IF NOT EXISTS so
--    a re-run on a partially-provisioned DB is a no-op.
ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS wa_typed_ont_serial        varchar,
  ADD COLUMN IF NOT EXISTS wa_typed_ups_serial        varchar,
  ADD COLUMN IF NOT EXISTS wa_typed_serial_extracted_at timestamptz;

COMMENT ON COLUMN dr_photo_unified_reviews.wa_typed_ont_serial IS
  'ONT serial parsed from wa_original_text by waTypedSerialExtractor (audit rec #5). '
  'Fallback WA leg for v_dr_reconciliation_ledger when ont_serial_scanned is absent.';
COMMENT ON COLUMN dr_photo_unified_reviews.wa_typed_ups_serial IS
  'UPS (Gizzu) serial parsed from wa_original_text (audit rec #5). Captured for parity; '
  'not yet compared in the ledger (recon is ONT-only).';
COMMENT ON COLUMN dr_photo_unified_reviews.wa_typed_serial_extracted_at IS
  'When the typed-serial extractor last processed this row''s wa_original_text. '
  'NULL = not yet processed; set even when no serial was found (idempotent marker).';

-- 2. Recon view — 414 body with the WA leg falling back to the typed serial.
--    DROP+CREATE (not CREATE OR REPLACE): the WA leg's type changes (varchar→text via
--    UPPER/TRIM) and two columns are inserted mid-list, both of which CREATE OR REPLACE
--    forbids. Verified 2026-06-13: nothing depends on this view (no dependent views/rules),
--    so the DROP is safe.
DROP VIEW IF EXISTS v_dr_reconciliation_ledger;
CREATE VIEW v_dr_reconciliation_ledger AS
WITH ledger AS (
  SELECT
    base.drop_number,
    r.project,

    -- raw serials (display). oes/drops/onemap unchanged from 414. WA leg: first
    -- serial-SHAPED value among scanned → typed (rec #5). Keeping `wa_serial` as the
    -- value recon actually used (not the raw scan) keeps every consumer + the gated
    -- integration test consistent with distinct_serial_count below.
    COALESCE(
      CASE WHEN UPPER(TRIM(r.ont_serial_scanned)) ~ '^[A-Z0-9]{6,}$'
           THEN UPPER(TRIM(r.ont_serial_scanned)) END,
      CASE WHEN UPPER(TRIM(r.wa_typed_ont_serial)) ~ '^[A-Z0-9]{6,}$'
           THEN UPPER(TRIM(r.wa_typed_ont_serial)) END
    )                                                 AS wa_serial,
    -- the raw typed value, surfaced even when a scan also exists so scan≠typed is visible
    r.wa_typed_ont_serial                             AS wa_typed_serial,
    CASE
      WHEN UPPER(TRIM(r.ont_serial_scanned)) ~ '^[A-Z0-9]{6,}$' THEN 'scanned'
      WHEN UPPER(TRIM(r.wa_typed_ont_serial)) ~ '^[A-Z0-9]{6,}$' THEN 'typed'
      ELSE NULL
    END                                               AS wa_serial_source,
    oa.serial_number                                  AS oes_serial,
    dp.ont_serial                                     AS drops_serial,
    r.onemap_ont_serial                               AS onemap_serial,

    -- normalised serials for comparison. WA leg mirrors the raw `wa_serial` above
    -- (scanned-shaped → typed-shaped fallback). The other three legs are identical to
    -- migration 414: keep ONLY serial-shaped values (^[A-Z0-9]{6,}$) so raw
    -- DataMatrix/ISO-15434 envelopes, '-' placeholders and garbage scans drop to NULL
    -- instead of registering as a bogus distinct serial.
    COALESCE(
      CASE WHEN UPPER(TRIM(r.ont_serial_scanned)) ~ '^[A-Z0-9]{6,}$'
           THEN UPPER(TRIM(r.ont_serial_scanned)) END,
      CASE WHEN UPPER(TRIM(r.wa_typed_ont_serial)) ~ '^[A-Z0-9]{6,}$'
           THEN UPPER(TRIM(r.wa_typed_ont_serial)) END
    )                                                 AS wa_serial_n,
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
    ORDER BY m.created_at DESC NULLS LAST, m.id DESC
    LIMIT 1
  ) om ON true
  LEFT JOIN LATERAL (
    SELECT d.week_ending, d.deduction_note, d.verdict, d.resolution_status, d.dispute_outcome
    FROM ft_billing_deductions d
    WHERE d.dr_number = base.drop_number
    ORDER BY d.week_ending DESC NULLS LAST, d.created_at DESC NULLS LAST, d.id DESC
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
  c.wa_typed_serial,
  c.wa_serial_source,
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

  -- three-way classification (most-specific first, ELSE-safe) — unchanged from 414
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
  'Audit rec #3 + #5: per-DR three-way (WA/OES/1Map/drops) serial + lifecycle + payment '
  'reconciliation ledger. WA leg = scanned serial, falling back to the TYPED serial '
  '(wa_typed_serial) when no scan exists (rec #5). Additive read-only. recon_class '
  'classifies conflicts. See scripts/migrations/sql/416_wa_typed_serial_recon.sql.';

INSERT INTO migrations (version, name, executed_at)
VALUES ('416', 'wa_typed_serial_recon', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
