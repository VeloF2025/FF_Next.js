/**
 * POST /api/conduit/projects/copy
 * Copies a WIP project into Scoping status with a datestamped name.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import type { ConduitProject } from '@/modules/conduit/types';

const sql = neon(process.env.DATABASE_URL!);

export async function POST(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json() as { sourceId?: string };
    const { sourceId } = body;

    if (!sourceId) {
      return NextResponse.json({ error: 'sourceId is required' }, { status: 400 });
    }

    // Fetch the source project
    const [source] = await sql`
      SELECT id, name, status, ft_project_name, po_count, start_date,
             build_duration_months, inputs_json
      FROM conduit_projects
      WHERE id = ${sourceId}
    ` as ConduitProject[];

    if (!source) {
      return NextResponse.json({ error: 'Source project not found' }, { status: 404 });
    }

    // Build the new name: "{original_name} (Scoping - DD Mon YYYY)"
    const dateStr = new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const newName = `${source.name} (Scoping - ${dateStr})`;

    const [row] = await sql`
      INSERT INTO conduit_projects
        (name, status, ft_project_name, po_count, start_date,
         build_duration_months, inputs_json)
      VALUES (
        ${newName},
        'scoping',
        ${source.ft_project_name ?? null},
        ${source.po_count},
        ${source.start_date ?? null},
        ${source.build_duration_months},
        ${JSON.stringify(source.inputs_json)}::jsonb
      )
      RETURNING id, name, status, ft_project_name, po_count, start_date,
                build_duration_months, inputs_json, is_baseline_locked,
                created_at, updated_at
    ` as ConduitProject[];

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (error) {
    log.error('[conduit/projects/copy POST]', { error: String(error) });
    return NextResponse.json({ error: 'Failed to copy project' }, { status: 500 });
  }
}
