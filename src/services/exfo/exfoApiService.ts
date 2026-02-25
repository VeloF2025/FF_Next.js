/**
 * EXFO Exchange API Service
 *
 * Wraps the reverse-engineered EXFO Exchange REST API.
 * Handles search, measurement detail, and pagination.
 *
 * API microservices:
 * - search.exfoapis.com  — Search/list test results
 * - measurement.exfoapis.com — Full measurement details
 */

import { createLogger } from '@/lib/logger';
import { getExfoToken } from './exfoAuthService';
import type {
  ExfoSearchRequest,
  ExfoSearchResult,
  ExfoSearchResponse,
  ExfoMeasurementDetail,
} from './types';

const logger = createLogger('exfoApi');

const SEARCH_BASE = 'https://search.exfoapis.com';
const MEASUREMENT_BASE = 'https://measurement.exfoapis.com/prod';

// =============================================================================
// HTTP Helper
// =============================================================================

async function exfoFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = await getExfoToken();

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    logger.error('EXFO API error', {
      url,
      status: response.status,
      error: errorText.slice(0, 500),
    });
    throw new Error(`EXFO API error (${response.status}): ${errorText.slice(0, 200)}`);
  }

  return response.json() as Promise<T>;
}

// =============================================================================
// Search API
// =============================================================================

/**
 * Search test results in a workspace.
 * Supports pagination (from/size), filtering, and sorting.
 */
export async function searchResults(
  workspaceId: string,
  options: {
    from?: number;
    size?: number;
    term?: string;
    updatedSince?: string;
    updatedBefore?: string;
    testType?: string;
    verdict?: string;
  } = {}
): Promise<ExfoSearchResponse> {
  const { from = 0, size = 50, term = '' } = options;

  const filters: ExfoSearchRequest['search']['filters']['values'] = {};

  // Date range filter
  if (options.updatedSince || options.updatedBefore) {
    const dateRange: { start?: string; end?: string } = {};
    if (options.updatedSince) dateRange.start = options.updatedSince;
    if (options.updatedBefore) dateRange.end = options.updatedBefore;
    filters.serverUpdatedDate = { values: [dateRange as { start: string; end: string }] };
    filters.hasRadioButton = { values: 'serverUpdatedDate' };
  }

  // Test type filter (olts, iolm)
  if (options.testType) {
    filters.type = { values: [options.testType] };
  }

  // Verdict filter (Pass, Fail)
  if (options.verdict) {
    filters.globalVerdict = { values: [options.verdict] };
  }

  const body: ExfoSearchRequest = {
    from,
    size,
    search: {
      term,
      filters: { values: filters },
    },
    sort: { by: 'updated', order: 'desc' },
  };

  const url = `${SEARCH_BASE}/workspaces/${workspaceId}/search/results`;
  logger.debug('EXFO search', { workspaceId, from, size });

  return exfoFetch<ExfoSearchResponse>(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Fetch ALL results from a workspace using pagination.
 * Yields batches for memory efficiency.
 */
export async function fetchAllResults(
  workspaceId: string,
  options: {
    updatedSince?: string;
    batchSize?: number;
    maxResults?: number;
  } = {}
): Promise<ExfoSearchResult[]> {
  const batchSize = options.batchSize || 100;
  const maxResults = options.maxResults || 10000;
  const allResults: ExfoSearchResult[] = [];
  let from = 0;

  while (from < maxResults) {
    const response = await searchResults(workspaceId, {
      from,
      size: batchSize,
      updatedSince: options.updatedSince,
    });

    if (!response.results || response.results.length === 0) break;
    allResults.push(...response.results);

    logger.info('EXFO search batch', {
      workspaceId,
      fetched: allResults.length,
      batchSize: response.results.length,
    });

    // If we got fewer than requested, we've reached the end
    if (response.results.length < batchSize) break;
    from += batchSize;
  }

  return allResults;
}

// =============================================================================
// Measurement Detail API
// =============================================================================

/**
 * Get full measurement detail for a single test result.
 * Contains hardware info, identification, fiber data, and measurements.
 */
export async function getMeasurementDetail(
  workspaceId: string,
  resultId: string
): Promise<ExfoMeasurementDetail> {
  const url = `${MEASUREMENT_BASE}/workspaces/${workspaceId}/results/${resultId}`;
  logger.debug('EXFO measurement detail', { workspaceId, resultId });

  return exfoFetch<ExfoMeasurementDetail>(url);
}

/**
 * Fetch measurement details for multiple results with rate limiting.
 * Adds a small delay between requests to avoid overwhelming the API.
 */
export async function getMeasurementDetails(
  workspaceId: string,
  resultIds: string[],
  options: { delayMs?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<Map<string, ExfoMeasurementDetail>> {
  const delayMs = options.delayMs || 200;
  const results = new Map<string, ExfoMeasurementDetail>();

  for (let i = 0; i < resultIds.length; i++) {
    const resultId = resultIds[i]!;
    try {
      const detail = await getMeasurementDetail(workspaceId, resultId);
      results.set(resultId, detail);
    } catch (err) {
      logger.warn('Failed to fetch measurement detail', {
        resultId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    options.onProgress?.(i + 1, resultIds.length);

    // Rate limit delay (skip on last item)
    if (i < resultIds.length - 1 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
