/**
 * POST /api/photo-guide/escalation-resolve
 *
 * Supervisor approves or rejects a PWA escalation.
 * Body: { id: string, resolution: 'approved' | 'rejected', note?: string }
 *
 * Flattened (no nested dynamic route) per the project's route conventions.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth';

interface ResolveBody {
  id: string;
  resolution: 'approved' | 'rejected';
  note?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);

  const { id, resolution, note } = (req.body ?? {}) as Partial<ResolveBody>;
  if (!id || typeof id !== 'string') return apiResponse.badRequest(res, 'Escalation id required');
  if (resolution !== 'approved' && resolution !== 'rejected') {
    return apiResponse.badRequest(res, 'resolution must be approved or rejected');
  }

  const supervisorId = (req as AuthenticatedNextApiRequest).user?.id ?? null;

  const { rowCount } = await pool.query(
    `UPDATE pwa_escalations
     SET status = $1, resolved_by = $2, resolved_at = NOW(), resolution_note = $3
     WHERE id = $4 AND status = 'pending'`,
    [resolution, supervisorId, note ?? null, id]
  );

  if (!rowCount) return apiResponse.notFound(res, 'Escalation', id);

  return apiResponse.success(res, { resolved: true });
}

// Supervisor-only: resolving an escalation requires manager role or higher.
export default withAuth(withRole('manager')(handler));
