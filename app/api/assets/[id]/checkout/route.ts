/**
 * Asset Checkout API Route
 * POST /api/assets/[id]/checkout - Checkout an asset
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { assignmentService } from '@/modules/assets/services';
import { CheckoutAssetSchema } from '@/modules/assets/utils/schemas';
import { requireAuth } from '@/lib/auth/app-router';
import { log } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ==================== POST /api/assets/[id]/checkout ====================

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await req.json();

    // Add asset ID from URL to body
    const checkoutData = { ...body, assetId: id };

    // Validate request body
    const validation = CheckoutAssetSchema.safeParse(checkoutData);
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

    const result = await assignmentService.checkout(validation.data, createdBy);

    if (!result.success) {
      if (result.error?.includes('not found')) {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Revalidate asset pages (checkout changes available → assigned counts)
    revalidatePath('/assets');
    revalidatePath('/assets/list');
    revalidatePath(`/assets/${id}`);

    return NextResponse.json({ data: result.data }, { status: 201 });
  } catch (error) {
    log.error('Error checking out asset', { error });
    return NextResponse.json(
      { error: 'Failed to checkout asset' },
      { status: 500 }
    );
  }
}
