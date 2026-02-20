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

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
      'civil_step_01_foundation', 'civil_step_02_full_pole', 'civil_step_03_pole_label',
      'civil_step_04_cca_tag', 'civil_step_05_vertical', 'civil_step_06_guy_wires',
      'civil_step_07_slack_bracket',
      'optical_step_01_cable_route', 'optical_step_02_attachment', 'optical_step_03_slack_coil',
      'optical_step_04_cable_label', 'optical_step_05_no_backfeed', 'optical_step_06_sag_ok',
      'splicing_step_01_dome_closed', 'splicing_step_02_slack_bracket',
      'splicing_step_03_emergency_loop', 'splicing_step_04_backhaul_sep',
      'splicing_step_05_tray_org', 'splicing_step_06_heat_shrinks', 'splicing_step_07_dome_label',
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
