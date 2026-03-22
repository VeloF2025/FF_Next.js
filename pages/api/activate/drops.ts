/**
 * DR Photo Unified Drops API
 * GET /api/activate/drops
 *
 * Thin HTTP handler — all business logic lives in:
 *   src/modules/activate/services/drops/
 *
 * Query params:
 *   id           - fetch single drop by UUID
 *   dropNumber   - fetch single drop by drop number
 *   page         - page number (default 1)
 *   search       - text search across drop_number and project
 *   skipSummary  - 'true' to skip the summary aggregation query
 *   dateFrom     - ISO date lower bound (submitted_date)
 *   dateTo       - ISO date upper bound (submitted_date)
 *   project      - filter by project name ('all' = no filter)
 *   status       - reviewed | not_reviewed | notReviewed | activated | installed
 *   qaStatus     - pending | passed | failed | rework
 *   serialStatus - valid | swapped | missing | invalid
 *   resubmissionsOnly - 'true' to show only resubmissions
 *   reviewSource - ai_pending | ai_reviewed | human_reviewed | not_reviewed
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  getDropById,
  getDropByDropNumber,
  getPaginatedDrops,
  getActiveProjects,
} from '@/modules/activate/services/drops/dropQueryService';
import { calculateSummary } from '@/modules/activate/services/drops/dropStatsService';
import { getProjectStats } from '@/modules/activate/services/drops/dropProjectStatsService';
import {
  syncMissingFromQaPhotoReviews,
  processOrphanedRecordsInBackground,
} from '@/modules/activate/services/drops/dropSyncService';
import type { DropsFilters } from '@/modules/activate/services/drops/types';

const PAGE_SIZE = 100;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }

  try {
    const {
      id,
      dropNumber,
      search,
      page,
      skipSummary,
      dateFrom,
      dateTo,
      project,
      status,
      qaStatus,
      serialStatus,
      resubmissionsOnly,
      reviewSource,
    } = req.query;

    // Single-drop lookups
    if (id && typeof id === 'string') {
      const drop = await getDropById(id);
      if (!drop) return apiResponse.notFound(res, 'Drop', id);
      return apiResponse.success(res, drop);
    }

    if (dropNumber && typeof dropNumber === 'string') {
      const drop = await getDropByDropNumber(dropNumber);
      if (!drop) return apiResponse.notFound(res, 'Drop', dropNumber);
      return apiResponse.success(res, drop);
    }

    // Parse page number
    let currentPage = 1;
    if (page && typeof page === 'string') {
      const parsedPage = parseInt(page, 10);
      if (!isNaN(parsedPage) && parsedPage > 0) currentPage = parsedPage;
    }

    const searchTerm = search && typeof search === 'string' ? search : undefined;

    const filters: DropsFilters = {
      dateFrom: dateFrom && typeof dateFrom === 'string' ? dateFrom : undefined,
      dateTo: dateTo && typeof dateTo === 'string' ? dateTo : undefined,
      project: project && typeof project === 'string' ? project : undefined,
      status: status && typeof status === 'string' ? status : undefined,
      qaStatus: qaStatus && typeof qaStatus === 'string' ? qaStatus : undefined,
      serialStatus: serialStatus && typeof serialStatus === 'string' ? serialStatus : undefined,
      resubmissionsOnly: resubmissionsOnly === 'true',
      reviewSource: reviewSource && typeof reviewSource === 'string' ? reviewSource : undefined,
      search: searchTerm,
    };

    // Throttled auto-sync (once per 5 minutes)
    await syncMissingFromQaPhotoReviews();

    // Run all queries in parallel
    const [result, summary, projectStats, activeProjects] = await Promise.all([
      getPaginatedDrops(currentPage, PAGE_SIZE, filters),
      skipSummary === 'true' ? Promise.resolve(null) : calculateSummary(filters),
      getProjectStats(filters),
      getActiveProjects(),
    ]);

    log.info(`Fetched ${result.drops.length} drops`, {
      page: currentPage,
      totalCount: result.pagination.totalCount,
    }, 'DrPhotoUnifiedDropsAPI');

    processOrphanedRecordsInBackground();

    const hasActiveFilters =
      filters.dateFrom ||
      filters.dateTo ||
      filters.project ||
      filters.status ||
      filters.qaStatus ||
      filters.resubmissionsOnly;

    return res.status(200).json({
      success: true,
      data: result.drops,
      summary,
      projectStats,
      activeProjects,
      pagination: result.pagination,
      meta: {
        timestamp: new Date().toISOString(),
        filters: hasActiveFilters ? filters : null,
      },
    });
  } catch (error: unknown) {
    log.error('Error fetching drops', { error }, 'DrPhotoUnifiedDropsAPI');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
