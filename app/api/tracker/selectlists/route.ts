/**
 * GET  /api/tracker/selectlists          — all lists grouped by list_name (for dropdowns)
 * GET  /api/tracker/selectlists?full=true — full rows with IDs (for admin)
 * POST /api/tracker/selectlists          — add a new entry
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

interface SelectListRow {
  id: string;
  list_name: string;
  value: string;
  sort_order: number;
}

export async function GET(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const full = searchParams.get('full') === 'true';

    const rows = await sql`
      SELECT id, list_name, value, sort_order
      FROM tracker_selectlists
      ORDER BY list_name, sort_order, value
    ` as SelectListRow[];

    if (full) {
      // Return full rows with IDs for the admin panel
      return NextResponse.json({ data: rows });
    }

    // Return grouped strings for dropdown consumers
    const grouped: Record<string, string[]> = {};
    for (const row of rows) {
      if (!grouped[row.list_name]) grouped[row.list_name] = [];
      // Non-null: guard above ensures the array exists
      grouped[row.list_name]!.push(row.value);
    }

    return NextResponse.json({ data: grouped });
  } catch (err) {
    log.error('[tracker/selectlists GET]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to fetch selectlists' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as { list_name: string; value: string; sort_order?: number };
    const { list_name, value, sort_order } = body;

    if (!list_name || !value) {
      return NextResponse.json({ error: 'list_name and value are required' }, { status: 400 });
    }

    const [row] = await sql`
      INSERT INTO tracker_selectlists (list_name, value, sort_order)
      VALUES (${list_name}, ${value}, ${sort_order ?? 0})
      RETURNING id, list_name, value, sort_order
    `;

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err) {
    log.error('[tracker/selectlists POST]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 });
  }
}
