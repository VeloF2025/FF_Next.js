/**
 * Asset Categories API Route
 * GET  /api/assets/categories - List all categories
 * POST /api/assets/categories - Create new category
 */

import { NextRequest, NextResponse } from 'next/server';
import { categoryService } from '@/modules/assets/services';
import { CategorySchema } from '@/modules/assets/utils/schemas';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// ==================== GET /api/assets/categories ====================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Parse filters
    const isActive = searchParams.get('isActive');
    const type = searchParams.get('type');

    const filter: { isActive?: boolean; type?: string } = {};
    if (isActive !== null) {
      filter.isActive = isActive === 'true';
    }
    if (type) {
      filter.type = type;
    }

    const result = await categoryService.getAll(
      Object.keys(filter).length > 0 ? filter : undefined
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ data: result.data });
  } catch (error) {
    log.error('Error fetching categories:', { data: error }, 'assets:categories');
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}

// ==================== POST /api/assets/categories ====================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate request body
    const validation = CategorySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.errors },
        { status: 400 }
      );
    }

    const result = await categoryService.create(validation.data);

    if (!result.success) {
      if (result.error?.includes('already exists')) {
        return NextResponse.json({ error: result.error }, { status: 409 });
      }
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ data: result.data }, { status: 201 });
  } catch (error) {
    log.error('Error creating category:', { data: error }, 'assets:categories');
    return NextResponse.json(
      { error: 'Failed to create category' },
      { status: 500 }
    );
  }
}
