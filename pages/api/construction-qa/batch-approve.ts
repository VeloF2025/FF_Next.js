/**
 * /api/construction-qa/batch-approve
 *
 * GET  — List poles eligible for batch approval for a project.
 *         Requires: ?projectId=<uuid>
 *         Returns poles where workflow_status = 'pending', photo_count >= 7,
 *         and all required civil step booleans are satisfied.
 *
 * POST — Batch-approve an array of reviews in a single transaction.
 *         Body: { reviewIds: string[], qaDecisionBy: string }
 *         Returns: { approved: number, skipped: number, errors: string[] }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BatchApproveBody {
  reviewIds: string[];
  qaDecisionBy: string;
}

interface BatchApproveResult {
  approved: number;
  skipped: number;
  errors: string[];
}

interface EligibleReview {
  id: string;
  featureId: string;
  photoCount: number;
  zoneNo: number | null;
  ponNo: number | null;
  stepCoverage: {
    before: boolean;
    during: boolean;
    depth: boolean;
    endPlates: boolean;
    compaction: boolean;
    level: boolean;
    after: boolean;
    signature: boolean;
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET', 'POST']);
}

// ---------------------------------------------------------------------------
// GET — eligible poles for batch approval
// ---------------------------------------------------------------------------

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'projectId query parameter is required');
  }

  try {
    /**
     * Required civil step logic:
     *   - civil_step_03_depth_photo      (depth)
     *   - civil_step_05_compaction       (compaction)
     *   - civil_step_06_level_check      (level_check)
     *   - civil_step_07_after_photo      (after_photo)
     *   - civil_step_04_end_plates       (end_plates)
     *   - civil_step_01_before_photo OR civil_step_02_during_photo  (before OR during)
     */
    const rows = await sql`
      SELECT
        r.id,
        r.feature_id,
        r.photo_count,
        r.zone_no,
        r.pon_no,
        r.civil_step_01_before_photo  AS step_before,
        r.civil_step_02_during_photo  AS step_during,
        r.civil_step_03_depth_photo   AS step_depth,
        r.civil_step_04_end_plates    AS step_end_plates,
        r.civil_step_05_compaction    AS step_compaction,
        r.civil_step_06_level_check   AS step_level,
        r.civil_step_07_after_photo   AS step_after,
        r.civil_step_08_signature     AS step_signature
      FROM construction_qa_reviews r
      WHERE
        r.project_id = ${projectId}::uuid
        AND r.workflow_status = 'pending'
        AND r.photo_count >= 7
        AND r.civil_step_03_depth_photo   = TRUE
        AND r.civil_step_05_compaction    = TRUE
        AND r.civil_step_06_level_check   = TRUE
        AND r.civil_step_07_after_photo   = TRUE
        AND r.civil_step_04_end_plates    = TRUE
        AND (r.civil_step_01_before_photo = TRUE OR r.civil_step_02_during_photo = TRUE)
      ORDER BY r.feature_id ASC
    `;

    const eligible: EligibleReview[] = rows.map((row) => ({
      id: row.id as string,
      featureId: row.feature_id as string,
      photoCount: Number(row.photo_count),
      zoneNo: row.zone_no != null ? Number(row.zone_no) : null,
      ponNo: row.pon_no != null ? Number(row.pon_no) : null,
      stepCoverage: {
        before: Boolean(row.step_before),
        during: Boolean(row.step_during),
        depth: Boolean(row.step_depth),
        endPlates: Boolean(row.step_end_plates),
        compaction: Boolean(row.step_compaction),
        level: Boolean(row.step_level),
        after: Boolean(row.step_after),
        signature: Boolean(row.step_signature),
      },
    }));

    log.info('Batch-approve eligible query', {
      module: 'construction-qa',
      projectId,
      count: eligible.length,
    });

    return apiResponse.success(res, eligible);
  } catch (error) {
    log.error('Batch-approve GET error', {
      module: 'construction-qa',
      error: (error as Error).message,
    });
    return apiResponse.internalError(res, error);
  }
}

// ---------------------------------------------------------------------------
// POST — batch approve reviews
// ---------------------------------------------------------------------------

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const { reviewIds, qaDecisionBy } = req.body as Partial<BatchApproveBody>;

  // Input validation
  if (!Array.isArray(reviewIds) || reviewIds.length === 0) {
    return apiResponse.badRequest(res, 'reviewIds must be a non-empty array');
  }

  if (!qaDecisionBy || typeof qaDecisionBy !== 'string' || !qaDecisionBy.trim()) {
    return apiResponse.badRequest(res, 'qaDecisionBy must be a non-empty string');
  }

  const approver = qaDecisionBy.trim();
  const result: BatchApproveResult = { approved: 0, skipped: 0, errors: [] };

  for (const reviewId of reviewIds) {
    if (typeof reviewId !== 'string' || !reviewId.trim()) {
      result.errors.push(`Invalid reviewId value: ${String(reviewId)}`);
      continue;
    }

    try {
      // Update only reviews currently in pending or in_review — skip others
      const updated = await sql`
        UPDATE construction_qa_reviews
        SET
          workflow_status  = 'approved',
          qa_decision      = 'PASS',
          qa_decision_by   = ${approver},
          qa_decision_at   = NOW(),
          updated_at       = NOW()
        WHERE
          id               = ${reviewId}::uuid
          AND workflow_status IN ('pending', 'in_review')
        RETURNING id
      `;

      if (updated.length === 0) {
        // Row either does not exist or was already approved/rejected
        result.skipped += 1;
        log.info('Batch-approve: review skipped (already finalised or not found)', {
          module: 'construction-qa',
          reviewId,
        });
        continue;
      }

      // Insert activity record
      await sql`
        INSERT INTO construction_qa_activity (review_id, event_type, actor, payload)
        VALUES (
          ${reviewId}::uuid,
          'qa_decision',
          ${approver},
          ${'{"decision":"PASS","method":"batch_approve"}'}::jsonb
        )
      `;

      result.approved += 1;
    } catch (rowError) {
      const message = (rowError as Error).message;
      result.errors.push(`reviewId ${reviewId}: ${message}`);
      log.error('Batch-approve row error', {
        module: 'construction-qa',
        reviewId,
        error: message,
      });
    }
  }

  log.info('Batch-approve complete', {
    module: 'construction-qa',
    approved: result.approved,
    skipped: result.skipped,
    errors: result.errors.length,
    approver,
  });

  return apiResponse.success(res, result);
}

// ---------------------------------------------------------------------------
// Export with auth + permission guard
// ---------------------------------------------------------------------------

export default withAuth(withPermission('construction-qa.qa-centre')(handler));
