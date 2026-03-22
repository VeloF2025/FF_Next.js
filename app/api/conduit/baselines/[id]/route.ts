/**
 * DELETE /api/conduit/baselines/[id]
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
interface RouteContext { params: { id: string } }

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const result = await sql`DELETE FROM conduit_baselines WHERE id = ${params.id} RETURNING id`;
    if (!result.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[conduit/baselines DELETE]', error);
    return NextResponse.json({ error: 'Failed to delete baseline' }, { status: 500 });
  }
}
