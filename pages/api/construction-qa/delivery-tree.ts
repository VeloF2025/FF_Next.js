/**
 * QA Centre Delivery Tree API
 *
 * GET /api/construction-qa/delivery-tree
 *   ?projectId=UUID            optional — restrict to one project
 *   &opticalSubmittedOnly=1    optional — only PONs with a port submission
 *
 * Read-only projection of Project → Zone → PON delivery status. Zone status
 * comes from active handover certificates, PON status from the recorded port
 * submission; both rules live in the delivery-tree module, not in this route,
 * as does the SQL (see deliveryTreeQuery.ts).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { fetchDeliveryTree } from '@/modules/construction-qa/delivery-tree/deliveryTreeQuery';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  const rawProjectId = req.query.projectId;
  const projectId = typeof rawProjectId === 'string' && rawProjectId !== '' ? rawProjectId : null;
  if (projectId !== null && !UUID_PATTERN.test(projectId)) {
    return apiResponse.badRequest(res, 'projectId must be a UUID');
  }

  const rawFlag = req.query.opticalSubmittedOnly;
  const opticalSubmittedOnly = rawFlag === '1' || rawFlag === 'true';

  try {
    const tree = await fetchDeliveryTree(pool, { projectId, opticalSubmittedOnly });
    return apiResponse.success(res, tree);
  } catch (error) {
    log.error('Delivery tree API error', {
      module: 'construction-qa',
      projectId,
      opticalSubmittedOnly,
      error: (error as Error).message,
    });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withPermission('construction-qa.qa-centre')(handler));
