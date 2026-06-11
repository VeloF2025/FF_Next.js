/**
 * Single Category API Route
 * GET    /api/assets/categories/[id] - Get category by ID
 * PUT    /api/assets/categories/[id] - Update category
 * DELETE /api/assets/categories/[id] - Delete category
 */

import { NextRequest, NextResponse } from 'next/server';
import { categoryService } from '@/modules/assets/services';
import { CategorySchema } from '@/modules/assets/utils/schemas';
import { requirePermission } from '@/lib/auth/app-router';
import { log } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ==================== GET /api/assets/categories/[id] ====================

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    // Authenticate + authorize (reading a category requires assets.categories:view)
    const [, deny] = await requirePermission(req, 'assets.categories', 'view');
    if (deny) return deny;

    const { id } = await params;

    const result = await categoryService.getById(id);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    if (!result.data) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    return NextResponse.json({ data: result.data });
  } catch (error) {
    log.error('Error fetching category', { error });
    return NextResponse.json(
      { error: 'Failed to fetch category' },
      { status: 500 }
    );
  }
}

// ==================== PUT /api/assets/categories/[id] ====================

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Authenticate + authorize (updating a category requires assets.categories:edit)
    const [, deny] = await requirePermission(req, 'assets.categories', 'edit');
    if (deny) return deny;

    const body = await req.json();

    // Partial validation - all fields optional for update
    const validation = CategorySchema.partial().safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.errors },
        { status: 400 }
      );
    }

    const result = await categoryService.update(id, validation.data);

    if (!result.success) {
      if (result.error === 'Category not found') {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ data: result.data });
  } catch (error) {
    log.error('Error updating category', { error });
    return NextResponse.json(
      { error: 'Failed to update category' },
      { status: 500 }
    );
  }
}

// ==================== DELETE /api/assets/categories/[id] ====================

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Authenticate + authorize (deleting a category requires assets.categories:delete)
    const [, deny] = await requirePermission(req, 'assets.categories', 'delete');
    if (deny) return deny;

    const result = await categoryService.delete(id);

    if (!result.success) {
      if (result.error?.includes('has assets')) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    log.error('Error deleting category', { error });
    return NextResponse.json(
      { error: 'Failed to delete category' },
      { status: 500 }
    );
  }
}
