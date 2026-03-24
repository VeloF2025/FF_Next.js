/**
 * PATCH /api/conduit/milestones/[id] — partial update a milestone row (one field at a time)
 *
 * Auto-saves on blur; receives exactly one field per request.
 * Uses explicit query branches (no conditional SQL fragments) per project rules.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

interface Params {
  params: Promise<{ id: string }>;
}

const ALLOWED_FIELDS = [
  'responsible',
  'velocity_responsible',
  'fibertime_responsible',
  'planned_date',
  'due_date',
  'actual_date',
  'status',
  'comment',
] as const;

type AllowedField = (typeof ALLOWED_FIELDS)[number];

function isAllowedField(key: string): key is AllowedField {
  return (ALLOWED_FIELDS as readonly string[]).includes(key);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await req.json() as Record<string, string | null>;

    const validEntries = Object.entries(body).filter(([k]) => isAllowedField(k));
    if (validEntries.length === 0) {
      return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 });
    }

    // Auto-save sends one field at a time — handle first valid field
    const firstEntry = validEntries[0]!;
    const [field, value] = firstEntry;

    // Explicit branches: no conditional SQL fragments (project rule)
    let rows;
    if (field === 'responsible') {
      rows = await sql`UPDATE conduit_milestones SET responsible = ${value}, updated_at = NOW() WHERE id = ${id} RETURNING *`;
    } else if (field === 'velocity_responsible') {
      rows = await sql`UPDATE conduit_milestones SET velocity_responsible = ${value}, updated_at = NOW() WHERE id = ${id} RETURNING *`;
    } else if (field === 'fibertime_responsible') {
      rows = await sql`UPDATE conduit_milestones SET fibertime_responsible = ${value}, updated_at = NOW() WHERE id = ${id} RETURNING *`;
    } else if (field === 'planned_date') {
      rows = await sql`UPDATE conduit_milestones SET planned_date = ${value}, updated_at = NOW() WHERE id = ${id} RETURNING *`;
    } else if (field === 'due_date') {
      rows = await sql`UPDATE conduit_milestones SET due_date = ${value}, updated_at = NOW() WHERE id = ${id} RETURNING *`;
    } else if (field === 'actual_date') {
      rows = await sql`UPDATE conduit_milestones SET actual_date = ${value}, updated_at = NOW() WHERE id = ${id} RETURNING *`;
    } else if (field === 'status') {
      rows = await sql`UPDATE conduit_milestones SET status = ${value}, updated_at = NOW() WHERE id = ${id} RETURNING *`;
    } else if (field === 'comment') {
      rows = await sql`UPDATE conduit_milestones SET comment = ${value}, updated_at = NOW() WHERE id = ${id} RETURNING *`;
    } else {
      return NextResponse.json({ error: 'Unknown field' }, { status: 400 });
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 });
    }
    return NextResponse.json({ data: rows[0] });
  } catch (err) {
    log.error('[conduit/milestones PATCH]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to update milestone' }, { status: 500 });
  }
}
