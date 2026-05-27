/**
 * POST /api/field/users/approve
 *
 * Approves a pending staff account, transitioning account_status from
 * 'pending' → 'active'. Admin-only (withRole enforces admin-or-higher).
 *
 * Query param: userId — the staff.id to approve.
 *
 * Route style: FLATTENED (not nested dynamic) — consistent with all other
 * API routes in this project; no [userId]/approve.ts pattern used.
 *
 * 200  { user: { id, account_status, role } }  — approved successfully
 * 404  pending user not found (already active, suspended, or wrong id)
 * 405  non-POST method
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth/middleware';

// ── Handler ───────────────────────────────────────────────────────────────────

async function approveHandler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
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
      SET account_status = 'active',
          updated_at      = NOW()
      WHERE id             = ${userId}
        AND account_status = 'pending'
      RETURNING id, account_status, role
    `;

    if (rows.length === 0) {
      apiResponse.notFound(res, 'Pending user', userId);
      return;
    }

    const user = rows[0] as { id: string; account_status: string; role: string };
    log.info('Staff account approved', { userId: user.id, role: user.role }, 'FieldUsersApprove');
    apiResponse.success(res, { user });
  } catch (error) {
    log.error(
      'Error approving field user',
      error instanceof Error ? { message: error.message } : { error },
      'FieldUsersApprove'
    );
    apiResponse.internalError(res, error, 'Failed to approve field user');
  }
}

// ── Export: withAuth + withRole('admin') ──────────────────────────────────────

export default withAuth(withRole('admin')(approveHandler));
