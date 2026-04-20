/**
 * Session-required wrapper for /my portal handlers.
 *
 * Usage:
 *   export default withMySession(async (req, res, session) => { ... });
 *
 * The wrapper:
 *   - Verifies `ff_my_session` cookie (HMAC + DB row + not-revoked + not-expired).
 *   - Passes the verified session down to the handler so downstream code
 *     doesn't re-read the cookie.
 *   - Returns 401 before the handler runs if the session is missing/invalid.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { verifySession } from './sessionUtils';
import type { AttendanceSession } from './types';

export type MyHandler = (
  req: NextApiRequest,
  res: NextApiResponse,
  session: AttendanceSession
) => Promise<void> | void;

export function withMySession(handler: MyHandler) {
  return async function authedHandler(req: NextApiRequest, res: NextApiResponse) {
    const { valid, session, reason } = await verifySession(req);
    if (!valid || !session) {
      return apiResponse.error(res, ErrorCode.UNAUTHORIZED, 'Not signed in', {
        reason: reason ?? 'no_session',
      });
    }
    return handler(req, res, session);
  };
}
