/**
 * Asset Maintenance API Route
 * GET  /api/assets/[id]/maintenance - Get maintenance records for an asset
 * POST /api/assets/[id]/maintenance - Schedule maintenance for an asset
 */

import { NextRequest, NextResponse } from 'next/server';
import { maintenanceService } from '@/modules/assets/services';
import { ScheduleMaintenanceSchema, MaintenanceFilterSchema } from '@/modules/assets/utils/schemas';
import { log } from '@/lib/logger';
import { requireAuth } from '@/lib/auth/app-router';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ==================== GET /api/assets/[id]/maintenance ====================

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);

    // Parse filters
    const rawFilters = {
      maintenanceType: searchParams.getAll('maintenanceType').filter(Boolean) || undefined,
      status: searchParams.getAll('status').filter(Boolean) || undefined,
    };

    const filters = Object.fromEntries(
      Object.entries(rawFilters).filter(([_, v]) => v !== undefined && (Array.isArray(v) ? v.length > 0 : true))
    );

    const result = await maintenanceService.getByAsset(id, filters);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ data: result.data });
  } catch (error) {
    log.error('Error fetching maintenance records:', { data: error }, 'assets:id:maintenance');
    return NextResponse.json(
      { error: 'Failed to fetch maintenance records' },
      { status: 500 }
    );
  }
}

// ==================== POST /api/assets/[id]/maintenance ====================

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await req.json();

    // Add asset ID from URL to body
    const maintenanceData = { ...body, assetId: id };

    // Validate request body
    const validation = ScheduleMaintenanceSchema.safeParse(maintenanceData);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.errors },
        { status: 400 }
      );
    }

    // Authenticate request (user identity from JWT, never from client headers)
    const [user, unauth] = await requireAuth(req);
    if (unauth) return unauth;

    const createdBy = user.id;

    const result = await maintenanceService.schedule(validation.data, createdBy);

    if (!result.success) {
      if (result.error?.includes('not found')) {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ data: result.data }, { status: 201 });
  } catch (error) {
    log.error('Error scheduling maintenance:', { data: error }, 'assets:id:maintenance');
    return NextResponse.json(
      { error: 'Failed to schedule maintenance' },
      { status: 500 }
    );
  }
}
