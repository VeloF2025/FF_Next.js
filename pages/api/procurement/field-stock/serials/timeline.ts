/**
 * GET /api/procurement/field-stock/serials/timeline?serialNumber=<n>
 *
 * FLAT route — no nested dynamic segments. Per CLAUDE.md "Flatten nested
 * dynamic routes — they fail in Vercel" and Wave 2 Locked decision #12.
 *
 * Auth: withAuth + withPermission('procurement.field-stock','view') —
 * same gating as the master search route (PR #1723).
 *
 * Query params:
 *   serialNumber — required, max 100 chars (column type varchar(100))
 *
 * Responses:
 *   200 — apiResponse.success({ serial, entries, hasRealEvents })
 *   400 — serialNumber missing/empty/too long
 *   404 — serial not found in stock_serials
 *   405 — method != GET
 *   500 — service threw
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withPermission } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { getSerialTimeline } from '@/modules/procurement/field-stock/services/serialTimelineService';

const MAX_SERIAL_LENGTH = 100;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }
  const raw = req.query.serialNumber;
  if (typeof raw !== 'string') {
    return apiResponse.badRequest(res, 'Invalid query parameter serialNumber: must be a string');
  }
  const serialNumber = raw.trim();
  if (serialNumber.length === 0) {
    return apiResponse.badRequest(res, 'Invalid query parameter serialNumber: must not be empty');
  }
  if (serialNumber.length > MAX_SERIAL_LENGTH) {
    return apiResponse.badRequest(
      res,
      `Invalid query parameter serialNumber: must be at most ${MAX_SERIAL_LENGTH} characters`
    );
  }
  try {
    const result = await getSerialTimeline(serialNumber);
    if (!result) {
      return apiResponse.notFound(res, 'Serial', serialNumber);
    }
    return apiResponse.success(res, result);
  } catch (err) {
    log.error(
      'get serial timeline failed',
      { err: err instanceof Error ? err.message : String(err) },
      'SerialTimelineAPI'
    );
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('procurement.field-stock', 'view')(handler));
