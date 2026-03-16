/**
 * Asset Check-in API Route
 * POST /api/assets/[id]/checkin - Check in an asset
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { assignmentService } from '@/modules/assets/services';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ==================== POST /api/assets/[id]/checkin ====================

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: assetId } = await params;
    const body = await req.json();

    // Get the active assignment for this asset
    const activeResult = await assignmentService.getActiveAssignment(assetId);

    if (!activeResult.success || !activeResult.data) {
      return NextResponse.json(
        { error: 'No active assignment found for this asset' },
        { status: 404 }
      );
    }

    const assignmentId = activeResult.data.id;

    // Prepare checkin data
    const checkinData = {
      assignmentId,
      conditionAtCheckin: body.conditionAtCheckin || 'good',
      checkinNotes: body.checkinNotes,
      newLocation: body.newLocation,
      maintenanceRequired: body.maintenanceRequired || false,
    };

    // Authenticate request (user identity from JWT, never from client headers)
    const [user, unauth] = await requireAuth(req);
    if (unauth) return unauth;

    const checkedInBy = user.id;

    const result = await assignmentService.checkin(checkinData, checkedInBy);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Revalidate asset pages (checkin changes assigned → available counts)
    revalidatePath('/assets');
    revalidatePath('/assets/list');
    revalidatePath(`/assets/${assetId}`);

    return NextResponse.json({
      data: result.data,
      message: 'Asset checked in successfully'
    }, { status: 200 });
  } catch (error) {
    console.error('Error checking in asset:', error);
    return NextResponse.json(
      { error: 'Failed to check in asset' },
      { status: 500 }
    );
  }
}
