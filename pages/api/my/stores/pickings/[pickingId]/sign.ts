/**
 * POST /api/my/stores/pickings/[pickingId]/sign — sign a picking from the /my stores PWA.
 *
 * PWA-session (withMySession) equivalent of the withAuth sign route. The sign handler
 * has no req.user coupling (signer comes from the request body, audit actor is 'system'),
 * so it is reused verbatim. Gated to stores roles via requireStoresActor.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor } from '@/modules/field-stock-pwa/lib/storesActor';
import { signPicking } from '../../../../procurement/field-stock/pickings/[pickingId]/sign';

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;

  return signPicking(req, res);
});
