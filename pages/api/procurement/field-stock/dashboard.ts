/**
 * Field Stock Dashboard API
 * GET /api/procurement/field-stock/dashboard - Get dashboard summary
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

interface DashboardSummary {
  locations: {
    total: number;
    byType: Record<string, number>;
  };
  items: {
    total: number;
    byCategory: Record<string, number>;
  };
  serials: {
    total: number;
    byStatus: Record<string, number>;
    recentlyInstalled: number;
  };
  consumptions: {
    today: number;
    thisWeek: number;
    unverified: number;
  };
  alerts: {
    lowStock: number;
    pendingReturns: number;
    blockedContractors: number;
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'GET') {
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
    }

    // Run all queries in parallel
    const [
      locationStats,
      itemStats,
      serialStats,
      consumptionStats,
      alertStats,
    ] = await Promise.all([
      // Location stats
      sql`
        SELECT
          COUNT(*) as total,
          location_type,
          COUNT(*) as count
        FROM stock_locations
        WHERE is_active = true
        GROUP BY location_type
      `,

      // Item stats
      sql`
        SELECT
          COUNT(*) OVER() as total,
          category,
          COUNT(*) as count
        FROM stock_items
        WHERE is_active = true
        GROUP BY category
      `,

      // Serial stats
      sql`
        SELECT
          COUNT(*) OVER() as total,
          status,
          COUNT(*) as count,
          SUM(CASE WHEN installed_date > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END) as recently_installed
        FROM stock_serials
        GROUP BY status
      `,

      // Consumption stats
      sql`
        SELECT
          COUNT(*) FILTER (WHERE consumption_date >= CURRENT_DATE) as today,
          COUNT(*) FILTER (WHERE consumption_date >= CURRENT_DATE - INTERVAL '7 days') as this_week,
          COUNT(*) FILTER (WHERE verified = false) as unverified
        FROM stock_consumptions
      `,

      // Alert stats
      sql`
        SELECT
          (SELECT COUNT(*) FROM stock_items WHERE qty_available <= min_stock_level AND min_stock_level > 0 AND is_active = true) as low_stock,
          (SELECT COUNT(*) FROM stock_returns WHERE status = 'pending') as pending_returns,
          (SELECT COUNT(*) FROM contractor_stock_accountability WHERE is_blocked = true) as blocked_contractors
      `,
    ]);

    // Build response
    const locationsByType: Record<string, number> = {};
    let totalLocations = 0;
    for (const row of locationStats) {
      locationsByType[row.location_type] = Number(row.count);
      totalLocations += Number(row.count);
    }

    const itemsByCategory: Record<string, number> = {};
    let totalItems = 0;
    for (const row of itemStats) {
      itemsByCategory[row.category] = Number(row.count);
      if (row.total) totalItems = Number(row.total);
    }

    const serialsByStatus: Record<string, number> = {};
    let totalSerials = 0;
    let recentlyInstalled = 0;
    for (const row of serialStats) {
      serialsByStatus[row.status] = Number(row.count);
      if (row.total) totalSerials = Number(row.total);
      recentlyInstalled += Number(row.recently_installed || 0);
    }

    const summary: DashboardSummary = {
      locations: {
        total: totalLocations,
        byType: locationsByType,
      },
      items: {
        total: totalItems,
        byCategory: itemsByCategory,
      },
      serials: {
        total: totalSerials,
        byStatus: serialsByStatus,
        recentlyInstalled,
      },
      consumptions: {
        today: Number(consumptionStats[0]?.today || 0),
        thisWeek: Number(consumptionStats[0]?.this_week || 0),
        unverified: Number(consumptionStats[0]?.unverified || 0),
      },
      alerts: {
        lowStock: Number(alertStats[0]?.low_stock || 0),
        pendingReturns: Number(alertStats[0]?.pending_returns || 0),
        blockedContractors: Number(alertStats[0]?.blocked_contractors || 0),
      },
    };

    return apiResponse.success(res, summary);
  } catch (error) {
    log.error('Field stock dashboard API error', error, 'field-stock/dashboard');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
