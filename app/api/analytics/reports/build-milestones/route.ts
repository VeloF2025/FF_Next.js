/**
 * Build Milestone Overview API
 * RFO (Civil Work Complete) + ATP progress per project
 * 🟢 WORKING
 */

export const dynamic = 'force-dynamic';

import type { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { verifyToken } from '@/lib/auth';

export interface BuildMilestoneRow {
  projectId: string;
  projectName: string;
  rfoTotal: number;
  rfoComplete: number;
  rfoPct: number;
  atpTotal: number;
  atpPassed: number;
  atpPct: number;
}

export interface BuildMilestonesData {
  rows: BuildMilestoneRow[];
  totals: {
    rfoTotal: number;
    rfoComplete: number;
    rfoPct: number;
    atpTotal: number;
    atpPassed: number;
    atpPct: number;
  };
}

const ALLOWED_USERS = ['28ab98c1-df21-48f8-a30a-489cd09a0d39', '7d84184b-2a2b-4fbb-a52e-9815d0e92237'];

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1];
    if (!token) {
      return apiResponse(null, 'Unauthorized', 401);
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return apiResponse(null, 'Invalid token', 401);
    }

    // Check if user in allowlist
    if (!ALLOWED_USERS.includes(payload.sub)) {
      return apiResponse(null, 'Access denied', 403);
    }

    const query = `
      SELECT
        p.id as project_id,
        p.project_name,
        COALESCE(SUM(pst.cwc_total), 0)     AS rfo_total,
        COALESCE(SUM(pst.cwc_complete), 0)  AS rfo_complete,
        COALESCE(SUM(pst.atp_total), 0)     AS atp_total,
        COALESCE(SUM(pst.atp_passed), 0)    AS atp_passed
      FROM projects p
      LEFT JOIN pon_stage_tracking pst ON pst.project_id = p.id
      WHERE p.status = 'active'
      GROUP BY p.id, p.project_name
      ORDER BY p.project_name
    `;

    const client = await pool.connect();
    try {
      const result = await client.query(query);
      const rows: BuildMilestoneRow[] = result.rows.map((row) => ({
        projectId: row.project_id,
        projectName: row.project_name,
        rfoTotal: parseInt(row.rfo_total, 10),
        rfoComplete: parseInt(row.rfo_complete, 10),
        rfoPct: row.rfo_total > 0 ? Math.round((row.rfo_complete / row.rfo_total) * 1000) / 10 : 0,
        atpTotal: parseInt(row.atp_total, 10),
        atpPassed: parseInt(row.atp_passed, 10),
        atpPct: row.atp_total > 0 ? Math.round((row.atp_passed / row.atp_total) * 1000) / 10 : 0,
      }));

      const totals = {
        rfoTotal: rows.reduce((sum, r) => sum + r.rfoTotal, 0),
        rfoComplete: rows.reduce((sum, r) => sum + r.rfoComplete, 0),
        atpTotal: rows.reduce((sum, r) => sum + r.atpTotal, 0),
        atpPassed: rows.reduce((sum, r) => sum + r.atpPassed, 0),
      };

      const data: BuildMilestonesData = {
        rows,
        totals: {
          rfoTotal: totals.rfoTotal,
          rfoComplete: totals.rfoComplete,
          rfoPct: totals.rfoTotal > 0 ? Math.round((totals.rfoComplete / totals.rfoTotal) * 1000) / 10 : 0,
          atpTotal: totals.atpTotal,
          atpPassed: totals.atpPassed,
          atpPct: totals.atpTotal > 0 ? Math.round((totals.atpPassed / totals.atpTotal) * 1000) / 10 : 0,
        },
      };

      return apiResponse(data, 'Build milestones fetched', 200);
    } finally {
      client.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return apiResponse(null, message, 500);
  }
}
