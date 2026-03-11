/**
 * Serial Validation Report
 */

import { log } from '@/lib/logger';
import { pool } from './_shared';
import type {
  SerialValidationReportResponse,
  SerialValidationRecord,
  SerialMatchStatus,
} from '../../types/reporting.types';

/**
 * Get serial validation report
 *
 * Compares ONT serials from WhatsApp/unified against OES
 * Flags mismatches where wrong ONT was installed
 */
export async function getSerialValidationReport(
  dateFrom: string,
  dateTo: string,
  project?: string,
  mismatchesOnly: boolean = false
): Promise<SerialValidationReportResponse> {
  try {
    log.info('Getting serial validation report', {
      dateFrom,
      dateTo,
      project,
      mismatchesOnly,
    }, 'ReportingService');

    const result = await pool.query(
      `
      SELECT
        upr.drop_number,
        upr.project,
        upr.ont_serial_scanned as ont_serial_wa,
        oes.serial_number as ont_serial_oes,
        CASE
          WHEN upr.ont_serial_scanned IS NULL AND oes.serial_number IS NULL THEN 'both_missing'
          WHEN upr.ont_serial_scanned IS NULL THEN 'missing_wa'
          WHEN oes.serial_number IS NULL THEN 'missing_oes'
          WHEN UPPER(TRIM(upr.ont_serial_scanned)) = UPPER(TRIM(oes.serial_number)) THEN 'match'
          ELSE 'mismatch'
        END as ont_match_status,
        upr.ups_serial_scanned as ups_serial_wa,
        (upr.ups_serial_scanned IS NOT NULL AND upr.ups_serial_scanned != '') as ups_serial_exists,
        upr.created_at as submitted_at,
        qpr.sender_phone as submitted_by
      FROM dr_photo_unified_reviews upr
      LEFT JOIN oes_activations oes ON upr.drop_number = oes.drop_number
      LEFT JOIN qa_photo_reviews qpr ON upr.drop_number = qpr.drop_number
      WHERE upr.created_at::DATE >= $1::DATE
        AND upr.created_at::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR upr.project = $3)
      ORDER BY upr.drop_number
      `,
      [dateFrom, dateTo, project || null]
    );

    // Map all records
    const allRecords: SerialValidationRecord[] = result.rows.map((row) => ({
      drop_number: row.drop_number,
      project: row.project,
      ont_serial_wa: row.ont_serial_wa,
      ont_serial_oes: row.ont_serial_oes,
      ont_match_status: row.ont_match_status as SerialMatchStatus,
      ups_serial_wa: row.ups_serial_wa,
      ups_serial_exists: row.ups_serial_exists === true,
      submitted_at: row.submitted_at
        ? new Date(row.submitted_at).toISOString()
        : null,
      submitted_by: row.submitted_by,
    }));

    // Filter mismatches
    const mismatches = allRecords.filter((r) => r.ont_match_status === 'mismatch');

    // Calculate summary
    const summary = {
      total_checked: allRecords.length,
      ont_matches: allRecords.filter((r) => r.ont_match_status === 'match').length,
      ont_mismatches: mismatches.length,
      ont_missing: allRecords.filter(
        (r) =>
          r.ont_match_status === 'missing_wa' ||
          r.ont_match_status === 'missing_oes' ||
          r.ont_match_status === 'both_missing'
      ).length,
      ups_present: allRecords.filter((r) => r.ups_serial_exists).length,
      ups_missing: allRecords.filter((r) => !r.ups_serial_exists).length,
    };

    return {
      date_range: { from: dateFrom, to: dateTo },
      summary,
      records: mismatchesOnly ? mismatches : allRecords,
      mismatches_only: mismatches,
    };
  } catch (error) {
    log.error('Failed to get serial validation report', {
      error,
    }, 'ReportingService');
    throw error;
  }
}
