import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { log } from '@/lib/logger';

interface RouteParams {
  params: { projectId: string };
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = getAuth(req);
  if (!auth?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { projectId } = params;
    // TODO: query pon_tracker_entries table when implemented
    log.info('tracker GET', { projectId }, 'api/tracker');
    return NextResponse.json({ success: true, data: { pons: [], lastSavedAt: null, projectId } });
  } catch (err) {
    log.error('tracker GET failed', { err }, 'api/tracker');
    return NextResponse.json({ success: false, message: 'Failed to load' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = getAuth(req);
  if (!auth?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { projectId } = params;
    const body = (await req.json()) as { pons?: unknown[] };
    const count = body.pons?.length ?? 0;
    // TODO: upsert to pon_tracker_entries table when implemented
    log.info('tracker POST', { projectId, count }, 'api/tracker');
    return NextResponse.json({ success: true, data: { saved: count } });
  } catch (err) {
    log.error('tracker POST failed', { err }, 'api/tracker');
    return NextResponse.json({ success: false, message: 'Save failed' }, { status: 500 });
  }
}
