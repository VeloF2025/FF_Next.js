/**
 * GET|POST /api/my/stores/returns — field-stock returns from the /my stores PWA.
 *
 * PWA-session (withMySession) equivalent of GET|POST /api/procurement/field-stock/returns.
 * Reuses the shared listReturns() and createReturn() cores; the only auth-tier difference
 * is actor resolution — for the PWA, session.staffId is used directly via the
 * requireReturnCreator gate.
 *
 * GET  — all callers may list; the inspector flag determines ownership scope.
 * POST — creator-tier gate (technician / stores / admin).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import {
  requireReturnCreator,
} from '@/modules/field-stock-pwa/lib/storesActor';
import { isReturnInspector } from '@/modules/field-stock-pwa/lib/storesRoles';
import { listReturns } from '../../../procurement/field-stock/returns/_list';
import { createReturn } from '../../../procurement/field-stock/returns/_create';

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  if (req.method === 'GET') {
    const actor = await requireReturnCreator(res, session.staffId);
    if (!actor) return;

    return listReturns(req, res, {
      callerStaffId: actor.staffId,
      callerIsInspector: isReturnInspector(actor.staffRole, actor.authRole),
    });
  }

  if (req.method === 'POST') {
    const actor = await requireReturnCreator(res, session.staffId);
    if (!actor) return;

    return createReturn(req, res, { staffId: actor.staffId, returnedByName: actor.name });
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
});
