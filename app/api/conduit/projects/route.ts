/**
 * GET  /api/conduit/projects  — list all conduit projects
 * POST /api/conduit/projects  — create a new project
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import type { ConduitProject } from '@/modules/conduit/types';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rows = await sql`
      SELECT id, name, status, ft_project_name, po_count, start_date, build_duration_months,
             inputs_json, is_baseline_locked, created_at, updated_at
      FROM conduit_projects
      ORDER BY created_at ASC
    `;

    return NextResponse.json({ data: rows as ConduitProject[] });
  } catch (error) {
    console.error('[conduit/projects GET]', error);
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json() as Partial<ConduitProject>;
    const { name, po_count, start_date, build_duration_months, inputs_json, status } = body;

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const [row] = await sql`
      INSERT INTO conduit_projects
        (name, po_count, start_date, build_duration_months, inputs_json, status)
      VALUES (
        ${name},
        ${po_count ?? 0},
        ${start_date ?? null},
        ${build_duration_months ?? 12},
        ${JSON.stringify(inputs_json ?? {})}::jsonb,
        ${status ?? 'executable'}
      )
      RETURNING id, name, status, po_count, start_date, build_duration_months,
                inputs_json, is_baseline_locked, created_at, updated_at
    `;

    return NextResponse.json({ data: row as ConduitProject }, { status: 201 });
  } catch (error) {
    console.error('[conduit/projects POST]', error);
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}
