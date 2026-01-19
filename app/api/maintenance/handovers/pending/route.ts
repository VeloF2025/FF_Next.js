/**
 * Pending Handovers API
 *
 * GET /api/ticketing/handovers/pending - List tickets pending handover
 *
 * Query Parameters:
 * - handover_type: Filter by type (BUILD_TO_QA, QA_TO_MAINTENANCE, MAINTENANCE_COMPLETE)
 * - project_id: Filter by project
 * - limit: Pagination limit (default: 50)
 * - offset: Pagination offset (default: 0)
 *
 * 🟢 WORKING: Production-ready pending handovers list endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getPendingHandovers } from '@/modules/maintenance/services/handoverService';
import { HandoverType } from '@/modules/maintenance/types/handover';

const logger = createLogger('ticketing:api:handovers:pending');

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Parse query parameters
    const handoverTypeParam = searchParams.get('handover_type');
    const projectId = searchParams.get('project_id');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    logger.info('Fetching pending handovers', {
      handover_type: handoverTypeParam,
      project_id: projectId,
      limit,
      offset
    });

    // Build filters
    const filters: {
      handover_type?: HandoverType;
      project_id?: string;
    } = {};

    // Validate handover type
    if (handoverTypeParam) {
      const validTypes = Object.values(HandoverType);
      if (!validTypes.includes(handoverTypeParam as HandoverType)) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid handover_type. Valid values: ${validTypes.join(', ')}`
          },
          { status: 400 }
        );
      }
      filters.handover_type = handoverTypeParam as HandoverType;
    }

    // Add project filter
    if (projectId) {
      filters.project_id = projectId;
    }

    // Fetch pending handovers
    const { tickets, total } = await getPendingHandovers(filters, limit, offset);

    // Calculate summary counts
    const summary = {
      ready_for_handover: tickets.filter(t => t.can_handover).length,
      blocked: tickets.filter(t => !t.can_handover).length,
      by_type: {
        BUILD_TO_QA: tickets.filter(t => t.pending_handover_type === HandoverType.BUILD_TO_QA).length,
        QA_TO_MAINTENANCE: tickets.filter(t => t.pending_handover_type === HandoverType.QA_TO_OPS).length,
        MAINTENANCE_COMPLETE: tickets.filter(t => t.pending_handover_type === HandoverType.OPS_COMPLETE).length
      }
    };

    logger.info('Pending handovers fetched successfully', {
      total,
      returned: tickets.length,
      ready: summary.ready_for_handover,
      blocked: summary.blocked
    });

    return NextResponse.json({
      success: true,
      data: tickets,
      pagination: {
        total,
        limit,
        offset,
        has_more: offset + tickets.length < total
      },
      summary
    });
  } catch (error) {
    logger.error('Error fetching pending handovers', { error });

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch pending handovers'
      },
      { status: 500 }
    );
  }
}
