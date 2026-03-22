/**
 * GET /api/conduit/actuals?project=Lawley
 * Returns all actuals rows for a given ft_project_name.
 */
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import type { ConduitActual } from '@/modules/conduit/types';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const project = searchParams.get('project');
    if (!project) return NextResponse.json({ error: 'project param required' }, { status: 400 });

    const rows = await sql`
      SELECT
        to_char(month, 'YYYY-MM-DD') as month,
        cos_actual::float,
        activations::int,
        revenue_actual::float,
        cos_breakdown
      FROM conduit_actuals
      WHERE project_name = ${project}
      ORDER BY month ASC
    `;

    return NextResponse.json({ data: rows as ConduitActual[] });
  } catch (error) {
    console.error('[conduit/actuals GET]', error);
    return NextResponse.json({ error: 'Failed to fetch actuals' }, { status: 500 });
  }
}
