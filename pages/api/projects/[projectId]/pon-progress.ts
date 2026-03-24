/**
 * API Route: /api/projects/[projectId]/pon-progress
 *
 * GET - Returns PON progress data with target dates, blockage, and recent daily logs
 * PUT - Updates target dates, blockage, or adds daily log entries
 *
 * Query params (GET): ?zone=N&days=7
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import type { ProgressCategory, ProgressStatus, PonDailyLogEntry } from '@/types/pon-stages.types';
import { apiResponse } from '@/lib/apiResponse';

function deriveStatus(pct: number, targetDate: string | null): ProgressStatus {
  if (pct >= 100) return 'complete';
  if (!targetDate) return 'no_target';
  const now = new Date();
  const target = new Date(targetDate);
  const daysLeft = Math.ceil((target.getTime() - now.getTime()) / 86400000);
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= 7) return 'at_risk';
  return 'on_track';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { projectId } = req.query;
  const projectIdStr = Array.isArray(projectId) ? projectId[0] : projectId;

  if (!projectIdStr) {
    return apiResponse.badRequest(res, 'Missing projectId');
  }

  if (req.method === 'GET') {
    return handleGet(req, res, projectIdStr);
  }
  if (req.method === 'PUT') {
    return handlePut(req as AuthenticatedNextApiRequest, res, projectIdStr);
  }
  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PUT']);
}

async function handleGet(req: NextApiRequest, res: NextApiResponse, projectId: string) {
  const { zone, days } = req.query;
  const zoneFilter = zone ? Number(Array.isArray(zone) ? zone[0] : zone) : null;
  const daysBack = days ? Number(Array.isArray(days) ? days[0] : days) : 7;

  const client = await pool.connect();
  try {
    // Get project name
    const projResult = await client.query<{ project_name: string }>(
      'SELECT project_name FROM projects WHERE id = $1',
      [projectId]
    );
    if (projResult.rows.length === 0) {
      return apiResponse.notFound(res, 'Project not found');
    }
    const projectName = projResult.rows[0]!.project_name;

    // Fetch PON stage data with target dates and blockage
    let query = `
      SELECT id, zone_no, pon_no,
        cwc_total::text, cwc_complete::text, cwc_first_date::text, cwc_last_date::text, cwc_target_date::text,
        optical_total::text, optical_complete::text, optical_first_date::text, optical_last_date::text, optical_target_date::text,
        activation_total::text, activation_complete::text, activation_first_date::text, activation_last_date::text, activation_target_date::text,
        maintenance_total::text, maintenance_complete::text, maintenance_first_date::text, maintenance_last_date::text, maintenance_target_date::text,
        blockage
      FROM pon_stage_tracking
      WHERE project_id = $1
    `;
    const params: (string | number)[] = [projectId];

    if (zoneFilter !== null) {
      query += ' AND zone_no = $2';
      params.push(zoneFilter);
    }
    query += ' ORDER BY zone_no, pon_no';

    const ponResult = await client.query(query, params);

    // Fetch recent daily logs for all PONs
    const ponIds = ponResult.rows.map((r: { id: string }) => r.id);
    const logsMap = new Map<string, PonDailyLogEntry[]>();

    if (ponIds.length > 0) {
      const logResult = await client.query<PonDailyLogEntry & { pon_stage_id: string }>(
        `SELECT id, pon_stage_id, log_date::text as log_date, category, activity, delay_reason, logged_by, created_at::text as created_at
         FROM pon_daily_log
         WHERE pon_stage_id = ANY($1) AND log_date >= CURRENT_DATE - $2::integer
         ORDER BY log_date DESC`,
        [ponIds, daysBack]
      );
      for (const logRow of logResult.rows) {
        const existing = logsMap.get(logRow.pon_stage_id) || [];
        existing.push(logRow);
        logsMap.set(logRow.pon_stage_id, existing);
      }
    }

    // Build response
    const categories: ProgressCategory[] = ['cwc', 'optical', 'activation', 'maintenance'];
    const summaryTotals: Record<ProgressCategory, { target: number; actual: number }> = {
      cwc: { target: 0, actual: 0 },
      optical: { target: 0, actual: 0 },
      activation: { target: 0, actual: 0 },
      maintenance: { target: 0, actual: 0 },
    };

    const zoneMap = new Map<number, Record<string, unknown>[]>();
    for (const row of ponResult.rows) {
      const r = row as Record<string, string | null>;
      const ponData: Record<string, unknown> = {
        pon_stage_id: r['id'],
        zone_no: r['zone_no'],
        pon_no: r['pon_no'],
        blockage: r['blockage'] || null,
        recent_logs: logsMap.get(r['id'] as string) || [],
      };

      for (const cat of categories) {
        const total = Number(r[`${cat}_total`] || 0);
        const complete = Number(r[`${cat}_complete`] || 0);
        const pct = total > 0 ? Math.round((complete / total) * 10000) / 100 : 0;
        const targetDate = r[`${cat}_target_date`] || null;

        ponData[cat] = {
          total,
          complete,
          pct,
          first_date: r[`${cat}_first_date`] || null,
          last_date: r[`${cat}_last_date`] || null,
          target_date: targetDate,
          status: deriveStatus(pct, targetDate),
        };

        summaryTotals[cat].target += total;
        summaryTotals[cat].actual += complete;
      }

      const zoneNo = Number(r['zone_no']);
      const existing = zoneMap.get(zoneNo) || [];
      existing.push(ponData);
      zoneMap.set(zoneNo, existing);
    }

    const zones = Array.from(zoneMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([zoneNo, pons]) => ({
        zone_no: zoneNo,
        zone_name: `Zone ${zoneNo}`,
        pons,
      }));

    const summary: Record<string, { target: number; actual: number; pct: number }> = {};
    for (const cat of categories) {
      const { target, actual } = summaryTotals[cat];
      summary[cat] = {
        target,
        actual,
        pct: target > 0 ? Math.round((actual / target) * 10000) / 100 : 0,
      };
    }

    log.info('PON progress fetched', { projectId, pons: ponResult.rows.length }, 'PonProgress');

    return res.status(200).json({
      project_id: projectId,
      project_name: projectName,
      summary,
      zones,
    });
  } catch (error) {
    log.error('Failed to fetch PON progress', { error, projectId }, 'PonProgress');
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  } finally {
    client.release();
  }
}

async function handlePut(req: AuthenticatedNextApiRequest, res: NextApiResponse, projectId: string) {
  const { pon_stage_id, action } = req.body as {
    pon_stage_id?: string;
    action?: string;
    category?: string;
    target_date?: string | null;
    blockage?: string | null;
    daily_log?: {
      category?: string;
      activity?: string;
      delay_reason?: string | null;
      date?: string;
    };
  };

  if (!pon_stage_id || !action) {
    return apiResponse.badRequest(res, 'Missing pon_stage_id or action');
  }

  const client = await pool.connect();
  try {
    // Verify PON belongs to project
    const verify = await client.query(
      'SELECT id FROM pon_stage_tracking WHERE id = $1 AND project_id = $2',
      [pon_stage_id, projectId]
    );
    if (verify.rows.length === 0) {
      return apiResponse.notFound(res, 'PON not found in this project');
    }

    if (action === 'set_target') {
      const { category, target_date } = req.body as { category?: string; target_date?: string | null };
      const validCats: ProgressCategory[] = ['cwc', 'optical', 'activation', 'maintenance'];
      if (!category || !validCats.includes(category as ProgressCategory)) {
        return apiResponse.badRequest(res, 'Invalid category');
      }
      await client.query(
        `UPDATE pon_stage_tracking SET ${category}_target_date = $1 WHERE id = $2`,
        [target_date || null, pon_stage_id]
      );
      log.info('Target date set', { pon_stage_id, category, target_date }, 'PonProgress');
      return res.status(200).json({ success: true });
    }

    if (action === 'set_blockage') {
      const { blockage } = req.body as { blockage?: string | null };
      await client.query(
        'UPDATE pon_stage_tracking SET blockage = $1 WHERE id = $2',
        [blockage || null, pon_stage_id]
      );
      log.info('Blockage set', { pon_stage_id, blockage }, 'PonProgress');
      return res.status(200).json({ success: true });
    }

    if (action === 'add_daily_log') {
      const { daily_log } = req.body as {
        daily_log?: { category?: string; activity?: string; delay_reason?: string | null; date?: string };
      };
      if (!daily_log?.category || !daily_log?.activity) {
        return apiResponse.badRequest(res, 'Missing daily_log.category or daily_log.activity');
      }
      const logDate = daily_log.date || new Date().toISOString().split('T')[0];
      const userName = req.user?.name || req.user?.email || 'Unknown';

      await client.query(
        `INSERT INTO pon_daily_log (pon_stage_id, log_date, category, activity, delay_reason, logged_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (pon_stage_id, log_date, category) DO UPDATE
         SET activity = EXCLUDED.activity, delay_reason = EXCLUDED.delay_reason, logged_by = EXCLUDED.logged_by`,
        [pon_stage_id, logDate, daily_log.category, daily_log.activity, daily_log.delay_reason || null, userName]
      );
      log.info('Daily log added', { pon_stage_id, date: logDate, category: daily_log.category }, 'PonProgress');
      return res.status(200).json({ success: true });
    }

    return apiResponse.badRequest(res, `Unknown action: ${action}`);
  } catch (error) {
    log.error('Failed to update PON progress', { error, projectId }, 'PonProgress');
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  } finally {
    client.release();
  }
}

export default withAuth(handler);
