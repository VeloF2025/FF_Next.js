/**
 * POST /api/my/stores/returns/[returnId]/accept — accept a return from the /my stores PWA.
 *
 * PWA-session (withMySession) equivalent of POST /api/procurement/field-stock/returns/[returnId]/accept.
 * Reuses the shared acceptReturn() core; gated to the inspector tier via requireReturnInspector
 * (stores / admin / super_admin).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireReturnInspector } from '@/modules/field-stock-pwa/lib/storesActor';
import { acceptReturn } from '../../../../procurement/field-stock/returns/[returnId]/accept';

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  const { returnId } = req.query;

  if (typeof returnId !== 'string') {
    return apiResponse.validationError(res, { returnId: 'Return ID is required' });
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const actor = await requireReturnInspector(res, session.staffId);
  if (!actor) return;

  return acceptReturn(req, res, { staffId: actor.staffId });
});
