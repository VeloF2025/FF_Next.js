/**
 * Stock Returns API
 * GET /api/procurement/field-stock/returns - List returns (role-scoped, see _list.ts)
 * POST /api/procurement/field-stock/returns - Create return
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { isReturnCreator } from '@/modules/field-stock-pwa/lib/storesRoles';
import { createReturn } from './_create';
import { handleList } from './_list';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleList(req, res);
  } else if (req.method === 'POST') {
    return handleCreate(req, res);
  }
  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

async function handleCreate(req: NextApiRequest, res: NextApiResponse) {
  try {
    // ── Role gate ──────────────────────────────────────────────────────────────
    const userId = (req as AuthenticatedNextApiRequest).user?.id;
    if (!userId) {
      return apiResponse.unauthorized(res, 'User session required');
    }

    const staffRows = await sql`
      SELECT s.id, s.role, s.first_name, s.last_name, u.role AS auth_role
      FROM staff s
      JOIN users u ON u.id = s.user_id
      WHERE u.id = ${userId}
      LIMIT 1
    `;
    const staffRow = staffRows[0];

    if (!staffRow) {
      return apiResponse.forbidden(res, 'No staff record linked to user');
    }

    const staffId = staffRow.id as string;
    const staffRole = staffRow.role as string;
    const authRole = staffRow.auth_role as string;
    const returnedByName = `${staffRow.first_name ?? ''} ${staffRow.last_name ?? ''}`.trim();

    if (!isReturnCreator(staffRole as Parameters<typeof isReturnCreator>[0], authRole)) {
      return apiResponse.forbidden(res, 'Insufficient role to create a return');
    }

    return createReturn(req, res, { staffId, returnedByName });
  } catch (error: unknown) {
    log.error('Error in return create gate', { error }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
