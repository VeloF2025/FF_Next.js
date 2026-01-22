/**
 * QContact Status Discovery Endpoint
 * 🟢 WORKING: Fetches all QContact tickets to discover unique status values
 *
 * Used to understand what statuses QContact uses before creating a mapping
 * to FibreFlow's 11-status workflow.
 *
 * @endpoint GET /api/maintenance/qcontact/discover-statuses
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import {
  createFiberTimeQContactClient,
  FiberTimeCase,
} from '@/modules/maintenance/services/fibertimeQContactClient';

const logger = createLogger('qcontact-discover-statuses');

interface DiscoveryResult {
  /** Unique status values found */
  statuses: string[];
  /** Count of tickets per status */
  counts: Record<string, number>;
  /** Sample tickets for each status (first 3) */
  samples: Record<string, { id: string; label: string; created_at: string }[]>;
  /** Total tickets scanned */
  totalScanned: number;
  /** Number of pages fetched */
  pagesFetched: number;
  /** Timestamp of discovery */
  discoveredAt: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown');
  }

  try {
    logger.info('Starting QContact status discovery');

    const client = createFiberTimeQContactClient();

    // Check if client is configured
    const isHealthy = await client.healthCheck();
    if (!isHealthy) {
      logger.error('QContact client health check failed');
      return apiResponse.internalError(res, new Error('QContact API not accessible - check credentials'));
    }

    const statusCounts: Record<string, number> = {};
    const statusSamples: Record<string, { id: string; label: string; created_at: string }[]> = {};
    let totalScanned = 0;
    let page = 1;
    const pageSize = 50;
    let hasMore = true;

    // Fetch all pages
    while (hasMore) {
      logger.debug(`Fetching page ${page}`);

      const response = await client.listCases({
        page,
        pageSize,
      });

      const cases = response.results || [];
      totalScanned += cases.length;

      // Process each case
      for (const ftCase of cases) {
        // Get status from both fields (raw and display)
        const status = ftCase.status || ftCase.__status || 'unknown';

        // Count occurrences
        statusCounts[status] = (statusCounts[status] || 0) + 1;

        // Keep first 3 samples per status
        if (!statusSamples[status]) {
          statusSamples[status] = [];
        }
        if (statusSamples[status].length < 3) {
          statusSamples[status].push({
            id: String(ftCase.id),
            label: ftCase.label,
            created_at: ftCase.created_at,
          });
        }
      }

      // Check if more pages exist
      if (cases.length < pageSize) {
        hasMore = false;
      } else {
        page++;
        // Safety limit to prevent infinite loops
        if (page > 100) {
          logger.warn('Reached page limit of 100');
          hasMore = false;
        }
      }
    }

    // Sort statuses alphabetically
    const sortedStatuses = Object.keys(statusCounts).sort();

    const result: DiscoveryResult = {
      statuses: sortedStatuses,
      counts: statusCounts,
      samples: statusSamples,
      totalScanned,
      pagesFetched: page,
      discoveredAt: new Date().toISOString(),
    };

    logger.info('QContact status discovery complete', {
      uniqueStatuses: sortedStatuses.length,
      totalScanned,
      pagesFetched: page,
    });

    return apiResponse.success(res, result);
  } catch (error) {
    logger.error('QContact status discovery failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return apiResponse.internalError(res, error);
  }
}
