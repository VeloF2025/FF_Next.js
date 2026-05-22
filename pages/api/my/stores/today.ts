/**
 * GET /api/my/stores/today
 *
 * Per-technician reconciliation for the /my/stores/today PWA view.
 * Session-gated via withMySession; scoped to the authenticated stores
 * user's own pickings. Date defaults to today in SAST; the `date` query
 * param accepts a YYYY-MM-DD override for testing or historical view.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { sastWorkDate } from '@/modules/attendance/portal/clockUtils';
import {
  getTodayForStoresUser,
  type StoresTodayRow,
} from '@/modules/field-stock-pwa/services/storesTodayService';

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface StoresTodayResponse {
  date: string;
  rows: StoresTodayRow[];
}

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const dateParam = typeof req.query.date === 'string' ? req.query.date : undefined;
    const dateSAST = dateParam && ISO_DATE_RE.test(dateParam)
      ? dateParam
      : sastWorkDate(new Date());

    const rows = await getTodayForStoresUser(session.staffId, dateSAST);

    return apiResponse.success(res, {
      date: dateSAST,
      rows,
    } satisfies StoresTodayResponse);
  } catch (error: unknown) {
    log.error('GET /api/my/stores/today failed', { error, staffId: session.staffId }, 'my-stores-today');
    return apiResponse.internalError(res, error);
  }
});
