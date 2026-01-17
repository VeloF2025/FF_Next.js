/**
 * Upcoming Maintenance API Route
 * GET /api/assets/maintenance/upcoming - Get upcoming maintenance
 */

import { NextRequest, NextResponse } from 'next/server';
import { maintenanceService } from '@/modules/assets/services';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// ==================== GET /api/assets/maintenance/upcoming ====================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const days = searchParams.get('days');
    const withinDays = days ? parseInt(days, 10) : 30;

    const result = await maintenanceService.getUpcoming(withinDays);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ data: result.data });
  } catch (error) {
    log.error('Error fetching upcoming maintenance:', { data: error }, 'assets:maintenance:upcoming');
    return NextResponse.json(
      { error: 'Failed to fetch upcoming maintenance' },
      { status: 500 }
    );
  }
}
