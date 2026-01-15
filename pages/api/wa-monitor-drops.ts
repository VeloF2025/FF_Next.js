/**
 * WA Monitor Drops API
 * GET /api/wa-monitor-drops
 *
 * Endpoints:
 * - GET /api/wa-monitor-drops - Get all drops with summary
 * - GET /api/wa-monitor-drops?id={id} - Get single drop by ID
 * - GET /api/wa-monitor-drops?status={status} - Get drops by status
 *
 * Returns QA review drop data from Neon PostgreSQL
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/modules/wa-monitor/lib/apiResponse';
import {
  getPaginatedDrops,
  getDropById,
  getDropsByStatus,
  calculateSummaryFast,
  getCompleteProjectStats,
} from '@/modules/wa-monitor/services/waMonitorService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { id, status, limit, search, page, skipSummary, dateFrom, dateTo } = req.query;

    // Get single drop by ID
    if (id && typeof id === 'string') {
      const drop = await getDropById(id);

      if (!drop) {
        return apiResponse.notFound(res, 'Drop', id);
      }

      return apiResponse.success(res, drop);
    }

    // Get drops by status
    if (status && typeof status === 'string') {
      if (status !== 'incomplete' && status !== 'complete') {
        return apiResponse.validationError(res, {
          status: 'Status must be either "incomplete" or "complete"',
        });
      }

      const drops = await getDropsByStatus(status);
      return apiResponse.success(res, drops);
    }

    // Parse pagination parameters
    const pageSize = 100; // Default page size (much smaller for better performance)
    let currentPage = 1;

    if (page && typeof page === 'string') {
      const parsedPage = parseInt(page, 10);
      if (!isNaN(parsedPage) && parsedPage > 0) {
        currentPage = parsedPage;
      }
    }

    // Handle backward compatibility with limit parameter
    let effectivePageSize = pageSize;
    if (limit && typeof limit === 'string') {
      const limitNum = parseInt(limit, 10);
      if (!isNaN(limitNum) && limitNum > 0) {
        effectivePageSize = Math.min(limitNum, 1000); // Max 1000
      }
    }

    // Use server-side pagination (much faster - only fetches requested page from DB)
    const searchTerm = search && typeof search === 'string' ? search : undefined;
    const result = await getPaginatedDrops(currentPage, effectivePageSize, searchTerm);

    // Optionally skip summary for faster initial load (can be fetched separately)
    let summary = null;
    if (skipSummary !== 'true') {
      summary = await calculateSummaryFast();
    }

    // Get complete project stats from ALL records (not limited by pagination)
    // This supports date range filtering for accurate per-project reports
    const dateFromStr = dateFrom && typeof dateFrom === 'string' ? dateFrom : undefined;
    const dateToStr = dateTo && typeof dateTo === 'string' ? dateTo : undefined;
    const projectStats = await getCompleteProjectStats(dateFromStr, dateToStr);

    // Return with summary and pagination info
    return res.status(200).json({
      success: true,
      data: result.drops,
      summary,
      projectStats, // Complete per-project stats from ALL matching records
      pagination: result.pagination,
      meta: {
        timestamp: new Date().toISOString(),
        dateFilter: dateFromStr || dateToStr ? { from: dateFromStr, to: dateToStr } : null,
      },
    });

  } catch (error: any) {
    console.error('Error in wa-monitor-drops API:', error);
    return apiResponse.internalError(res, error, 'Failed to fetch QA review drops');
  }
}
