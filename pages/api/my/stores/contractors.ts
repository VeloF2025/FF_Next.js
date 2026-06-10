/**
 * GET /api/my/stores/contractors — active contractors for the /my stores PWA dropdowns.
 *
 * PWA-session (withMySession) equivalent of GET /api/contractors-list. Returns the same
 * row shape (id, company_name, contact_person, status) so the existing client mapping in
 * field-stock-pwa/api/contractors.ts is unchanged. Uses pg.Pool via @/lib/db-pool.
 *
 * Gated to stores roles via requireStoresActor. Read-only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor } from '@/modules/field-stock-pwa/lib/storesActor';

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;

  try {
    const rows = await sql`
      SELECT id, company_name, contact_person, status
      FROM contractors
      WHERE is_active = true
      ORDER BY company_name ASC
    `;
    return apiResponse.success(res, rows);
  } catch (error) {
    log.error('my-stores contractors API error', { error }, 'my/stores/contractors');
    return apiResponse.internalError(res, error);
  }
});
