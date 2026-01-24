/**
 * Fleet Expiring Items API
 * GET: Get all expiring items (license discs, insurance, leases) within a time window
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { ExpiringItem, ExpiringItemRow } from '@/modules/fleet/types';
import { rowToExpiringItem } from '@/modules/fleet/types';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['GET']);
  }

  try {
    const { urgency, type, vehicleId, limit } = req.query;

    // Build the query - start with the view
    let rows: ExpiringItemRow[];

    // For simplicity, we'll query the view directly and filter in JS
    // since parameterized queries with IN clauses are complex
    const allRows = await sql`
      SELECT *
      FROM fleet_expiring_items
      ORDER BY days_until_expiry ASC
    ` as ExpiringItemRow[];

    // Filter based on query params
    rows = allRows.filter(row => {
      if (urgency && typeof urgency === 'string') {
        const urgencies = urgency.split(',');
        if (!urgencies.includes(row.urgency)) return false;
      }
      if (type && typeof type === 'string') {
        if (row.item_type !== type) return false;
      }
      if (vehicleId && typeof vehicleId === 'string') {
        if (row.vehicle_id !== vehicleId) return false;
      }
      return true;
    });

    // Apply limit
    if (limit && typeof limit === 'string') {
      const limitNum = parseInt(limit, 10);
      if (limitNum > 0) {
        rows = rows.slice(0, limitNum);
      }
    }

    const items: ExpiringItem[] = rows.map(rowToExpiringItem);

    // Calculate summary
    const summary = {
      total: items.length,
      overdue: items.filter(i => i.urgency === 'overdue').length,
      critical: items.filter(i => i.urgency === 'critical').length,
      warning: items.filter(i => i.urgency === 'warning').length,
      byType: {
        license_disc: items.filter(i => i.itemType === 'license_disc').length,
        insurance: items.filter(i => i.itemType === 'insurance').length,
        lease: items.filter(i => i.itemType === 'lease').length,
      },
    };

    log.info('Fetched expiring items', { summary });

    return apiResponse.success(res, {
      items,
      summary,
    });
  } catch (error) {
    log.error('Fleet expiring items API error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
