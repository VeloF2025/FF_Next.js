-- Rollback for migration 416 (audit rec #5, part A).
-- Restores v_dr_reconciliation_ledger to its byte-for-byte migration-414 definition
-- (WA leg = raw ont_serial_scanned, no typed fallback), THEN drops the three columns
-- added by 416. Order matters: the view must stop referencing the typed columns before
-- they can be dropped.

BEGIN;

-- 1. Restore the migration-414 view (no typed-serial leg). DROP+CREATE because 416's
--    view carries two extra columns CREATE OR REPLACE cannot remove.
DROP VIEW IF EXISTS v_dr_reconciliation_ledger;
CREATE VIEW v_dr_reconciliation_ledger AS
WITH ledger AS (
  SELECT
    base.drop_number,
    r.project,
    r.ont_serial_scanned                              AS wa_serial,
    oa.serial_number                                  AS oes_serial,
    dp.ont_serial                                     AS drops_serial,
    r.onemap_ont_serial                               AS onemap_serial,
    CASE WHEN UPPER(TRIM(r.ont_serial_scanned)) ~ '^[A-Z0-9]{6,}$'
         THEN UPPER(TRIM(r.ont_serial_scanned)) END   AS wa_serial_n,
    CASE WHEN UPPER(TRIM(oa.serial_number)) ~ '^[A-Z0-9]{6,}$'
         THEN UPPER(TRIM(oa.serial_number)) END       AS oes_serial_n,
    CASE WHEN UPPER(TRIM(dp.ont_serial)) ~ '^[A-Z0-9]{6,}$'
         THEN UPPER(TRIM(dp.ont_serial)) END          AS drops_serial_n,
    CASE WHEN om.fix_status IN ('fixed', 'resolved') THEN NULL
         WHEN UPPER(TRIM(r.onemap_ont_serial)) ~ '^[A-Z0-9]{6,}$'
         THEN UPPER(TRIM(r.onemap_ont_serial)) END    AS onemap_serial_cmp_n,
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
    oa.payment_status,
    oa.payment_week,
    oa.payment_note,
    ded.week_ending                                   AS latest_deduction_week,
    ded.deduction_note                                AS latest_deduction_note,
    ded.verdict                                       AS deduction_verdict,
    ded.resolution_status                             AS deduction_resolution_status,
    ded.dispute_outcome                               AS deduction_dispute_outcome,
    om.fix_status                                     AS onemap_fix_status,
    om.wrong_onemap_serial,
    om.olt_serial                                     AS onemap_correct_serial,
    om.onemap_source,
    om.maintenance_ticket_id                          AS onemap_mismatch_ticket_id,
    om.resolved_at                                    AS onemap_mismatch_resolved_at,
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
  c.wa_serial,
  c.oes_serial,
  c.onemap_serial,
  c.drops_serial,
  c.distinct_serial_count,
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
  c.payment_status,
  c.payment_week,
  c.payment_note,
  c.latest_deduction_week,
  c.latest_deduction_note,
  c.deduction_verdict,
  c.deduction_resolution_status,
  c.deduction_dispute_outcome,
  c.onemap_fix_status,
  c.wrong_onemap_serial,
  c.onemap_correct_serial,
  c.onemap_source,
  c.onemap_mismatch_ticket_id,
  c.onemap_mismatch_resolved_at,
  c.is_offline,
  c.offline_since,
  c.invoiced,
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

-- 2. Drop the typed-serial columns (now unreferenced by the view).
ALTER TABLE dr_photo_unified_reviews
  DROP COLUMN IF EXISTS wa_typed_ont_serial,
  DROP COLUMN IF EXISTS wa_typed_ups_serial,
  DROP COLUMN IF EXISTS wa_typed_serial_extracted_at;

DELETE FROM migrations WHERE version = '416';

COMMIT;
