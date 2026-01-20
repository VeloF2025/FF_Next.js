/**
 * API Route: /api/activate/reporting/offline-devices
 *
 * Purpose: Get offline devices report with filtering and pagination
 * Method: GET
 *
 * Query Parameters:
 * - dateFrom (required): Start date (YYYY-MM-DD)
 * - dateTo (required): End date (YYYY-MM-DD)
 * - project (optional): Filter by project name
 * - zone (optional): Filter by zone
 * - offlineBucket (optional): Filter by offline bucket
 * - matchStatus (optional): Filter by match status (matched_drops, matched_oes, unmatched)
 * - serialMismatchOnly (optional): Only show serial mismatches (true/false)
 * - lastDownReason (optional): Filter by last down reason
 * - page (optional): Page number (default: 1)
 * - pageSize (optional): Page size (default: 100, max: 500)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getOfflineDevicesReport } from '@/modules/activate/services/reportingService';
import type { OfflineMatchStatus } from '@/modules/activate/types/reporting.types';
import { log } from '@/lib/logger';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      dateFrom,
      dateTo,
      project,
      zone,
      offlineBucket,
      matchStatus,
      serialMismatchOnly,
      lastDownReason,
      page,
      pageSize,
    } = req.query;

    // Validate required parameters
    if (!dateFrom || !dateTo) {
      return res.status(400).json({
        error: 'Missing required parameters: dateFrom and dateTo',
      });
    }

    const dateFromStr = Array.isArray(dateFrom) ? dateFrom[0] : dateFrom;
    const dateToStr = Array.isArray(dateTo) ? dateTo[0] : dateTo;
    const projectStr = project
      ? Array.isArray(project)
        ? project[0]
        : project
      : undefined;
    const zoneStr = zone
      ? Array.isArray(zone)
        ? zone[0]
        : zone
      : undefined;
    const offlineBucketStr = offlineBucket
      ? Array.isArray(offlineBucket)
        ? offlineBucket[0]
        : offlineBucket
      : undefined;
    const matchStatusStr = matchStatus
      ? (Array.isArray(matchStatus)
          ? matchStatus[0]
          : matchStatus) as OfflineMatchStatus
      : undefined;
    const serialMismatchOnlyBool =
      serialMismatchOnly === 'true' || serialMismatchOnly === '1';
    const lastDownReasonStr = lastDownReason
      ? Array.isArray(lastDownReason)
        ? lastDownReason[0]
        : lastDownReason
      : undefined;
    const pageNum = page
      ? parseInt(Array.isArray(page) ? page[0] : page, 10)
      : 1;
    const pageSizeNum = pageSize
      ? Math.min(parseInt(Array.isArray(pageSize) ? pageSize[0] : pageSize, 10), 500)
      : 100;

    log.info('OfflineDevicesAPI', 'Fetching offline devices report', {
      dateFrom: dateFromStr,
      dateTo: dateToStr,
      project: projectStr,
      zone: zoneStr,
      offlineBucket: offlineBucketStr,
      matchStatus: matchStatusStr,
      serialMismatchOnly: serialMismatchOnlyBool,
      lastDownReason: lastDownReasonStr,
      page: pageNum,
      pageSize: pageSizeNum,
    });

    const data = await getOfflineDevicesReport(
      dateFromStr as string,
      dateToStr as string,
      {
        project: projectStr,
        zone: zoneStr,
        offlineBucket: offlineBucketStr,
        matchStatus: matchStatusStr,
        serialMismatchOnly: serialMismatchOnlyBool,
        lastDownReason: lastDownReasonStr,
        page: pageNum,
        pageSize: pageSizeNum,
      }
    );

    return res.status(200).json(data);
  } catch (error) {
    log.error('OfflineDevicesAPI', 'Failed to fetch offline devices report', { error });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
