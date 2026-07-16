/**
 * POST /api/works-qa/pole-reopen
 *
 * Re-opens a previously-approved discipline for editing. Flips that
 * discipline's approval flag back to FALSE and clears the pole-level
 * approved_at (the pole is no longer fully approved), so the PoleDetailPanel
 * edit surface — remove (X), drag-to-reassign, upload, "use existing photo" —
 * becomes available again.
 *
 * The field use-case: poles physically shift on site after sign-off, so the
 * approved photos are now wrong and must be pulled and re-shot (Johan, WA
 * 2026-07-16).
 *
 * Body:
 *   pole_id     UUID
 *   discipline  'civil' | 'dome' | 'main_joint'
 *
 * Gated by works-qa.approve — re-opening reverses an approval, so it needs the
 * same authority that granted it.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import type { Discipline } from '@/modules/works-qa/utils/approval-gates';

const DISCIPLINES: ReadonlySet<Discipline> = new Set(['civil', 'dome', 'main_joint']);

// Discipline → matching boolean column. joint_approved is the legacy DB column
// name for the main_joint discipline.
const APPROVE_COLUMN: Record<Discipline, 'civil_approved' | 'dome_approved' | 'joint_approved'> = {
  civil: 'civil_approved',
  dome: 'dome_approved',
  main_joint: 'joint_approved',
};

interface ReopenBody {
  pole_id?: string;
  discipline?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const { pole_id, discipline } = req.body as ReopenBody;
  if (!pole_id) return apiResponse.badRequest(res, 'pole_id required');
  if (!discipline || !DISCIPLINES.has(discipline as Discipline)) {
    return apiResponse.badRequest(res, "discipline must be one of 'civil', 'dome', 'main_joint'");
  }
  const d = discipline as Discipline;
  const reopenColumn = APPROVE_COLUMN[d];

  try {
    const userEmail = (req as AuthenticatedNextApiRequest).user.email;

    // Clear the discipline flag AND the pole-level approved_at — with any
    // discipline un-approved the pole is no longer fully approved, so the
    // "All approved" banner and the unassigned-bucket lock must lift too.
    const result = await pool.query(
      `UPDATE pole_qa_photos
       SET ${reopenColumn} = FALSE,
           approved_at = NULL,
           updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING civil_approved, dome_approved, joint_approved, approved_at`,
      [pole_id],
    );
    if (result.rows.length === 0) return apiResponse.notFound(res, 'Pole', pole_id);

    log.info('works-qa/pole-reopen', { pole_id, discipline: d, by: userEmail });

    return apiResponse.success(res, { reopened: true, discipline: d, pole: result.rows[0] });
  } catch (err) {
    log.error('works-qa/pole-reopen', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa.approve', 'edit')(handler));
