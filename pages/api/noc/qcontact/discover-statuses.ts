/**
 * QContact Status Discovery Endpoint
 * 🟢 WORKING: Fetches QContact tickets and their details to discover unique status values
 *
 * Used to understand what statuses QContact uses before creating a mapping
 * to FibreFlow's 11-status workflow.
 *
 * Note: The list view doesn't include status, so we fetch case details.
 *
 * @endpoint GET /api/noc/qcontact/discover-statuses
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import {
  createFiberTimeQContactClient,
} from '@/modules/noc/services/fibertimeQContactClient';
import { withAuth } from '@/lib/auth';

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
  /** Details fetched count */
  detailsFetched: number;
  /** Timestamp of discovery */
  discoveredAt: string;
}

async function handler(
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
    const allCaseIds: { id: number; label: string; created_at: string }[] = [];

    // First, fetch all case IDs from list view
    let page = 1;
    const pageSize = 50;
    let hasMore = true;

    while (hasMore) {
      logger.debug(`Fetching list page ${page}`);

      const response = await client.listCases({
        page,
        pageSize,
      });

      const cases = response.results || [];

      for (const ftCase of cases) {
        allCaseIds.push({
          id: ftCase.id,
          label: ftCase.label,
          created_at: ftCase.created_at,
        });
      }

      if (cases.length < pageSize) {
        hasMore = false;
      } else {
        page++;
        if (page > 100) {
          logger.warn('Reached page limit of 100');
          hasMore = false;
        }
      }
    }

    logger.info(`Found ${allCaseIds.length} cases, fetching details for status discovery`);

    // Fetch details for all cases (in batches to avoid overwhelming API)
    const batchSize = 10;
    let detailsFetched = 0;

    for (let i = 0; i < allCaseIds.length; i += batchSize) {
      const batch = allCaseIds.slice(i, i + batchSize);

      // Fetch batch in parallel
      const results = await Promise.allSettled(
        batch.map(async (caseInfo) => {
          const detail = await client.getCase(caseInfo.id);
          return { caseInfo, detail };
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.detail) {
          const { caseInfo, detail } = result.value;
          // Get status from fields.status (the actual status field)
          const status = detail.fields?.status as string || 'unknown';

          statusCounts[status] = (statusCounts[status] || 0) + 1;

          if (!statusSamples[status]) {
            statusSamples[status] = [];
          }
          if (statusSamples[status].length < 3) {
            statusSamples[status].push({
              id: String(caseInfo.id),
              label: caseInfo.label,
              created_at: caseInfo.created_at,
            });
          }

          detailsFetched++;
        }
      }

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < allCaseIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Sort statuses alphabetically
    const sortedStatuses = Object.keys(statusCounts).sort();

    const result: DiscoveryResult = {
      statuses: sortedStatuses,
      counts: statusCounts,
      samples: statusSamples,
      totalScanned: allCaseIds.length,
      detailsFetched,
      discoveredAt: new Date().toISOString(),
    };

    logger.info('QContact status discovery complete', {
      uniqueStatuses: sortedStatuses.length,
      totalScanned: allCaseIds.length,
      detailsFetched,
    });

    return apiResponse.success(res, result);
  } catch (error) {
    logger.error('QContact status discovery failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
