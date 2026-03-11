/**
 * QContact Case Debug Endpoint
 * 🔧 DEBUG: Fetches a single case to inspect field structure
 *
 * @endpoint GET /api/noc/qcontact/debug-case?id=22021088801
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { createFiberTimeQContactClient } from '@/modules/noc/services/fibertimeQContactClient';
import { withAuth } from '@/lib/auth';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown');
  }

  const caseId = req.query.id as string;
  if (!caseId) {
    return apiResponse.badRequest(res, 'Case ID required (?id=...)');
  }

  try {
    const client = createFiberTimeQContactClient();

    // Fetch the case detail
    const caseDetail = await client.getCase(parseInt(caseId));

    if (!caseDetail) {
      return apiResponse.notFound(res, 'Case', caseId);
    }

    // Return raw case detail for inspection
    return apiResponse.success(res, {
      raw: caseDetail,
      extracted: {
        id: caseDetail.id,
        label: caseDetail.label,
        status: caseDetail.status,
        __status: caseDetail.__status,
        fields_status: caseDetail.fields?.status,
        created_at: caseDetail.created_at,
        category: caseDetail.category,
        __category: caseDetail.__category,
      }
    });
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
