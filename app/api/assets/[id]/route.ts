/**
 * Single Asset API Route
 * GET    /api/assets/[id] - Get asset by ID
 * PUT    /api/assets/[id] - Update asset
 * DELETE /api/assets/[id] - Delete asset
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { assetService } from '@/modules/assets/services';
import { UpdateAssetSchema } from '@/modules/assets/utils/schemas';
import { requireAuth } from '@/lib/auth/app-router';
import { log } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ==================== GET /api/assets/[id] ====================

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const result = await assetService.getById(id);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    if (!result.data) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    return NextResponse.json({ data: result.data });
  } catch (error) {
    log.error('Error fetching asset', { error });
    return NextResponse.json(
      { error: 'Failed to fetch asset' },
      { status: 500 }
    );
  }
}

// ==================== PUT /api/assets/[id] ====================

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await req.json();

    // Validate request body
    const validation = UpdateAssetSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.errors },
        { status: 400 }
      );
    }

    // Authenticate request (user identity from JWT, never from client headers)
    const [user, unauth] = await requireAuth(req);
    if (unauth) return unauth;

    const updatedBy = user.id;

    const result = await assetService.update(id, validation.data, updatedBy);

    if (!result.success) {
      if (result.error === 'Asset not found') {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Revalidate asset pages (status changes affect counts)
    revalidatePath('/assets');
    revalidatePath('/assets/list');
    revalidatePath(`/assets/${id}`);

    return NextResponse.json({ data: result.data });
  } catch (error) {
    log.error('Error updating asset', { error });
    return NextResponse.json(
      { error: 'Failed to update asset' },
      { status: 500 }
    );
  }
}

// ==================== DELETE /api/assets/[id] ====================

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const result = await assetService.delete(id);

    if (!result.success) {
      if (result.error === 'Asset not found') {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Revalidate asset pages to update counts
    revalidatePath('/assets');
    revalidatePath('/assets/list');

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    log.error('Error deleting asset', { error });
    return NextResponse.json(
      { error: 'Failed to delete asset' },
      { status: 500 }
    );
  }
}
