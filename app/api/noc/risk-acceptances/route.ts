/**
 * Risk Acceptances API - Global List
 *
 * GET /api/noc/risk-acceptances - List all risk acceptances with filters
 *
 * Query Parameters:
 * - status: Filter by status (active, resolved, expired, escalated) - can be comma-separated
 * - expiring_within_days: Filter risks expiring within N days
 * - project_id: Filter by project
 * - limit: Pagination limit (default: 50)
 * - offset: Pagination offset (default: 0)
 *
 * 🟢 WORKING: Production-ready global risk acceptance list endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { listAllRiskAcceptances, getExpiringRisks } from '@/modules/noc/services/riskAcceptanceService';
import { RiskAcceptanceStatus } from '@/modules/noc/types/riskAcceptance';

const logger = createLogger('maintenance:api:risk-acceptances');

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Parse query parameters
    const statusParam = searchParams.get('status');
    const expiringWithinDays = searchParams.get('expiring_within_days');
    const projectId = searchParams.get('project_id');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    logger.info('Fetching risk acceptances', {
      status: statusParam,
      expiring_within_days: expiringWithinDays,
      project_id: projectId,
      limit,
      offset
    });

    // Build filters
    const filters: {
      status?: RiskAcceptanceStatus | RiskAcceptanceStatus[];
      expiring_within_days?: number;
      project_id?: string;
    } = {};

    // Parse status (can be comma-separated)
    if (statusParam) {
      const statuses = statusParam.split(',').map(s => s.trim() as RiskAcceptanceStatus);
      // Validate status values
      const validStatuses = Object.values(RiskAcceptanceStatus);
      const invalidStatuses = statuses.filter(s => !validStatuses.includes(s));
      if (invalidStatuses.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid status values: ${invalidStatuses.join(', ')}. Valid values: ${validStatuses.join(', ')}`
          },
          { status: 400 }
        );
      }
      filters.status = statuses.length === 1 ? statuses[0] : statuses;
    }

    // Parse expiring_within_days
    if (expiringWithinDays) {
      const days = parseInt(expiringWithinDays, 10);
      if (isNaN(days) || days < 0) {
        return NextResponse.json(
          { success: false, error: 'expiring_within_days must be a positive number' },
          { status: 400 }
        );
      }
      filters.expiring_within_days = days;
    }

    // Add project filter
    if (projectId) {
      filters.project_id = projectId;
    }

    // Fetch risk acceptances
    const { risks, total } = await listAllRiskAcceptances(filters, limit, offset);

    // Calculate counts by status for summary
    const counts = {
      active: 0,
      resolved: 0,
      expired: 0,
      escalated: 0
    };

    // If no status filter, get counts from a separate query
    if (!filters.status && !filters.expiring_within_days) {
      // Count all statuses
      const allRisks = await listAllRiskAcceptances({}, 1000, 0);
      allRisks.risks.forEach(r => {
        if (r.status in counts) {
          counts[r.status as keyof typeof counts]++;
        }
      });
    }

    logger.info('Risk acceptances fetched successfully', {
      total,
      returned: risks.length
    });

    return NextResponse.json({
      success: true,
      data: risks,
      pagination: {
        total,
        limit,
        offset,
        has_more: offset + risks.length < total
      },
      counts
    });
  } catch (error) {
    logger.error('Error fetching risk acceptances', { error });

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch risk acceptances'
      },
      { status: 500 }
    );
  }
}
