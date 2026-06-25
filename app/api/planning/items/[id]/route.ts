// app/api/planning/items/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth/jwt';
import { createLogger } from '@/lib/logger';
import {
  getPlanningItemById,
  updatePlanningItem,
  deletePlanningItem,
  logPlanningActivity,
} from '@/modules/planning/services/planningService';

export const dynamic = 'force-dynamic';

const logger = createLogger('planning:api:items');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getUserId(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const token = cookieStore.get('ff_auth_token')?.value;
  if (!token) return undefined;
  const payload = await verifyToken(token);
  return payload?.sub;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ success: false, error: { message: 'Invalid id' } }, { status: 400 });
  try {
    const item = await getPlanningItemById(params.id);
    if (!item) return NextResponse.json({ success: false, error: { message: 'Planning item not found' } }, { status: 404 });
    return NextResponse.json({ success: true, data: item, meta: { timestamp: new Date().toISOString() } });
  } catch (error) {
    logger.error('Failed to get planning item', { error, id: params.id });
    return NextResponse.json({ success: false, error: { message: 'Failed to get planning item' } }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ success: false, error: { message: 'Invalid id' } }, { status: 400 });
  try {
    const body = await req.json();
    const userId = await getUserId();
    const before = await getPlanningItemById(params.id);
    if (!before) return NextResponse.json({ success: false, error: { message: 'Planning item not found' } }, { status: 404 });

    const updated = await updatePlanningItem(params.id, body);

    if (body.stage && body.stage !== before.stage) {
      void logPlanningActivity({
        planningItemId: params.id, activityType: 'stage_change',
        fieldChanged: 'stage', oldValue: before.stage, newValue: body.stage, userId,
      });
    }
    if (body.assigned_to !== undefined && body.assigned_to !== before.assigned_to) {
      void logPlanningActivity({
        planningItemId: params.id, activityType: 'assignment',
        fieldChanged: 'assigned_to', oldValue: before.assigned_to, newValue: body.assigned_to ?? null, userId,
      });
    }
    if (body.stage_checklists) {
      void logPlanningActivity({ planningItemId: params.id, activityType: 'checklist', userId });
    }

    return NextResponse.json({ success: true, data: updated, message: 'Planning item updated', meta: { timestamp: new Date().toISOString() } });
  } catch (error) {
    logger.error('Failed to update planning item', { error, id: params.id });
    return NextResponse.json({ success: false, error: { message: 'Failed to update planning item' } }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ success: false, error: { message: 'Invalid id' } }, { status: 400 });
  try {
    const userId = await getUserId();
    const existing = await getPlanningItemById(params.id);
    if (!existing) return NextResponse.json({ success: false, error: { message: 'Planning item not found' } }, { status: 404 });
    const deleted = await deletePlanningItem(params.id);
    void logPlanningActivity({ planningItemId: params.id, activityType: 'cancelled', note: 'Planning item cancelled', userId });
    return NextResponse.json({ success: true, data: deleted, message: 'Planning item cancelled', meta: { timestamp: new Date().toISOString() } });
  } catch (error) {
    logger.error('Failed to delete planning item', { error, id: params.id });
    return NextResponse.json({ success: false, error: { message: 'Failed to delete planning item' } }, { status: 500 });
  }
}
