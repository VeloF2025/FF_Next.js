/**
 * Note-aware + temporal candidate query for the FT expected-recovery loop (rec #2).
 *
 * A recovery candidate is a DR that is STILL tagged deducted on oes_activations and
 * whose deduction cause was fixed AFTER the deduction week. The fix signal must match
 * the deduction note's actual semantics (see classifyDeductionVerdict.ts):
 *   note4 (drop#/serial mismatch on OLT) → olt_mismatch_records resolved after  → onemap_fix
 *   note5 (offline / fiber break)        → offline_devices.recovered_at after     → offline_recovery
 *   note2 (no entry on Field App)        → oes_pp_data activated after            → pp_activation
 *
 * note2 is deliberately NOT qualified by the 1Map serial-mismatch (onemap) signal:
 * a serial fix does not clear a "no field-app entry" deduction (the two causes are
 * unrelated), so onemap covers note4 ONLY. Temporal guard verified live 2026-06-13:
 * 403 candidates; without it a naive "ever fixed" filter matched 1079/1111 (useless).
 *
 * Anchored on ft_billing_deductions.project (FT's own label — robust to project-name
 * variants) and the latest deduction per DR; the rec #3 ledger is joined by
 * drop_number only for the 1Map resolved timestamp. oes_activations.drop_number is
 * UNIQUE (oes_activations_drop_number_key), so the join cannot fan out. The
 * DISTINCT ON carries a deduction_note tiebreak so the chosen note is deterministic
 * when a DR has several notes in its latest deduction week.
 *
 * Param: $1 = project (ft_billing_deductions.project).
 */
export const CANDIDATE_SQL = `
  WITH latest_ded AS (
    SELECT DISTINCT ON (dr_number) dr_number, deduction_note, week_ending
    FROM ft_billing_deductions
    WHERE project = $1 AND dr_number IS NOT NULL
    ORDER BY dr_number, week_ending DESC, deduction_note
  )
  SELECT
    ld.dr_number AS drop_number,
    ld.deduction_note,
    ld.week_ending::text AS deduction_week_ending,
    CASE
      WHEN ld.deduction_note = 'note4' AND l.onemap_mismatch_resolved_at::date > ld.week_ending THEN 'onemap_fix'
      WHEN ld.deduction_note = 'note5' AND ofr.recovered_at IS NOT NULL THEN 'offline_recovery'
      WHEN ld.deduction_note = 'note2' AND ppr.activated_at IS NOT NULL THEN 'pp_activation'
    END AS fix_signal,
    CASE
      WHEN ld.deduction_note = 'note4' AND l.onemap_mismatch_resolved_at::date > ld.week_ending THEN l.onemap_mismatch_resolved_at::text
      WHEN ld.deduction_note = 'note5' AND ofr.recovered_at IS NOT NULL THEN ofr.recovered_at::text
      WHEN ld.deduction_note = 'note2' AND ppr.activated_at IS NOT NULL THEN ppr.activated_at::text
    END AS fix_at
  FROM latest_ded ld
  JOIN oes_activations oa ON oa.drop_number = ld.dr_number AND oa.payment_status = 'deducted'
  LEFT JOIN v_dr_reconciliation_ledger l ON l.drop_number = ld.dr_number
  LEFT JOIN LATERAL (
    SELECT max(od.recovered_at) AS recovered_at FROM offline_devices od
    WHERE od.drop_number = ld.dr_number AND od.recovered_at > ld.week_ending
  ) ofr ON true
  LEFT JOIN LATERAL (
    SELECT max(pp.activated_at) AS activated_at FROM oes_pp_data pp
    WHERE pp.resolved_drop_number = ld.dr_number AND pp.activated_at::date > ld.week_ending
  ) ppr ON true
  WHERE (ld.deduction_note = 'note4' AND l.onemap_mismatch_resolved_at::date > ld.week_ending)
     OR (ld.deduction_note = 'note5' AND ofr.recovered_at IS NOT NULL)
     OR (ld.deduction_note = 'note2' AND ppr.activated_at IS NOT NULL)`;

export interface CandidateRow {
  drop_number: string;
  deduction_note: string;
  deduction_week_ending: string;
  fix_signal: string;
  fix_at: string | null;
}
