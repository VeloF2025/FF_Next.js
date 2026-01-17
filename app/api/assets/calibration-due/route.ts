/**
 * Assets Calibration Due API Route
 * GET /api/assets/calibration-due - Get assets with calibration due/overdue
 */

import { NextRequest, NextResponse } from 'next/server';
import { assetService } from '@/modules/assets/services';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const days = searchParams.get('days');
    const withinDays = days ? parseInt(days, 10) : 30;

    if (isNaN(withinDays) || withinDays < 0) {
      return NextResponse.json(
        { error: 'Invalid days parameter' },
        { status: 400 }
      );
    }

    const result = await assetService.getCalibrationDue(withinDays);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Get overdue separately if days > 0
    let overdueCount = 0;
    if (withinDays > 0) {
      const overdueResult = await assetService.getCalibrationDue(0);
      if (overdueResult.success) {
        overdueCount = overdueResult.data.length;
      }
    }

    return NextResponse.json({
      data: {
        assets: result.data,
        summary: {
          total: result.data.length,
          overdue: overdueCount,
          dueSoon: result.data.length - overdueCount,
          withinDays,
        },
      },
    });
  } catch (error) {
    log.error('Error fetching calibration due assets:', { data: error }, 'assets:calibration-due');
    return NextResponse.json(
      { error: 'Failed to fetch calibration due assets' },
      { status: 500 }
    );
  }
}
