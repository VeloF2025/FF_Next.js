/**
 * POST /api/my/stores/pickings — create a stock-issue picking from the /my stores PWA.
 *
 * PWA-session (withMySession) equivalent of POST /api/procurement/field-stock/pickings.
 * Reuses the shared createPicking() core; the only auth-tier difference is the creator
 * staff id, which for the PWA is session.staffId directly (the stores person issuing).
 *
 * Gated to stores roles via requireStoresActor. List (GET) stays on the main-RBAC route.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor } from '@/modules/field-stock-pwa/lib/storesActor';
import { createPicking } from '../../../procurement/field-stock/pickings/_create';

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;

  return createPicking(req, res, actor.staffId);
});
