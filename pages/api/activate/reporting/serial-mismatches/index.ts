/**
 * Serial Mismatches Report API
 *
 * GET: Fetch serial mismatch records where installed serial differs from activated serial
 * These are from the offline_devices table where serial_mismatch = true
 *
 * Critical for tracking:
 * - ONT theft/loss (original ONT replaced without documentation)
 * - Unreported ONT replacements
 * - Team accountability (which team installed the original)
 *
 * Query params:
 * - zone: Filter by zone
 * - team: Filter by installation team
 * - status: Filter by mismatch status
 * - page, pageSize: Pagination
 * - format: 'json' (default) or 'csv'
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';
import { log } from '@/lib/logger';
import type {
  SerialMismatchReportResponse,
  SerialMismatchRecord,
  SerialMismatchSummary,
  MismatchStatus,
  MismatchResolution,
} from '@/modules/activate/types/reporting.types';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const client = await pool.connect();

  try {
    const {
      zone,
      team,
      status,
      page = '1',
      pageSize = '50',
      format = 'json',
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const pageSizeNum = parseInt(pageSize as string, 10);
    const offset = (pageNum - 1) * pageSizeNum;

    // Build WHERE clause
    const conditions: string[] = ['o.serial_mismatch = true'];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (zone) {
      conditions.push(`o.zone = $${paramIndex}`);
      params.push(zone as string);
      paramIndex++;
    }

    if (team) {
      conditions.push(`e.team = $${paramIndex}`);
      params.push(team as string);
      paramIndex++;
    }

    if (status) {
      conditions.push(`COALESCE(o.mismatch_status, 'pending_investigation') = $${paramIndex}`);
      params.push(status as string);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Get summary statistics
    const summaryResult = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE COALESCE(o.mismatch_status, 'pending_investigation') = 'pending_investigation') as pending_investigation,
        COUNT(*) FILTER (WHERE o.mismatch_status = 'ticket_created') as ticket_created,
        COUNT(*) FILTER (WHERE o.mismatch_status = 'resolved') as resolved,
        COUNT(*) FILTER (WHERE o.mismatch_status = 'false_positive') as false_positive
      FROM offline_devices o
      LEFT JOIN oes_activations e ON o.drop_number = e.drop_number
      WHERE o.serial_mismatch = true
    `);
    const summaryRow = summaryResult.rows[0] ?? {};

    // Get breakdown by team (critical for accountability)
    const byTeamResult = await client.query(`
      SELECT COALESCE(e.team, 'Unknown') as team, COUNT(*) as count
      FROM offline_devices o
      LEFT JOIN oes_activations e ON o.drop_number = e.drop_number
      WHERE o.serial_mismatch = true
      GROUP BY e.team
      ORDER BY count DESC
    `);
    const byTeam: Record<string, number> = {};
    for (const row of byTeamResult.rows) {
      byTeam[row.team as string] = Number(row.count) || 0;
    }

    // Get breakdown by zone
    const byZoneResult = await client.query(`
      SELECT zone, COUNT(*) as count
      FROM offline_devices
      WHERE serial_mismatch = true AND zone IS NOT NULL
      GROUP BY zone
      ORDER BY count DESC
    `);
    const byZone: Record<string, number> = {};
    for (const row of byZoneResult.rows) {
      if (row.zone) {
        byZone[row.zone as string] = Number(row.count) || 0;
      }
    }

    // Get breakdown by down reason
    const byReasonResult = await client.query(`
      SELECT last_down_reason, COUNT(*) as count
      FROM offline_devices
      WHERE serial_mismatch = true AND last_down_reason IS NOT NULL
      GROUP BY last_down_reason
      ORDER BY count DESC
    `);
    const byReason: Record<string, number> = {};
    for (const row of byReasonResult.rows) {
      if (row.last_down_reason) {
        byReason[row.last_down_reason as string] = Number(row.count) || 0;
      }
    }

    const summary: SerialMismatchSummary = {
      total: Number(summaryRow.total) || 0,
      pending_investigation: Number(summaryRow.pending_investigation) || 0,
      ticket_created: Number(summaryRow.ticket_created) || 0,
      resolved: Number(summaryRow.resolved) || 0,
      false_positive: Number(summaryRow.false_positive) || 0,
      by_zone: byZone,
      by_reason: byReason,
    };

    // Add team breakdown to summary (extend type)
    const extendedSummary = {
      ...summary,
      by_team: byTeam,
    };

    // Get total count for pagination
    const countResult = await client.query(`
      SELECT COUNT(*) as count
      FROM offline_devices o
      LEFT JOIN oes_activations e ON o.drop_number = e.drop_number
      WHERE ${whereClause}
    `, params);
    const totalCount = Number(countResult.rows[0]?.count) || 0;

    // Get paginated records with team info
    const recordsResult = await client.query(`
      SELECT
        o.id,
        o.drop_number,
        o.zone,
        o.planned_pon as pon,
        o.address,
        o.serial_number as current_serial,
        o.expected_serial as original_serial,
        e.serial_number as oes_serial,
        o.serial_mismatch_type as mismatch_type,
        COALESCE(o.mismatch_status, 'pending_investigation') as status,
        o.mismatch_resolution as resolution,
        o.mismatch_notes as notes,
        o.mismatch_ticket_id as ticket_id,
        t.status as ticket_status,
        e.activation_date,
        e.team as installation_team,
        o.last_inform_date,
        o.days_since_last_inform as days_offline,
        o.last_down_reason as down_reason,
        EXTRACT(DAY FROM NOW() - COALESCE(o.mismatch_investigated_at, o.created_at)) as days_pending,
        o.mismatch_investigated_at as investigated_at,
        o.mismatch_resolved_at as resolved_at
      FROM offline_devices o
      LEFT JOIN oes_activations e ON o.drop_number = e.drop_number
      LEFT JOIN maintenance_tickets t ON o.mismatch_ticket_id = t.id
      WHERE ${whereClause}
      ORDER BY
        CASE
          WHEN COALESCE(o.mismatch_status, 'pending_investigation') = 'pending_investigation' THEN 0
          WHEN o.mismatch_status = 'ticket_created' THEN 1
          ELSE 2
        END,
        o.days_since_last_inform DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, pageSizeNum, offset]);

    // Map to records with team info
    const records = recordsResult.rows.map((row) => ({
      id: String(row.id),
      drop_number: String(row.drop_number),
      zone: row.zone ? String(row.zone) : null,
      pon: row.pon ? String(row.pon) : null,
      address: row.address ? String(row.address) : null,
      current_serial: String(row.current_serial ?? ''),
      expected_serial: String(row.original_serial ?? row.oes_serial ?? ''),
      mismatch_type: String(row.mismatch_type ?? 'different_serial'),
      status: (row.status ?? 'pending_investigation') as MismatchStatus,
      resolution: row.resolution as MismatchResolution | null,
      notes: row.notes ? String(row.notes) : null,
      ticket_id: row.ticket_id ? String(row.ticket_id) : null,
      ticket_status: row.ticket_status ? String(row.ticket_status) : null,
      activation_date: row.activation_date
        ? new Date(row.activation_date).toISOString().split('T')[0]
        : null,
      installation_team: row.installation_team ? String(row.installation_team) : null,
      last_inform_date: row.last_inform_date
        ? new Date(row.last_inform_date).toISOString().split('T')[0]
        : null,
      days_offline: Number(row.days_offline) || 0,
      down_reason: row.down_reason ? String(row.down_reason) : null,
      days_pending: Math.floor(Number(row.days_pending) || 0),
      investigated_at: row.investigated_at
        ? new Date(row.investigated_at).toISOString()
        : null,
      resolved_at: row.resolved_at
        ? new Date(row.resolved_at).toISOString()
        : null,
    }));

    // Get available teams for filter
    const teamsResult = await client.query(`
      SELECT DISTINCT COALESCE(e.team, 'Unknown') as team
      FROM offline_devices o
      LEFT JOIN oes_activations e ON o.drop_number = e.drop_number
      WHERE o.serial_mismatch = true
      ORDER BY team
    `);
    const availableTeams = teamsResult.rows.map(r => String(r.team));

    // Handle CSV export
    if (format === 'csv') {
      const csvRows = [
        ['DR Number', 'Zone', 'Team', 'Original Serial', 'Current Serial', 'Status', 'Days Offline', 'Down Reason', 'Activation Date'].join(','),
        ...records.map((r) =>
          [
            r.drop_number,
            r.zone ?? '',
            r.installation_team ?? 'Unknown',
            r.expected_serial,
            r.current_serial,
            r.status,
            r.days_offline,
            `"${(r.down_reason ?? '').replace(/"/g, '""')}"`,
            r.activation_date ?? '',
          ].join(',')
        ),
      ];

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=serial-mismatches-${new Date().toISOString().split('T')[0]}.csv`);
      return res.status(200).send(csvRows.join('\n'));
    }

    const response = {
      summary: extendedSummary,
      records,
      total_count: totalCount,
      page: pageNum,
      page_size: pageSizeNum,
      available_statuses: ['pending_investigation', 'ticket_created', 'resolved', 'false_positive'] as MismatchStatus[],
      available_resolutions: ['ont_replaced', 'data_corrected', 'theft_confirmed', 'false_alarm', 'other'] as MismatchResolution[],
      available_teams: availableTeams,
      available_zones: Object.keys(byZone),
    };

    log.info('SerialMismatchReport', `Fetched ${records.length} mismatch records`, {
      zone,
      team,
      status,
      totalCount,
    });

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('SerialMismatchReport', 'Failed to fetch serial mismatch report', { error });
    return apiResponse.internalError(res, error);
  } finally {
    client.release();
  }
}

export default withAuth(withRole('manager')(handler));
