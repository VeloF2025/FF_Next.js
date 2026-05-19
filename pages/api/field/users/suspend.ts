/**
 * POST /api/field/users/suspend
 *
 * Suspends a staff account, transitioning account_status from
 * 'active' or 'pending' → 'suspended'. Admin-only.
 *
 * Query param: userId — the staff.id to suspend.
 *
 * Route style: FLATTENED — consistent with all other API routes in this project.
 *
 * 200  { user: { id, account_status, role } }  — suspended successfully
 * 404  no active/pending user found (already suspended, or wrong id)
 * 405  non-POST method
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth/middleware';

// ── Handler ───────────────────────────────────────────────────────────────────

async function suspendHandler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
    return;
  }

  const userId = req.query.userId;
  if (!userId || typeof userId !== 'string') {
    apiResponse.badRequest(res, 'userId query parameter is required');
    return;
  }

  try {
    const rows = await sql`
      UPDATE staff
      SET account_status = 'suspended',
          updated_at      = NOW()
      WHERE id             = ${userId}
        AND account_status IN ('active', 'pending')
      RETURNING id, account_status, role
    `;

    if (rows.length === 0) {
      apiResponse.notFound(res, 'Active or pending user', userId);
      return;
    }

    const user = rows[0] as { id: string; account_status: string; role: string };
    log.info('Staff account suspended', { userId: user.id, role: user.role }, 'FieldUsersSuspend');
    apiResponse.success(res, { user });
  } catch (error) {
    log.error(
      'Error suspending field user',
      error instanceof Error ? { message: error.message } : { error },
      'FieldUsersSuspend'
    );
    apiResponse.internalError(res, error, 'Failed to suspend field user');
  }
}

// ── Export: withAuth + withRole('admin') ──────────────────────────────────────

export default withAuth(withRole('admin')(suspendHandler));
