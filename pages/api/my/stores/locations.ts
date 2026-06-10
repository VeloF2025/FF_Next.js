/**
 * GET /api/my/stores/locations — stock locations for the /my stores PWA.
 *
 * PWA-session (withMySession) equivalent of GET /api/procurement/field-stock/locations
 * (which is withAuth-gated and unreachable from the ff_my_session cookie). Reuses the
 * same locationService.getLocations so there is one source of truth for the query.
 *
 * Gated to stores roles via requireStoresActor. Read-only — creation stays on the
 * main-RBAC procurement endpoint.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor } from '@/modules/field-stock-pwa/lib/storesActor';
import { getLocations } from '@/modules/procurement/field-stock/services/locationService';
import type { LocationFilters, LocationType } from '@/modules/procurement/field-stock/types';

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;

  try {
    const filters: LocationFilters = {};
    if (req.query.locationType) filters.locationType = req.query.locationType as LocationType;
    if (req.query.projectId) filters.projectId = req.query.projectId as string;
    if (req.query.isActive !== undefined) filters.isActive = req.query.isActive === 'true';
    if (req.query.search) filters.search = req.query.search as string;

    const locations = await getLocations(filters);
    return apiResponse.success(res, locations);
  } catch (error) {
    log.error('my-stores locations API error', { error }, 'my/stores/locations');
    return apiResponse.internalError(res, error);
  }
});
