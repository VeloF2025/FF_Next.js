/**
 * GET    /api/conduit/projects/[id] — fetch single project
 * PATCH  /api/conduit/projects/[id] — partial update (e.g. status promotion)
 * PUT    /api/conduit/projects/[id] — update project + snapshot version history
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import type { ConduitProject } from '@/modules/conduit/types';

const sql = neon(process.env.DATABASE_URL!);

interface RouteContext {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [row] = await sql`
      SELECT id, name, po_count, start_date, build_duration_months,
             inputs_json, is_baseline_locked, created_at, updated_at
      FROM conduit_projects
      WHERE id = ${params.id}
    `;

    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ data: row as ConduitProject });
  } catch (error) {
    log.error('[conduit/projects/[id] GET]', error);
    return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json() as { status?: string };
    const { status } = body;

    const validStatuses = ['prospective', 'executable', 'wip'];
    if (!status || !validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status — must be prospective, executable, or wip' }, { status: 400 });
    }

    const [updated] = await sql`
      UPDATE conduit_projects
      SET status = ${status}
      WHERE id = ${params.id}
      RETURNING id, name, status, po_count, start_date, build_duration_months,
                inputs_json, is_baseline_locked, created_at, updated_at
    `;

    if (!updated) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ data: updated as ConduitProject });
  } catch (error) {
    log.error('[conduit/projects/[id] PATCH]', error);
    return NextResponse.json({ error: 'Failed to update project status' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json() as Partial<ConduitProject> & { version_label?: string };
    const { name, po_count, start_date, build_duration_months, inputs_json, version_label } = body;

    // Fetch existing to snapshot before update
    const [existing] = await sql`
      SELECT * FROM conduit_projects WHERE id = ${params.id}
    `;

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (existing.is_baseline_locked) {
      return NextResponse.json({ error: 'Project baseline is locked' }, { status: 409 });
    }

    // Snapshot current state as a version
    const label = version_label ?? `Auto-save ${new Date().toISOString()}`;
    await sql`
      INSERT INTO conduit_project_versions
        (project_id, version_label, inputs_snapshot, created_by)
      VALUES (
        ${params.id},
        ${label},
        ${JSON.stringify(existing.inputs_json)}::jsonb,
        NULL
      )
    `;

    // Apply updates (only provided fields)
    const [updated] = await sql`
      UPDATE conduit_projects SET
        name                  = ${name ?? existing.name},
        po_count              = ${po_count ?? existing.po_count},
        start_date            = ${start_date ?? existing.start_date},
        build_duration_months = ${build_duration_months ?? existing.build_duration_months},
        inputs_json           = ${JSON.stringify(inputs_json ?? existing.inputs_json)}::jsonb
      WHERE id = ${params.id}
      RETURNING id, name, status, po_count, start_date, build_duration_months,
                inputs_json, is_baseline_locked, created_at, updated_at
    `;

    return NextResponse.json({ data: updated as ConduitProject });
  } catch (error) {
    log.error('[conduit/projects/[id] PUT]', error);
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
  }
}
