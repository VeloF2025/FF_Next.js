/**
 * Single Maintenance Record API Route
 * GET  /api/assets/maintenance/[id] - Get maintenance by ID
 * PUT  /api/assets/maintenance/[id] - Complete maintenance
 * DELETE /api/assets/maintenance/[id] - Cancel maintenance
 */

import { NextRequest, NextResponse } from 'next/server';
import { maintenanceService } from '@/modules/assets/services';
import { CompleteMaintenanceSchema } from '@/modules/assets/utils/schemas';
import { log } from '@/lib/logger';
import { requireAuth } from '@/lib/auth/app-router';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ==================== GET /api/assets/maintenance/[id] ====================

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const result = await maintenanceService.getById(id);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    if (!result.data) {
      return NextResponse.json({ error: 'Maintenance record not found' }, { status: 404 });
    }

    return NextResponse.json({ data: result.data });
  } catch (error) {
    log.error('Error fetching maintenance:', { data: error }, 'assets:maintenance:id');
    return NextResponse.json(
      { error: 'Failed to fetch maintenance record' },
      { status: 500 }
    );
  }
}

// ==================== PUT /api/assets/maintenance/[id] ====================

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    // Authenticate request (user identity from JWT, never from client headers)
    const [user, unauth] = await requireAuth(req);
    if (unauth) return unauth;

    const { id } = await params;
    const body = await req.json();

    // Add maintenance ID from URL to body
    const completeData = { ...body, maintenanceId: id };

    // Validate request body
    const validation = CompleteMaintenanceSchema.safeParse(completeData);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.errors },
        { status: 400 }
      );
    }

    const completedBy = user.id;

    const result = await maintenanceService.complete(validation.data, completedBy);

    if (!result.success) {
      if (result.error?.includes('not found')) {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ data: result.data });
  } catch (error) {
    log.error('Error completing maintenance:', { data: error }, 'assets:maintenance:id');
    return NextResponse.json(
      { error: 'Failed to complete maintenance' },
      { status: 500 }
    );
  }
}

// ==================== DELETE /api/assets/maintenance/[id] ====================

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    // Authenticate request (user identity from JWT, never from client headers)
    const [user, unauth] = await requireAuth(req);
    if (unauth) return unauth;

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const reason = searchParams.get('reason') || 'Cancelled';

    const cancelledBy = user.id;

    const result = await maintenanceService.cancel(id, reason, cancelledBy);

    if (!result.success) {
      if (result.error?.includes('not found')) {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ data: result.data });
  } catch (error) {
    log.error('Error cancelling maintenance:', { data: error }, 'assets:maintenance:id');
    return NextResponse.json(
      { error: 'Failed to cancel maintenance' },
      { status: 500 }
    );
  }
}
