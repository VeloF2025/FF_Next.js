/**
 * Assets API Route - List and Create
 * GET  /api/assets - List all assets with optional filters
 * POST /api/assets - Create new asset
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { assetService } from '@/modules/assets/services';
import { AssetFilterSchema, CreateAssetSchema } from '@/modules/assets/utils/schemas';
import { log } from '@/lib/logger';
import { requireAuth } from '@/lib/auth/app-router';

export const dynamic = 'force-dynamic';

// ==================== GET /api/assets ====================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Parse filters from query params
    const rawFilters = {
      searchTerm: searchParams.get('search') || undefined,
      status: searchParams.getAll('status').filter(Boolean) || undefined,
      categoryId: searchParams.getAll('categoryId').filter(Boolean) || undefined,
      condition: searchParams.getAll('condition').filter(Boolean) || undefined,
      calibrationDueWithinDays: searchParams.get('calibrationDueWithinDays')
        ? parseInt(searchParams.get('calibrationDueWithinDays')!, 10)
        : undefined,
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined,
    };

    // Remove undefined values
    const filters = Object.fromEntries(
      Object.entries(rawFilters).filter(([_, v]) => v !== undefined && (Array.isArray(v) ? v.length > 0 : true))
    );

    // Validate filters
    const validation = AssetFilterSchema.safeParse(filters);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid filter parameters', details: validation.error.errors },
        { status: 400 }
      );
    }

    const result = await assetService.getAll(validation.data);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    log.error('Error fetching assets:', { data: error }, 'assets:list');
    return NextResponse.json(
      { error: 'Failed to fetch assets' },
      { status: 500 }
    );
  }
}

// ==================== POST /api/assets ====================

export async function POST(req: NextRequest) {
  try {
    // Authenticate request (user identity from JWT, never from client headers)
    const [user, unauth] = await requireAuth(req);
    if (unauth) return unauth;

    const body = await req.json();

    // Validate request body
    const validation = CreateAssetSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.errors },
        { status: 400 }
      );
    }

    const createdBy = user.id;

    const result = await assetService.create(validation.data, createdBy);

    if (!result.success) {
      // Duplicate-value errors: return 409 Conflict so clients can distinguish
      // "bad input" from "uniqueness collision".
      const isDuplicate = /already exists/i.test(result.error || '');
      return NextResponse.json({ error: result.error }, { status: isDuplicate ? 409 : 400 });
    }

    // Revalidate asset pages (new asset affects counts)
    revalidatePath('/assets');
    revalidatePath('/assets/list');

    return NextResponse.json({ data: result.data }, { status: 201 });
  } catch (error) {
    log.error('Error creating asset:', { data: error }, 'assets:create');
    return NextResponse.json(
      { error: 'Failed to create asset' },
      { status: 500 }
    );
  }
}
