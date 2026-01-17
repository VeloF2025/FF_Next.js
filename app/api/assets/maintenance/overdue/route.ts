/**
 * Overdue Maintenance API Route
 * GET  /api/assets/maintenance/overdue - Get overdue maintenance
 * POST /api/assets/maintenance/overdue - Update overdue status (cron job)
 */

import { NextRequest, NextResponse } from 'next/server';
import { maintenanceService } from '@/modules/assets/services';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// ==================== GET /api/assets/maintenance/overdue ====================

export async function GET(req: NextRequest) {
  try {
    const result = await maintenanceService.getOverdue();

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ data: result.data });
  } catch (error) {
    log.error('Error fetching overdue maintenance:', { data: error }, 'assets:maintenance:overdue');
    return NextResponse.json(
      { error: 'Failed to fetch overdue maintenance' },
      { status: 500 }
    );
  }
}

// ==================== POST /api/assets/maintenance/overdue ====================
// Used by cron job to update overdue status

export async function POST(req: NextRequest) {
  try {
    // Verify cron secret for security
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await maintenanceService.updateOverdueStatus();

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    log.error('Error updating overdue status:', { data: error }, 'assets:maintenance:overdue');
    return NextResponse.json(
      { error: 'Failed to update overdue status' },
      { status: 500 }
    );
  }
}
