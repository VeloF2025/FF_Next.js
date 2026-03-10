/**
 * Construction QA Review API
 *
 * GET  /api/construction-qa/review?id={reviewId}
 *   - Returns full review detail with photos and activity
 *
 * POST /api/construction-qa/review
 *   - Updates review checklist steps and extracted data (Phase 2/3)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET', 'POST']);
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Review id is required');
  }

  try {
    // Fetch review with project name
    const reviews = await sql`
      SELECT
        r.*,
        p.project_name
      FROM construction_qa_reviews r
      JOIN projects p ON p.id = r.project_id
      WHERE r.id = ${id}::uuid
      LIMIT 1
    `;

    if (reviews.length === 0) {
      return apiResponse.notFound(res, 'Review', id);
    }

    const review = reviews[0];

    // Fetch photos
    const photos = await sql`
      SELECT *
      FROM construction_qa_photos
      WHERE review_id = ${id}::uuid
      ORDER BY checklist_step ASC NULLS LAST, created_at ASC
    `;

    // Fetch recent activity (last 50 entries)
    const activity = await sql`
      SELECT *
      FROM construction_qa_activity
      WHERE review_id = ${id}::uuid
      ORDER BY created_at DESC
      LIMIT 50
    `;

    return apiResponse.success(res, {
      review,
      photos,
      activity,
    });
  } catch (error) {
    log.error('Review GET error', { module: 'construction-qa', error: (error as Error).message });

    if ((error as Error).message?.includes('does not exist')) {
      return apiResponse.success(res, { review: null, photos: [], activity: [] });
    }

    return apiResponse.internalError(res, error);
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { reviewId, stepUpdates, extractedDataUpdates, notes, reviewedBy, featureIdUpdate } = req.body;

    if (!reviewId) {
      return apiResponse.badRequest(res, 'reviewId is required');
    }

    // Build SET clauses from step updates
    const setClauses: string[] = ['updated_at = NOW()'];
    const params: (string | number | boolean)[] = [reviewId];
    let paramIdx = 2;

    // Valid step column names (whitelist to prevent SQL injection)
    const validStepColumns = new Set([
      // Civil — Pole Install Capture Checklist (8 steps)
      'civil_step_01_before_photo', 'civil_step_02_during_photo', 'civil_step_03_depth_photo',
      'civil_step_04_end_plates', 'civil_step_05_compaction', 'civil_step_06_level_check',
      'civil_step_07_after_photo', 'civil_step_08_signature',
      // Optical — Phase A / Distribution Dome (steps 1-8)
      'optical_step_01_dome_on_pole', 'optical_step_02_dome_label',
      'optical_step_03_open_dome', 'optical_step_04_splice_protectors',
      'optical_step_05_slack_management', 'optical_step_06_strength_members',
      'optical_step_07_seals_dustcaps', 'optical_step_08_pole_id',
      // Optical — Phase B / Main Joint (steps 11-16)
      'optical_step_11_cable_entries', 'optical_step_12_strength_members',
      'optical_step_13_tube_routing', 'optical_step_14_tray_entries',
      'optical_step_15_coiling_protectors', 'optical_step_16_readable_labels',
    ]);

    const updatedFields: string[] = [];

    if (stepUpdates && typeof stepUpdates === 'object') {
      for (const [col, val] of Object.entries(stepUpdates)) {
        if (validStepColumns.has(col)) {
          setClauses.push(`${col} = $${paramIdx}`);
          params.push(Boolean(val));
          paramIdx++;
          updatedFields.push(col);
        }
      }
    }

    // Valid extracted data columns
    const validExtractedColumns = new Set([
      'extracted_pole_number', 'extracted_pole_height', 'extracted_cable_type',
      'extracted_joint_type', 'extracted_splice_count',
    ]);

    if (extractedDataUpdates && typeof extractedDataUpdates === 'object') {
      for (const [col, val] of Object.entries(extractedDataUpdates)) {
        if (validExtractedColumns.has(col)) {
          setClauses.push(`${col} = $${paramIdx}`);
          params.push(val as string | number);
          paramIdx++;
          updatedFields.push(col);
        }
      }
    }

    if (notes) {
      setClauses.push(`qa_notes = $${paramIdx}`);
      params.push(notes);
      paramIdx++;
      updatedFields.push('qa_notes');
    }

    // Feature ID rename/reassign
    if (featureIdUpdate && typeof featureIdUpdate === 'string') {
      setClauses.push(`feature_id = $${paramIdx}`);
      params.push(featureIdUpdate.trim());
      paramIdx++;
      updatedFields.push('feature_id');

      // If renaming to a valid pole pattern, try to backfill zone/PON and clear unidentified
      const validPolePattern = /^[A-Z]{3}\.P\./;
      if (validPolePattern.test(featureIdUpdate.trim())) {
        setClauses.push(`workflow_status = CASE WHEN workflow_status = 'unidentified' THEN 'pending' ELSE workflow_status END`);
      }
    }

    // Move to in_review if currently pending
    setClauses.push(`workflow_status = CASE WHEN workflow_status = 'pending' THEN 'in_review' ELSE workflow_status END`);

    // Execute update
    const updateQuery = `
      UPDATE construction_qa_reviews
      SET ${setClauses.join(', ')}
      WHERE id = $1::uuid
      RETURNING id
    `;

    const result = await sql.query(updateQuery, params);

    if (result.length === 0) {
      return apiResponse.notFound(res, 'Review', reviewId);
    }

    // Log activity
    if (updatedFields.length > 0) {
      const eventType = updatedFields.includes('feature_id') ? 'comment_added' : 'step_checked';
      const payload = updatedFields.includes('feature_id')
        ? { action: 'feature_id_renamed', new_feature_id: featureIdUpdate, updated_fields: updatedFields }
        : { updated_fields: updatedFields };

      await sql`
        INSERT INTO construction_qa_activity (review_id, event_type, actor, payload)
        VALUES (
          ${reviewId}::uuid,
          ${eventType},
          ${reviewedBy || 'unknown'},
          ${JSON.stringify(payload)}::jsonb
        )
      `;
    }

    return apiResponse.success(res, {
      reviewId,
      updatedFields,
    });
  } catch (error) {
    log.error('Review POST error', { module: 'construction-qa', error: (error as Error).message });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withPermission('construction-qa.qa-centre')(handler));
