/**
 * PATCH /api/tracker/master/[projectId]/[id]  — update single row
 * DELETE /api/tracker/master/[projectId]/[id] — delete single row
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

interface Params {
  params: Promise<{ projectId: string; id: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectId, id } = await params;
    const body = await req.json() as Record<string, unknown>;

    if (Object.keys(body).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Build dynamic SET clause
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(body)) {
      setClauses.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }

    // Add updated_at
    setClauses.push(`updated_at = now()`);

    values.push(projectId);
    values.push(id);

    const rows = await sql.query(
      `UPDATE master_tracker SET ${setClauses.join(', ')} WHERE project_id = $${paramCount} AND id = $${paramCount + 1} RETURNING *`,
      values
    );

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 });
    }

    return NextResponse.json({ data: rows[0] });
  } catch (err) {
    log.error('[tracker/master PATCH]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to update row' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectId, id } = await params;
    await sql`DELETE FROM master_tracker WHERE id = ${id} AND project_id = ${projectId}`;
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    log.error('[tracker/master DELETE]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to delete row' }, { status: 500 });
  }
}
