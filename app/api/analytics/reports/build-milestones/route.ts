/**
 * Build Milestone Overview API
 * Source: sp_pon_tracker (synced from SharePoint PON Tracker tab)
 * RFO = ready_for_optical_date NOT NULL
 * ATP = optical_activated_date NOT NULL
 * 🟢 WORKING
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import pool from '@/lib/db';
import { verifyToken } from '@/lib/auth/jwt';
import { userHasPermission } from '@/lib/permissions';

const ALLOWED_USERS = new Set([
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', // Hein
  '7d84184b-2a2b-4fbb-a52e-9815d0e92237', // Lew
]);

export interface BuildMilestoneRow {
  projectId: string;
  projectName: string;
  ponScope: number;
  rfoDone: number;
  rfoPct: number;
  atpDone: number;
  atpPct: number;
}

export interface BuildMilestoneMonth {
  monthKey: string;   // 'YYYY-MM'
  monthLabel: string; // "Jan '25"
  rfoCount: number;
  atpCount: number;
}

export interface BuildMilestonesData {
  // Report 1 — Scope vs Actual
  rows: BuildMilestoneRow[];
  totals: { ponScope: number; rfoDone: number; rfoPct: number; atpDone: number; atpPct: number };
  // Report 2 — Timeline
  timeline: BuildMilestoneMonth[];
}

async function auth(req: NextRequest): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('ff_auth_token')?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload?.sub) return null;
  const userId = payload.sub;
  const hasAccess = await userHasPermission(userId, 'analytics.reports', 'view');
  if (!hasAccess && !ALLOWED_USERS.has(userId)) return null;
  return userId;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const userId = await auth(req);
    if (!userId) {
      return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Access denied' } }, { status: 401 });
    }

    const client = await pool.connect();
    try {
      const [scopeRes, timelineRes] = await Promise.all([
        client.query(`
          SELECT
            p.id AS project_id,
            p.project_name,
            COUNT(DISTINCT spt.hld_pon)::int AS pon_scope,
            COUNT(DISTINCT CASE WHEN spt.ready_for_optical_date IS NOT NULL THEN spt.hld_pon END)::int AS rfo_done,
            COUNT(DISTINCT CASE WHEN spt.optical_activated_date IS NOT NULL THEN spt.hld_pon END)::int AS atp_done
          FROM projects p
          LEFT JOIN sp_pon_tracker spt ON spt.project_id = p.id
          WHERE p.id IN (
            SELECT DISTINCT project_id FROM sp_pon_tracker
          )
          GROUP BY p.id, p.project_name
          ORDER BY p.project_name
        `),
        client.query(`
          SELECT
            TO_CHAR(DATE_TRUNC('month', rfo_dates.d), 'YYYY-MM') AS month_key,
            TO_CHAR(DATE_TRUNC('month', rfo_dates.d), 'Mon ''YY') AS month_label,
            SUM(CASE WHEN rfo_dates.type = 'rfo' THEN 1 ELSE 0 END)::int AS rfo_count,
            SUM(CASE WHEN rfo_dates.type = 'atp' THEN 1 ELSE 0 END)::int AS atp_count
          FROM (
            SELECT DISTINCT hld_pon, ready_for_optical_date AS d, 'rfo' AS type
            FROM sp_pon_tracker
            WHERE ready_for_optical_date IS NOT NULL AND ready_for_optical_date > '2020-01-01'
            UNION ALL
            SELECT DISTINCT hld_pon, optical_activated_date AS d, 'atp' AS type
            FROM sp_pon_tracker
            WHERE optical_activated_date IS NOT NULL AND optical_activated_date > '2020-01-01'
          ) rfo_dates
          GROUP BY month_key, month_label
          ORDER BY month_key
        `),
      ]);

      const rows: BuildMilestoneRow[] = scopeRes.rows.map((r) => ({
        projectId: r.project_id,
        projectName: r.project_name,
        ponScope: r.pon_scope,
        rfoDone: r.rfo_done,
        rfoPct: r.pon_scope > 0 ? Math.round((r.rfo_done / r.pon_scope) * 1000) / 10 : 0,
        atpDone: r.atp_done,
        atpPct: r.pon_scope > 0 ? Math.round((r.atp_done / r.pon_scope) * 1000) / 10 : 0,
      }));

      const totals = rows.reduce(
        (acc, r) => ({
          ponScope: acc.ponScope + r.ponScope,
          rfoDone: acc.rfoDone + r.rfoDone,
          rfoPct: 0,
          atpDone: acc.atpDone + r.atpDone,
          atpPct: 0,
        }),
        { ponScope: 0, rfoDone: 0, rfoPct: 0, atpDone: 0, atpPct: 0 }
      );
      totals.rfoPct = totals.ponScope > 0 ? Math.round((totals.rfoDone / totals.ponScope) * 1000) / 10 : 0;
      totals.atpPct = totals.ponScope > 0 ? Math.round((totals.atpDone / totals.ponScope) * 1000) / 10 : 0;

      const timeline: BuildMilestoneMonth[] = timelineRes.rows.map((r) => ({
        monthKey: r.month_key,
        monthLabel: r.month_label,
        rfoCount: r.rfo_count,
        atpCount: r.atp_count,
      }));

      const data: BuildMilestonesData = { rows, totals, timeline };
      return NextResponse.json({ success: true, data });
    } finally {
      client.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, { status: 500 });
  }
}
