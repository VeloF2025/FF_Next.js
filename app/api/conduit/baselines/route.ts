/**
 * GET  /api/conduit/baselines  — list all baselines (newest first)
 * POST /api/conduit/baselines  — create a new baseline snapshot
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import type { ConduitBaseline, ConduitCalcResult } from '@/modules/conduit/types';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rows = await sql`
      SELECT id, project_id, project_name, label, inputs_snapshot, calc_snapshot, created_at
      FROM conduit_baselines
      ORDER BY created_at DESC
    `;
    return NextResponse.json({ data: rows as ConduitBaseline[] });
  } catch (error) {
    console.error('[conduit/baselines GET]', error);
    return NextResponse.json({ error: 'Failed to fetch baselines' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as {
      project_id: string;
      project_name: string;
      label: string;
      inputs_snapshot: Record<string, unknown>;
      calc_snapshot: ConduitCalcResult;
    };

    const { project_id, project_name, label, inputs_snapshot, calc_snapshot } = body;
    if (!project_id || !project_name || !label) {
      return NextResponse.json({ error: 'project_id, project_name and label are required' }, { status: 400 });
    }

    const [row] = await sql`
      INSERT INTO conduit_baselines (project_id, project_name, label, inputs_snapshot, calc_snapshot)
      VALUES (
        ${project_id},
        ${project_name},
        ${label},
        ${JSON.stringify(inputs_snapshot)}::jsonb,
        ${JSON.stringify(calc_snapshot)}::jsonb
      )
      RETURNING id, project_id, project_name, label, inputs_snapshot, calc_snapshot, created_at
    `;
    return NextResponse.json({ data: row as ConduitBaseline }, { status: 201 });
  } catch (error) {
    console.error('[conduit/baselines POST]', error);
    return NextResponse.json({ error: 'Failed to create baseline' }, { status: 500 });
  }
}
