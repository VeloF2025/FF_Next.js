/**
 * PATCH  /api/tracker/selectlists/[id] — update value or sort_order
 * DELETE /api/tracker/selectlists/[id] — delete entry
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await req.json() as { value?: string; sort_order?: number };
    const { value, sort_order } = body;

    if (value === undefined && sort_order === undefined) {
      return NextResponse.json({ error: 'value or sort_order required' }, { status: 400 });
    }

    // Explicit branches — no conditional SQL fragments
    let rows;
    if (value !== undefined && sort_order !== undefined) {
      rows = await sql`
        UPDATE tracker_selectlists SET value = ${value}, sort_order = ${sort_order} WHERE id = ${id} RETURNING *
      `;
    } else if (value !== undefined) {
      rows = await sql`
        UPDATE tracker_selectlists SET value = ${value} WHERE id = ${id} RETURNING *
      `;
    } else {
      rows = await sql`
        UPDATE tracker_selectlists SET sort_order = ${sort_order!} WHERE id = ${id} RETURNING *
      `;
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }
    return NextResponse.json({ data: rows[0] });
  } catch (err) {
    log.error('[tracker/selectlists PATCH]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    await sql`DELETE FROM tracker_selectlists WHERE id = ${id}`;
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    log.error('[tracker/selectlists DELETE]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
  }
}
