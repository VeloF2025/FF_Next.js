// GET /api/procurement/field-stock/serials/timeline?serialNumber=<n>
// FLAT route per Wave 2 Locked decision #12.
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
    const message = err instanceof Error ? err.message : String(err);
    log.error('get serial timeline failed', { err: message }, 'SerialTimelineAPI');
    // Pass the scrubbed message string (not the raw Error) so dev responses
    // don't leak stack traces via apiResponse.internalError's dev branch.
    return apiResponse.internalError(res, message);
  }
}

export default withAuth(withPermission('procurement.field-stock', 'view')(handler));
