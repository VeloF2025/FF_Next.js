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
  getAllDrops,
  getDropById,
  getDropsByStatus,
  calculateSummary,
} from '@/modules/wa-monitor/services/waMonitorService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { id, status, limit, search, page } = req.query;

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

    // Get all drops with summary
    let drops = await getAllDrops();

    // Filter by search term if provided
    if (search && typeof search === 'string') {
      const searchTerm = search.toLowerCase();
      drops = drops.filter(drop =>
        drop.dropNumber.toLowerCase().includes(searchTerm) ||
        drop.project?.toLowerCase().includes(searchTerm)
      );
    }

    // Calculate total before pagination
    const totalDrops = drops.length;

    // Apply pagination
    const pageSize = 1000; // Max drops per page to prevent >4MB response
    let currentPage = 1;
    let paginatedDrops = drops;

    if (page && typeof page === 'string') {
      currentPage = parseInt(page, 10);
      if (!isNaN(currentPage) && currentPage > 0) {
        const offset = (currentPage - 1) * pageSize;
        paginatedDrops = drops.slice(offset, offset + pageSize);
      }
    } else if (limit && typeof limit === 'string') {
      // Backward compatibility: support old limit parameter
      const limitNum = parseInt(limit, 10);
      if (!isNaN(limitNum) && limitNum > 0) {
        paginatedDrops = drops.slice(0, limitNum);
      }
    } else {
      // Default: first page only
      paginatedDrops = drops.slice(0, pageSize);
    }

    const summary = await calculateSummary();
    const totalPages = Math.ceil(totalDrops / pageSize);

    // Return with summary and pagination info
    return res.status(200).json({
      success: true,
      data: paginatedDrops,
      summary,
      pagination: {
        currentPage,
        pageSize,
        totalDrops,
        totalPages,
        hasNextPage: currentPage < totalPages,
        hasPreviousPage: currentPage > 1,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });

  } catch (error: any) {
    console.error('Error in wa-monitor-drops API:', error);
    return apiResponse.internalError(res, error, 'Failed to fetch QA review drops');
  }
}
