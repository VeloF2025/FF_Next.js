/**
 * GET /api/analytics/reports/pre-provisions
 *
 * Pre-Provisions report — OES pre-provision cases logged vs fixed per month/project
 * Source: oes_pp_data table
 * Fixed = resolution_status IN (activated, located_1map, located_local, located_oes, located_unified)
 * Open  = resolution_status = 'not_found' OR NULL
 *
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
  '23c96d45-2d4f-4911-84f9-9f88875cece1', // JP Terblanche
  '281f2d20-bb60-4ec2-8614-9b785d8e88e4', // Ettiene Janse van Rensburg
]);

export interface PreProvisionProject {
  projectName: string;
  logged: number;
  fixed: number;
  open: number;
}

export interface PreProvisionMonth {
  monthKey: string;    // 'YYYY-MM'
  monthLabel: string;  // "Jan '26"
  logged: number;
  fixed: number;
  open: number;
  byProject: PreProvisionProject[];
}

export interface PreProvisionYear {
  year: number;
  logged: number;
  fixed: number;
  open: number;
  byProject: PreProvisionProject[];
  months: PreProvisionMonth[];
}

export interface PreProvisionsData {
  years: PreProvisionYear[];
  totals: { logged: number; fixed: number; open: number };
  allProjects: string[];
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('ff_auth_token')?.value;
    if (!token) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload?.sub) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }, { status: 401 });
    const hasAccess = await userHasPermission(payload.sub, 'analytics.reports', 'view');
    if (!hasAccess && !ALLOWED_USERS.has(payload.sub)) {
      return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'Access restricted' } }, { status: 403 });
    }

    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT
          EXTRACT(YEAR FROM date_registered)::int                      AS year,
          TO_CHAR(DATE_TRUNC('month', date_registered), 'YYYY-MM')    AS month_key,
          TO_CHAR(DATE_TRUNC('month', date_registered), 'Mon ''YY')   AS month_label,
          COALESCE(project, 'Unknown')                                  AS project_name,
          COUNT(*)::int                                                  AS logged,
          COUNT(CASE WHEN resolution_status IN (
            'activated','located_1map','located_local','located_oes','located_unified'
          ) THEN 1 END)::int                                             AS fixed,
          COUNT(CASE WHEN resolution_status = 'not_found'
            OR resolution_status IS NULL THEN 1 END)::int               AS open
        FROM oes_pp_data
        WHERE date_registered IS NOT NULL
        GROUP BY year, month_key, month_label, project_name
        ORDER BY year, month_key, project_name
      `);

      // Collect all project names
      const allProjects = [...new Set(result.rows.map((r) => r.project_name))].sort();

      // Group by year → month → project
      const yearMap = new Map<number, PreProvisionYear>();

      for (const row of result.rows) {
        const yr = row.year as number;
        if (!yearMap.has(yr)) {
          yearMap.set(yr, { year: yr, logged: 0, fixed: 0, open: 0, byProject: [], months: [] });
        }
        const yearObj = yearMap.get(yr)!;

        // Month
        let monthObj = yearObj.months.find((m) => m.monthKey === row.month_key);
        if (!monthObj) {
          monthObj = { monthKey: row.month_key, monthLabel: row.month_label, logged: 0, fixed: 0, open: 0, byProject: [] };
          yearObj.months.push(monthObj);
        }
        monthObj.logged += row.logged;
        monthObj.fixed += row.fixed;
        monthObj.open += row.open;
        monthObj.byProject.push({ projectName: row.project_name, logged: row.logged, fixed: row.fixed, open: row.open });

        // Year totals
        yearObj.logged += row.logged;
        yearObj.fixed += row.fixed;
        yearObj.open += row.open;

        // Year byProject
        let yp = yearObj.byProject.find((p) => p.projectName === row.project_name);
        if (!yp) { yp = { projectName: row.project_name, logged: 0, fixed: 0, open: 0 }; yearObj.byProject.push(yp); }
        yp.logged += row.logged;
        yp.fixed += row.fixed;
        yp.open += row.open;
      }

      const years = Array.from(yearMap.values()).sort((a, b) => a.year - b.year);
      const totals = years.reduce((acc, y) => ({ logged: acc.logged + y.logged, fixed: acc.fixed + y.fixed, open: acc.open + y.open }), { logged: 0, fixed: 0, open: 0 });

      return NextResponse.json({ success: true, data: { years, totals, allProjects } satisfies PreProvisionsData });
    } finally {
      client.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, { status: 500 });
  }
}
