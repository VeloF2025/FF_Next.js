/**
 * POST /api/my/stores/pickings/[pickingId]/process — process a picking from the /my stores PWA.
 *
 * PWA-session (withMySession) equivalent of the withAuth process route. The process
 * handler has no req.user coupling — the serial-promotion/custody actor is read from
 * stock_pickings.signed_by, audit actor is 'system' — so it is reused verbatim. This is
 * the step that promotes serials to 'issued' and posts custody. Gated via requireStoresActor.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor } from '@/modules/field-stock-pwa/lib/storesActor';
import { processPicking } from '../../../../procurement/field-stock/pickings/[pickingId]/process';

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;

  return processPicking(req, res);
});
