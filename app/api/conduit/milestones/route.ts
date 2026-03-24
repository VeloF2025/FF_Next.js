/**
 * GET  /api/conduit/milestones?projectId=xxx  — list milestones for project
 * POST /api/conduit/milestones?projectId=xxx  — auto-create rows for all items
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

    const rows = await sql`
      SELECT cm.id, cm.project_id, cm.milestone_item_id,
             cmi.phase, cmi.item_name, cmi.sort_order,
             cm.responsible, cm.velocity_responsible, cm.fibertime_responsible,
             cm.planned_date, cm.due_date, cm.actual_date,
             cm.status, cm.comment, cm.created_at, cm.updated_at
      FROM conduit_milestones cm
      JOIN conduit_milestone_items cmi ON cmi.id = cm.milestone_item_id
      WHERE cm.project_id = ${projectId}
      ORDER BY cmi.phase, cmi.sort_order
    `;

    return NextResponse.json({ data: rows });
  } catch (err) {
    log.error('[conduit/milestones GET]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to fetch milestones' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

    const result = await sql`
      INSERT INTO conduit_milestones (project_id, milestone_item_id, phase, item_name, status)
      SELECT ${projectId}, id, phase, item_name, 'Not Started'
      FROM conduit_milestone_items
      ON CONFLICT (project_id, milestone_item_id) DO NOTHING
    `;

    return NextResponse.json({ data: { created: result.length } }, { status: 201 });
  } catch (err) {
    log.error('[conduit/milestones POST init]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to init milestones' }, { status: 500 });
  }
}
