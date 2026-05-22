/**
 * GET /api/my/stores/today
 *
 * Per-technician reconciliation for the /my/stores/today PWA view.
 * Session-gated via withMySession; scoped to the authenticated stores
 * user's own pickings. Date defaults to today in SAST; the `date` query
 * param accepts a YYYY-MM-DD override for testing or historical view.
 *
 * Intentional design choices (review-team L1, L2):
 *  - No date upper-bound on ?date. The aggregator filters by
 *    `created_by_staff_id = session.staffId`, so an old date for a stores
 *    user with no historical pickings returns []. Historical lookup is
 *    a recognised feature, not a leak.
 *  - No server-side STORES_ROLES gate. The aggregator's WHERE-clause is
 *    the access control — a technician with a valid /my session calling
 *    this endpoint gets their own (typically empty) pickings, never
 *    anyone else's. The client-side STORES_ROLES gate (useStoresSession)
 *    controls UI visibility; the server is intentionally
 *    "session-scoped only, not role-scoped".
 *
 * Query params:
 *  - `date=YYYY-MM-DD` (optional) — defaults to today in SAST
 *  - `summary=count` (optional) — returns scalar { date, unaccounted_count }
 *    for the StoresHub tile badge; absent returns full { date, rows }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { sastWorkDate } from '@/modules/attendance/portal/clockUtils';
import { getTodayForStoresUser } from '@/modules/field-stock-pwa/services/storesTodayService';
import type { StoresTodayResponse } from '@/types/field-stock-pwa/storesToday';

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface StoresTodaySummary {
  date: string;
  unaccounted_count: number;
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

    // ?summary=count returns just the scalar — used by the StoresHub badge
    // so the hub render doesn't pay for the full per-tech payload on every
    // mount (the page-level fetch still gets the full rows).
    if (req.query.summary === 'count') {
      const unaccounted_count = rows.reduce(
        (sum, r) => sum + (r.unaccounted_count > 0 ? r.unaccounted_count : 0),
        0,
      );
      return apiResponse.success(res, { date: dateSAST, unaccounted_count } satisfies StoresTodaySummary);
    }

    return apiResponse.success(res, { date: dateSAST, rows } satisfies StoresTodayResponse);
  } catch (error: unknown) {
    log.error('GET /api/my/stores/today failed', { error, staffId: session.staffId }, 'my-stores-today');
    return apiResponse.internalError(res, error);
  }
});
