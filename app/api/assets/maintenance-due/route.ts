/**
 * Assets Maintenance Due API Route
 * GET /api/assets/maintenance-due - Get assets with maintenance due
 */

import { NextRequest, NextResponse } from 'next/server';
import { assetService } from '@/modules/assets/services';
import { requirePermission } from '@/lib/auth/app-router';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // Authenticate + authorize (reading maintenance data requires assets.maintenance:view)
    const [, deny] = await requirePermission(req, 'assets.maintenance', 'view');
    if (deny) return deny;

    const { searchParams } = new URL(req.url);
    const days = searchParams.get('days');
    const withinDays = days ? parseInt(days, 10) : 30;

    if (isNaN(withinDays) || withinDays < 0) {
      return NextResponse.json(
        { error: 'Invalid days parameter' },
        { status: 400 }
      );
    }

    const result = await assetService.getMaintenanceDue(withinDays);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        assets: result.data,
        summary: {
          total: result.data.length,
          withinDays,
        },
      },
    });
  } catch (error) {
    log.error('Error fetching maintenance due assets:', { data: error }, 'assets:maintenance-due');
    return NextResponse.json(
      { error: 'Failed to fetch maintenance due assets' },
      { status: 500 }
    );
  }
}
