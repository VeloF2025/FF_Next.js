/**
 * API Route: /api/activate/pp-exit-reason
 *
 * POST — record (or clear) why a pre-provision left the list without activating.
 *
 * This is the write half of the exit path added in migration 524. A PP row could
 * previously leave the open list in exactly one way — by activating — so faulty
 * ONTs and false positives accumulated on it forever. That balance gates
 * Fibertime's ">100 open per POP, no new ports" rule, which is why an entry
 * nobody can retire is a commercial problem and not just untidy data.
 *
 * Setting a reason removes the row from `pp_open_balance` on the next nightly
 * snapshot (see the `exit_reason IS NULL` clause in metrics/snapshot/sources).
 * It does NOT touch `resolution_status`: that column records what the import
 * FOUND, and overwriting it here would destroy the import's own record of fact.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';
import { PP_EXIT_REASONS, type PpExitReason } from '@/modules/action-centre/ppExitReasons';

const logger = createLogger('activate:pp-exit-reason');

// Vocabulary lives in one place so the constraint, the API and the dropdown
// cannot drift; see the module's own comment.
export { PP_EXIT_REASONS, type PpExitReason } from '@/modules/action-centre/ppExitReasons';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const authReq = req as AuthenticatedNextApiRequest;
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'unknown', ['POST']);
  }

  const { id, exit_reason: exitReason } = (req.body ?? {}) as {
    id?: unknown;
    exit_reason?: unknown;
  };

  const rowId = typeof id === 'number' ? id : Number.parseInt(String(id ?? ''), 10);
  if (!Number.isInteger(rowId) || rowId <= 0) {
    return apiResponse.badRequest(res, 'id must be a positive integer');
  }

  // null clears the reason and returns the row to the open list — a genuine
  // action (someone mis-classified it), so it is supported rather than requiring
  // a DB edit. Anything else must be a known member.
  const clearing = exitReason === null;
  if (!clearing && !PP_EXIT_REASONS.includes(exitReason as PpExitReason)) {
    return apiResponse.badRequest(
      res,
      `exit_reason must be null or one of: ${PP_EXIT_REASONS.join(', ')}`,
    );
  }

  // The three columns move together — the 524 coherence constraint requires
  // reason and timestamp to be both set or both null, so they are written in one
  // statement rather than by separate updates that could interleave.
  const result = await pool.query<{
    id: number;
    serial_number: string;
    exit_reason: string | null;
    exit_reason_at: string | null;
  }>(
    `UPDATE oes_pp_data
        SET exit_reason    = $2,
            exit_reason_at = CASE WHEN $2::text IS NULL THEN NULL ELSE NOW() END,
            exit_reason_by = CASE WHEN $2::text IS NULL THEN NULL ELSE $3::uuid END,
            updated_at     = NOW()
      WHERE id = $1
      RETURNING id, serial_number, exit_reason, exit_reason_at`,
    [rowId, clearing ? null : (exitReason as string), authReq.user.id],
  );

  if (result.rowCount === 0) {
    return apiResponse.notFound(res, 'Pre-provision', String(rowId));
  }

  const row = result.rows[0];
  if (!row) {
    // rowCount > 0 with no row is not reachable through pg, but the types allow
    // it and a silent undefined here would be logged as a successful write.
    return apiResponse.notFound(res, 'Pre-provision', String(rowId));
  }
  logger.info(clearing ? 'PP exit reason cleared' : 'PP exit reason set', {
    id: row.id,
    serial_number: row.serial_number,
    exit_reason: row.exit_reason,
    by: authReq.user.id,
  });

  return apiResponse.success(res, row);
}

export default withAuth(withRole('technician')(handler));
