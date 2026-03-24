/**
 * GET /api/conduit/staff — staff list for velocity_responsible dropdown
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

interface StaffRow {
  id: string;
  name: string;
}

export async function GET(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rows = await sql`
      SELECT id, name FROM staff
      WHERE name IS NOT NULL AND name != ''
      ORDER BY name ASC
    ` as StaffRow[];

    return NextResponse.json({ data: rows });
  } catch (err) {
    log.error('[conduit/staff GET]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to fetch staff' }, { status: 500 });
  }
}
