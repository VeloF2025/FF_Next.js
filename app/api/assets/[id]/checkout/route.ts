/**
 * Asset Checkout API Route
 * POST /api/assets/[id]/checkout - Checkout an asset
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { assignmentService } from '@/modules/assets/services';
import { CheckoutAssetSchema } from '@/modules/assets/utils/schemas';
import { requireAuth } from '@/lib/auth/app-router';
import { userHasPermission } from '@/lib/permissions';
import { log } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ==================== POST /api/assets/[id]/checkout ====================

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Authenticate request (user identity from JWT, never from client headers)
    const [user, unauth] = await requireAuth(req);
    if (unauth) return unauth;

    // Authorize: performing a checkout requires the assets.checkout grant.
    // super_admin bypasses inside userHasPermission.
    if (!(await userHasPermission(user.id, 'assets.checkout', 'create'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

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
