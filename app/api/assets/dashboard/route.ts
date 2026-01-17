/**
 * Assets Dashboard API Route
 * GET /api/assets/dashboard - Get dashboard statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { assetService, maintenanceService } from '@/modules/assets/services';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// ==================== GET /api/assets/dashboard ====================

export async function GET(req: NextRequest) {
  try {
    // Fetch both asset and maintenance stats in parallel
    const [assetStats, maintenanceStats] = await Promise.all([
      assetService.getDashboardStats(),
      maintenanceService.getDashboardStats(),
    ]);

    if (!assetStats.success) {
      return NextResponse.json({ error: assetStats.error }, { status: 500 });
    }

    if (!maintenanceStats.success) {
      return NextResponse.json({ error: maintenanceStats.error }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        assets: assetStats.data,
        maintenance: maintenanceStats.data,
      },
    });
  } catch (error) {
    log.error('Error fetching dashboard stats:', { data: error }, 'assets:dashboard');
    return NextResponse.json(
      { error: 'Failed to fetch dashboard statistics' },
      { status: 500 }
    );
  }
}
