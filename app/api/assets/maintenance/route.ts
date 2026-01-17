/**
 * Maintenance API Route
 * GET  /api/assets/maintenance - Get all maintenance records
 * POST /api/assets/maintenance - Schedule new maintenance
 */

import { NextRequest, NextResponse } from 'next/server';
import { maintenanceService } from '@/modules/assets/services';
import { ScheduleMaintenanceSchema } from '@/modules/assets/utils/schemas';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// ==================== GET /api/assets/maintenance ====================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const withinDays = searchParams.get('withinDays');

    if (withinDays) {
      const days = parseInt(withinDays, 10);
      const result = await maintenanceService.getUpcoming(days);

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      return NextResponse.json({ data: result.data });
    }

    // Default: get upcoming 30 days
    const result = await maintenanceService.getUpcoming(30);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ data: result.data });
  } catch (error) {
    log.error('Error fetching maintenance records:', { data: error }, 'assets:maintenance');
    return NextResponse.json(
      { error: 'Failed to fetch maintenance records' },
      { status: 500 }
    );
  }
}

// ==================== POST /api/assets/maintenance ====================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate request body
    const validation = ScheduleMaintenanceSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.errors },
        { status: 400 }
      );
    }

    // TODO: Get actual user from auth
    const createdBy = req.headers.get('x-user-id') || 'system';

    const result = await maintenanceService.schedule(validation.data, createdBy);

    if (!result.success) {
      if (result.error?.includes('not found')) {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ data: result.data }, { status: 201 });
  } catch (error) {
    log.error('Error scheduling maintenance:', { data: error }, 'assets:maintenance');
    return NextResponse.json(
      { error: 'Failed to schedule maintenance' },
      { status: 500 }
    );
  }
}
