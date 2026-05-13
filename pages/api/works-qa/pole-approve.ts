import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { disciplineGatesPass, type Discipline } from '@/modules/works-qa/utils/approval-gates';
import type { PoleQaPhoto } from '@/modules/works-qa/types/works-qa.types';

const DISCIPLINES: ReadonlySet<Discipline> = new Set(['civil', 'dome', 'main_joint']);

// Discipline → matching boolean column on pole_qa_photos.
// joint_approved is the legacy DB column name for the main_joint discipline.
const APPROVE_COLUMN: Record<Discipline, 'civil_approved' | 'dome_approved' | 'joint_approved'> = {
  civil: 'civil_approved',
  dome: 'dome_approved',
  main_joint: 'joint_approved',
};

interface ApproveBody {
  pole_id?: string;
  discipline?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const { pole_id, discipline } = req.body as ApproveBody;
  if (!pole_id) return apiResponse.badRequest(res, 'pole_id required');
  if (!discipline || !DISCIPLINES.has(discipline as Discipline)) {
    return apiResponse.badRequest(res, "discipline must be one of 'civil', 'dome', 'main_joint'");
  }
  const d = discipline as Discipline;

  try {
    const userEmail = (req as AuthenticatedNextApiRequest).user.email;

    const fetchResult = await pool.query(
      'SELECT * FROM pole_qa_photos WHERE id = $1::uuid',
      [pole_id]
    );
    if (fetchResult.rows.length === 0) return apiResponse.notFound(res, 'Pole', pole_id);

    const pole = fetchResult.rows[0] as PoleQaPhoto;

    // Gate: only this discipline's slots need to pass; the other two stay as they were.
    const { pass, blocking } = disciplineGatesPass(pole, d);
    if (!pass) {
      return res.status(422).json({ success: false, error: 'Approval gates failed', blocking });
    }

    const approvedColumn = APPROVE_COLUMN[d];

    // PostgreSQL evaluates UPDATE SET expressions against the pre-update row, so
    // a naive `CASE WHEN civil_approved AND dome_approved AND joint_approved`
    // would miss the discipline being approved right now. Substitute TRUE for
    // the column we're flipping so the final-approval check works on the very
    // call that sets the third flag.
    const civilExpr      = approvedColumn === APPROVE_COLUMN.civil      ? 'TRUE' : APPROVE_COLUMN.civil;
    const domeExpr       = approvedColumn === APPROVE_COLUMN.dome       ? 'TRUE' : APPROVE_COLUMN.dome;
    const mainJointExpr  = approvedColumn === APPROVE_COLUMN.main_joint ? 'TRUE' : APPROVE_COLUMN.main_joint;

    await pool.query(
      `UPDATE pole_qa_photos
       SET ${approvedColumn} = TRUE,
           approved_by = $1,
           approved_at = CASE
             WHEN ${civilExpr} = TRUE AND ${domeExpr} = TRUE AND ${mainJointExpr} = TRUE
             THEN COALESCE(approved_at, NOW())
             ELSE approved_at
           END,
           updated_at = NOW()
       WHERE id = $2::uuid`,
      [userEmail, pole_id]
    );

    // Re-read to report final state
    const after = await pool.query(
      `SELECT civil_approved, dome_approved, joint_approved, approved_at FROM pole_qa_photos WHERE id = $1::uuid`,
      [pole_id]
    );

    return apiResponse.success(res, {
      approved: true,
      discipline: d,
      pole: after.rows[0],
    });
  } catch (err) {
    log.error('works-qa/pole-approve', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa.approve', 'edit')(handler));
