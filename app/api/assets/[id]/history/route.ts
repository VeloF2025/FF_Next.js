/**
 * Asset Assignment History API Route
 * GET /api/assets/[id]/history - Get assignment history for an asset
 */

import { NextRequest, NextResponse } from 'next/server';
import { assignmentService } from '@/modules/assets/services';
import { requirePermission } from '@/lib/auth/app-router';
import { log } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ==================== GET /api/assets/[id]/history ====================

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    // Authenticate + authorize (reading an asset's history requires assets:view)
    const [, deny] = await requirePermission(req, 'assets', 'view');
    if (deny) return deny;

    const { id } = await params;

    const result = await assignmentService.getHistory(id);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ data: result.data });
  } catch (error) {
    log.error('Failed to fetch assignment history', { error }, 'assets:history');
    return NextResponse.json(
      { error: 'Failed to fetch assignment history' },
      { status: 500 }
    );
  }
}
