/**
 * EOD Reconciliation Service
 * 3-way reconciliation: EOD sheets ↔ WhatsApp DRs ↔ OES Activations
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import type { EodReconciliationRow, EodReconciliationSummary } from '../types';

const sql = neon(process.env.DATABASE_URL!);

interface ReconciliationResult {
  rows: EodReconciliationRow[];
  summary: EodReconciliationSummary;
}

/**
 * Run 3-way reconciliation for a given date.
 * EOD entries from that date, WA DRs from that date, OES activations from date+1.
 */
export async function getReconciliation(date: string): Promise<ReconciliationResult> {
  const startTime = Date.now();

  const rows = await sql`
    WITH eod AS (
      SELECT e.id as eod_entry_id, e.dr_number, e.ont_serial, e.gizzu_serial,
             e.pon_number, e.address, s.technician_name
      FROM eod_install_sheet_entries e
      JOIN eod_install_sheets s ON e.sheet_id = s.id
      WHERE s.sheet_date = ${date}
    ),
    wa AS (
      SELECT id as wa_dr_id, drop_number, ont_serial_scanned, ups_serial_scanned
      FROM dr_photo_unified_reviews
      WHERE COALESCE(submitted_date, created_at::DATE) = ${date}::DATE
    ),
    oes AS (
      SELECT id as oes_id, drop_number as oes_drop, serial_number as oes_serial,
             activation_date
      FROM oes_activations
      WHERE activation_date = (${date}::DATE + INTERVAL '1 day')::DATE
    )
    SELECT
      COALESCE(eod.dr_number, wa.drop_number, oes.oes_drop) as dr_number,
      COALESCE(eod.ont_serial, wa.ont_serial_scanned, oes.oes_serial) as ont_serial,
      eod.eod_entry_id,
      eod.gizzu_serial,
      eod.pon_number,
      eod.address,
      wa.wa_dr_id,
      wa.ont_serial_scanned as wa_ont_serial,
      oes.oes_id,
      oes.oes_serial,
      oes.activation_date::text as activation_date,
      CASE
        WHEN eod.eod_entry_id IS NOT NULL AND wa.wa_dr_id IS NOT NULL AND oes.oes_id IS NOT NULL THEN 'matched_all'
        WHEN eod.eod_entry_id IS NOT NULL AND wa.wa_dr_id IS NOT NULL AND oes.oes_id IS NULL THEN 'not_activated'
        WHEN eod.eod_entry_id IS NOT NULL AND wa.wa_dr_id IS NULL THEN 'missing_wa'
        WHEN eod.eod_entry_id IS NULL AND wa.wa_dr_id IS NOT NULL THEN 'missing_eod'
        WHEN eod.eod_entry_id IS NOT NULL AND wa.wa_dr_id IS NULL AND oes.oes_id IS NOT NULL THEN 'partial_match'
        ELSE 'pending'
      END as match_status
    FROM eod
    FULL OUTER JOIN wa ON eod.dr_number = wa.drop_number
    FULL OUTER JOIN oes ON COALESCE(eod.dr_number, wa.drop_number) = oes.oes_drop
    ORDER BY dr_number NULLS LAST
  `;

  const typedRows = rows as EodReconciliationRow[];

  // Compute summary
  const summary: EodReconciliationSummary = {
    total_eod: typedRows.filter((r) => r.eod_entry_id).length,
    matched_wa: typedRows.filter((r) => r.eod_entry_id && r.wa_dr_id).length,
    matched_oes: typedRows.filter((r) => r.eod_entry_id && r.oes_id).length,
    matched_all: typedRows.filter((r) => r.match_status === 'matched_all').length,
    discrepancies: typedRows.filter(
      (r) => r.match_status !== 'matched_all' && r.match_status !== 'pending'
    ).length,
  };

  log.info('[EOD-Recon] Reconciliation complete', {
    date,
    rows: typedRows.length,
    summary,
    processingTimeMs: Date.now() - startTime,
  });

  return { rows: typedRows, summary };
}

/**
 * Update match status for EOD entries after reconciliation
 */
export async function updateEntryMatchStatuses(
  entries: { id: string; matchStatus: string; matchedDrId?: string; matchedOesId?: string }[]
): Promise<void> {
  for (const entry of entries) {
    await sql`
      UPDATE eod_install_sheet_entries
      SET match_status = ${entry.matchStatus},
          matched_dr_id = ${entry.matchedDrId || null},
          matched_oes_id = ${entry.matchedOesId || null}
      WHERE id = ${entry.id}
    `;
  }
}
