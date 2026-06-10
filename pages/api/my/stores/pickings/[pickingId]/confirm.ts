/**
 * POST /api/my/stores/pickings/[pickingId]/confirm — confirm a picking from the /my stores PWA.
 *
 * PWA-session (withMySession) equivalent of the withAuth confirm route. The confirm
 * handler has no req.user coupling (audit actor is 'system'), so it is reused verbatim.
 * Gated to stores roles via requireStoresActor.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor } from '@/modules/field-stock-pwa/lib/storesActor';
import { confirmPicking } from '../../../../procurement/field-stock/pickings/[pickingId]/confirm';

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;

  return confirmPicking(req, res);
});
