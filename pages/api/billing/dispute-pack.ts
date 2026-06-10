/**
 * GET /api/billing/dispute-pack
 *
 * Downloads the FT dispute pack (xlsx) — every deduction currently in
 * resolution_status='disputing' for the given week, with our evidence.
 *
 * Query params:
 *   week_ending — YYYY-MM-DD (default: latest week in ft_billing_deductions)
 *   project     — ILIKE match (default: all projects)
 */

import type { NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';
import {
  buildDisputePackWorkbook,
  type DisputePackRow,
} from '@/modules/billing/services/disputePackBuilder';

const logger = createLogger('api/billing/dispute-pack');

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const weekParam = typeof req.query.week_ending === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.week_ending)
    ? req.query.week_ending
    : null;
  const project = typeof req.query.project === 'string' && req.query.project.trim()
    ? req.query.project.trim()
    : null;

  try {
    const weekEnding = weekParam ?? (
      await pool.query<{ w: string }>(`SELECT MAX(week_ending)::text AS w FROM ft_billing_deductions`)
    ).rows[0]?.w ?? null;

    if (!weekEnding) return apiResponse.badRequest(res, 'No billing deductions exist yet');

    const params: unknown[] = [weekEnding];
    let projectClause = '';
    if (project) {
      params.push(project);
      projectClause = `AND d.project ILIKE $2`;
    }

    const { rows } = await pool.query<{
      dr_number: string; deduction_note: string; project: string | null; team: string | null;
      serial_number: string | null; dispute_reason: string | null; dispute_opened_at: string | null;
      verdict_evidence: Record<string, unknown> | null; verdict_computed_at: string | null;
      ticket_uid: string | null;
      oes_serial: string | null; oes_status: string | null; oes_activated_at: string | null;
      ont_rx_sig_dbm: string | number | null;
    }>(
      `
      WITH latest_oes AS (
        SELECT DISTINCT ON (drop_number) drop_number, serial_number, status, activation_date, ont_rx_sig_dbm
          FROM oes_activations
         ORDER BY drop_number, COALESCE(activation_datetime, created_at) DESC
      )
      SELECT d.dr_number, d.deduction_note, d.project, d.team, d.serial_number,
             d.dispute_reason, d.dispute_opened_at::text,
             d.verdict_evidence, d.verdict_computed_at::text,
             t.ticket_uid,
             o.serial_number AS oes_serial, o.status AS oes_status,
             o.activation_date::text AS oes_activated_at, o.ont_rx_sig_dbm
        FROM ft_billing_deductions d
        LEFT JOIN maintenance_tickets t ON t.id = d.ticket_id
        LEFT JOIN latest_oes o ON o.drop_number = d.dr_number
       WHERE d.week_ending = $1::date
         AND d.resolution_status = 'disputing'
         ${projectClause}
       ORDER BY d.deduction_note, d.project, d.dr_number
      `,
      params,
    );

    const packRows: DisputePackRow[] = rows.map((r) => {
      const evidence = r.verdict_evidence ?? {};
      const reasons = Array.isArray(evidence.reasons) ? evidence.reasons.map(String) : [];
      const signal = Number(r.ont_rx_sig_dbm);
      return {
        drNumber: r.dr_number,
        noteCode: r.deduction_note,
        project: r.project,
        team: r.team,
        ftSerial: r.serial_number,
        oesSerial: r.oes_serial,
        oesStatus: r.oes_status,
        oesActivatedAt: r.oes_activated_at,
        signalDbm: Number.isFinite(signal) ? signal : null,
        disputeReason: r.dispute_reason,
        disputeOpenedAt: r.dispute_opened_at,
        verdictReasons: reasons,
        verdictComputedAt: r.verdict_computed_at,
        ticketUid: r.ticket_uid,
      };
    });

    const wb = buildDisputePackWorkbook({ weekEnding, project, rows: packRows });
    const buffer = await wb.xlsx.writeBuffer();

    const filenameProject = project ? `-${project.replace(/[^A-Za-z0-9]+/g, '_')}` : '';
    const filename = `FT-Dispute-Pack-WE${weekEnding}${filenameProject}.xlsx`;

    logger.info('dispute pack generated', { weekEnding, project, rows: packRows.length });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    logger.error('dispute-pack failed', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler as Parameters<typeof withAuth>[0]);
