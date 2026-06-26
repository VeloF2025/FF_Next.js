// app/api/planning/items/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth/jwt';
import { createLogger } from '@/lib/logger';
import {
  listPlanningItems,
  createPlanningItem,
  logPlanningActivity,
} from '@/modules/planning/services/planningService';
import type { PlanningFilters, PlanningStage } from '@/modules/planning/types/planning';
import { PLANNING_STAGES, PLANNING_PRIORITIES } from '@/modules/planning/constants/stages';

export const dynamic = 'force-dynamic';

const logger = createLogger('planning:api:items');

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filters: PlanningFilters = {};
    if (searchParams.has('project_id')) filters.project_id = searchParams.get('project_id')!;
    if (searchParams.has('stage')) filters.stage = searchParams.get('stage') as PlanningStage;
    if (searchParams.has('exclude_stage')) filters.exclude_stage = searchParams.getAll('exclude_stage') as PlanningStage[];
    if (searchParams.has('assigned_to')) filters.assigned_to = searchParams.get('assigned_to')!;
    if (searchParams.has('search')) filters.search = searchParams.get('search')!;
    if (searchParams.has('created_after')) filters.created_after = new Date(searchParams.get('created_after')!);
    if (searchParams.has('created_before')) filters.created_before = new Date(searchParams.get('created_before')!);
    if (searchParams.has('page')) filters.page = parseInt(searchParams.get('page')!, 10);
    if (searchParams.has('pageSize')) filters.pageSize = parseInt(searchParams.get('pageSize')!, 10);

    const result = await listPlanningItems(filters);
    return NextResponse.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    logger.error('Failed to list planning items', { error });
    return NextResponse.json({ success: false, error: { message: 'Failed to list planning items' } }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.project_id) return NextResponse.json({ success: false, error: { message: 'project_id is required' } }, { status: 400 });
    if (!body.title || !String(body.title).trim()) return NextResponse.json({ success: false, error: { message: 'title is required' } }, { status: 400 });
    if (body.stage && !PLANNING_STAGES.includes(body.stage)) return NextResponse.json({ success: false, error: { message: `Invalid stage. Must be one of: ${PLANNING_STAGES.join(', ')}` } }, { status: 400 });
    if (body.priority && !PLANNING_PRIORITIES.includes(body.priority)) return NextResponse.json({ success: false, error: { message: `Invalid priority. Must be one of: ${PLANNING_PRIORITIES.join(', ')}` } }, { status: 400 });

    const cookieStore = await cookies();
    const token = cookieStore.get('ff_auth_token')?.value;
    if (token) {
      const payload = await verifyToken(token);
      if (payload?.sub) body.created_by = payload.sub;
    }
    // Require an authenticated user (matches the NOC POST gate). Unauthenticated
    // callers cannot create planning items even though middleware only rate-limits.
    if (!body.created_by) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' }, meta: { timestamp: new Date().toISOString() } },
        { status: 401 },
      );
    }

    const item = await createPlanningItem(body);
    void logPlanningActivity({
      planningItemId: item.id,
      activityType: 'created',
      note: `Planning item created: ${item.item_uid}`,
      userId: body.created_by,
    });

    return NextResponse.json(
      { success: true, data: item, message: 'Planning item created', meta: { timestamp: new Date().toISOString() } },
      { status: 201 },
    );
  } catch (error) {
    logger.error('Failed to create planning item', { error });
    return NextResponse.json({ success: false, error: { message: 'Failed to create planning item' } }, { status: 500 });
  }
}
