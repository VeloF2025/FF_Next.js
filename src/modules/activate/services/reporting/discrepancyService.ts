/**
 * Discrepancy Report (WhatsApp vs OES)
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import type {
  DiscrepancyReportResponse,
  DiscrepancyRecord,
  DiscrepancyType,
} from '../../types/reporting.types';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Get discrepancy report between WhatsApp and OES
 *
 * Compares DRs submitted via WhatsApp on waDate
 * Against OES activations on oesDate (default: waDate + 1)
 */
export async function getDiscrepancyReport(
  waDate: string,
  oesDate?: string,
  project?: string
): Promise<DiscrepancyReportResponse> {
  try {
    // Default OES date to waDate + 1 day
    const actualOesDate: string =
      oesDate ||
      (new Date(new Date(waDate).getTime() + 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0] as string);

    log.info('Getting discrepancy report', {
      waDate,
      oesDate: actualOesDate,
      project,
    }, 'ReportingService');

    // Use neon() tagged template (HTTP-based) instead of Pool (WebSocket)
    // to avoid "socket hang up" errors in production
    let rows;
    if (project) {
      rows = await sql`
        WITH wa_submissions AS (
          SELECT drop_number, project,
            COALESCE(whatsapp_message_date, created_at) as submitted_at,
            user_name, sender_phone
          FROM qa_photo_reviews
          WHERE COALESCE(whatsapp_message_date, created_at)::DATE = ${waDate}::DATE
            AND project = ${project}
        ),
        oes_activations_filtered AS (
          SELECT drop_number, serial_number, activation_date, team, status
          FROM oes_activations
          WHERE activation_date = ${actualOesDate}::DATE
        )
        SELECT
          COALESCE(w.drop_number, o.drop_number) as drop_number,
          w.project,
          CASE
            WHEN w.drop_number IS NOT NULL AND o.drop_number IS NOT NULL THEN 'matched'
            WHEN w.drop_number IS NOT NULL THEN 'wa_only'
            ELSE 'oes_only'
          END as discrepancy_type,
          w.submitted_at as wa_submitted_at,
          w.user_name as wa_submitted_by,
          w.sender_phone as wa_sender_phone,
          o.activation_date as oes_activation_date,
          o.team as oes_team,
          o.status as oes_status,
          o.serial_number as oes_serial_number
        FROM wa_submissions w
        FULL OUTER JOIN oes_activations_filtered o ON w.drop_number = o.drop_number
        ORDER BY discrepancy_type, drop_number
      `;
    } else {
      rows = await sql`
        WITH wa_submissions AS (
          SELECT drop_number, project,
            COALESCE(whatsapp_message_date, created_at) as submitted_at,
            user_name, sender_phone
          FROM qa_photo_reviews
          WHERE COALESCE(whatsapp_message_date, created_at)::DATE = ${waDate}::DATE
        ),
        oes_activations_filtered AS (
          SELECT drop_number, serial_number, activation_date, team, status
          FROM oes_activations
          WHERE activation_date = ${actualOesDate}::DATE
        )
        SELECT
          COALESCE(w.drop_number, o.drop_number) as drop_number,
          w.project,
          CASE
            WHEN w.drop_number IS NOT NULL AND o.drop_number IS NOT NULL THEN 'matched'
            WHEN w.drop_number IS NOT NULL THEN 'wa_only'
            ELSE 'oes_only'
          END as discrepancy_type,
          w.submitted_at as wa_submitted_at,
          w.user_name as wa_submitted_by,
          w.sender_phone as wa_sender_phone,
          o.activation_date as oes_activation_date,
          o.team as oes_team,
          o.status as oes_status,
          o.serial_number as oes_serial_number
        FROM wa_submissions w
        FULL OUTER JOIN oes_activations_filtered o ON w.drop_number = o.drop_number
        ORDER BY discrepancy_type, drop_number
      `;
    }

    // Map results
    const records: DiscrepancyRecord[] = rows.map((row) => ({
      drop_number: row.drop_number,
      project: row.project,
      discrepancy_type: row.discrepancy_type as DiscrepancyType,
      wa_submitted_at: row.wa_submitted_at
        ? new Date(row.wa_submitted_at).toISOString()
        : null,
      wa_submitted_by: row.wa_submitted_by,
      wa_sender_phone: row.wa_sender_phone,
      oes_activation_date: row.oes_activation_date,
      oes_team: row.oes_team,
      oes_status: row.oes_status,
      oes_serial_number: row.oes_serial_number,
    }));

    // Calculate summary
    const summary = {
      total_wa_submissions: records.filter(
        (r) => r.discrepancy_type === 'matched' || r.discrepancy_type === 'wa_only'
      ).length,
      total_oes_activations: records.filter(
        (r) => r.discrepancy_type === 'matched' || r.discrepancy_type === 'oes_only'
      ).length,
      matched: records.filter((r) => r.discrepancy_type === 'matched').length,
      wa_only: records.filter((r) => r.discrepancy_type === 'wa_only').length,
      oes_only: records.filter((r) => r.discrepancy_type === 'oes_only').length,
    };

    return {
      wa_date: waDate,
      oes_date: actualOesDate,
      summary,
      records,
    };
  } catch (error) {
    log.error('Failed to get discrepancy report', { error }, 'ReportingService');
    throw error;
  }
}
