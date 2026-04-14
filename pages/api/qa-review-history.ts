/**
 * API Route: /api/qa-review-history
 *
 * Purpose: Get QA review history for a DR from multiple sources:
 * 1. qa_review_history table (historic Excel imports)
 * 2. dr_photo_unified_reviews table (desktop QA wizard)
 *
 * Method: GET
 * Query: dropNumber - required
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const log = createLogger('QAReviewHistory');

interface QAReviewRecord {
  id: string;
  drop_number: string;
  project: string | null;
  review_date: string | null;
  reviewer: string | null;
  step_01_house_photo: boolean;
  step_02_cable_from_pole: boolean;
  step_03_cable_entry_outside: boolean;
  step_04_cable_entry_inside: boolean;
  step_05_wall_installation: boolean;
  step_06_ont_back: boolean;
  step_07_power_meter: boolean;
  step_08_final_installation: boolean;
  step_09_green_lights: boolean;
  step_10_signature: boolean;
  completed_photos: number | null;
  outstanding_photos: number | null;
  pass_fail: string | null;
  percent_complete: string | null;
  comment: string | null;
  steps_passed: number;
  steps_total: number;
  steps_percent: number;
  imported_at: string;
  source: 'excel_import' | 'desktop_qa';
}

function getDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not configured');
  }
  return neon(connectionString);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const { dropNumber } = req.query;

  if (!dropNumber || typeof dropNumber !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'dropNumber query parameter is required',
    });
  }

  try {
    const sql = getDb();
    const reviews: QAReviewRecord[] = [];

    // 1. Fetch historic reviews from qa_review_history table
    log.info(`Fetching Excel reviews for ${dropNumber}`);
    const excelReviews = await sql`
      SELECT
        id, drop_number, project, review_date, reviewer,
        step_01_house_photo, step_02_cable_from_pole, step_03_cable_entry_outside,
        step_04_cable_entry_inside, step_05_wall_installation, step_06_ont_back,
        step_07_power_meter, step_08_final_installation, step_09_green_lights,
        step_10_signature, completed_photos, outstanding_photos,
        pass_fail, percent_complete, comment, imported_at
      FROM qa_review_history
      WHERE drop_number = ${dropNumber}
      ORDER BY review_date DESC NULLS LAST
    `;

    for (const row of excelReviews) {
      // Calculate steps passed
      const steps = [
        row.step_01_house_photo, row.step_02_cable_from_pole, row.step_03_cable_entry_outside,
        row.step_04_cable_entry_inside, row.step_05_wall_installation, row.step_06_ont_back,
        row.step_07_power_meter, row.step_08_final_installation, row.step_09_green_lights,
        row.step_10_signature,
      ];
      const stepsPassed = steps.filter((s) => s === true).length;
      const stepsTotal = 10;
      const stepsPercent = Math.round((stepsPassed / stepsTotal) * 100);

      reviews.push({
        id: row.id,
        drop_number: row.drop_number,
        project: row.project,
        review_date: row.review_date,
        reviewer: row.reviewer,
        step_01_house_photo: row.step_01_house_photo || false,
        step_02_cable_from_pole: row.step_02_cable_from_pole || false,
        step_03_cable_entry_outside: row.step_03_cable_entry_outside || false,
        step_04_cable_entry_inside: row.step_04_cable_entry_inside || false,
        step_05_wall_installation: row.step_05_wall_installation || false,
        step_06_ont_back: row.step_06_ont_back || false,
        step_07_power_meter: row.step_07_power_meter || false,
        step_08_final_installation: row.step_08_final_installation || false,
        step_09_green_lights: row.step_09_green_lights || false,
        step_10_signature: row.step_10_signature || false,
        completed_photos: row.completed_photos,
        outstanding_photos: row.outstanding_photos,
        pass_fail: row.pass_fail,
        percent_complete: row.percent_complete,
        comment: row.comment,
        steps_passed: stepsPassed,
        steps_total: stepsTotal,
        steps_percent: stepsPercent,
        imported_at: row.imported_at,
        source: 'excel_import',
      });
    }

    // 2. Fetch desktop QA wizard review from dr_photo_unified_reviews
    log.info(`Fetching desktop QA review for ${dropNumber}`);
    const desktopReviews = await sql`
      SELECT
        u.id,
        u.drop_number,
        u.project,
        u.qa_decision,
        u.qa_decision_at,
        u.qa_decision_by,
        u.qa_decision_notes,
        u.qa_decision_reasons,
        u.human_reviewer_id,
        u.human_review_completed_at,
        u.photo_count,
        u.step_01_house_photo,
        u.step_02_cable_from_pole,
        u.step_03_entry_outside,
        u.step_04_entry_inside,
        u.step_05_wall,
        u.step_06_ont_back,
        u.step_07_power_meter,
        u.step_08_final_installation,
        u.step_09_green_lights,
        u.step_10_signature,
        CASE
          WHEN u.qa_decision_by = 'system' THEN 'System'
          WHEN u.qa_decision_by IS NOT NULL AND u.qa_decision_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               THEN (SELECT CONCAT_WS(' ', first_name, last_name) FROM users WHERE id::text = u.qa_decision_by)
          WHEN u.human_reviewer_id IS NOT NULL AND u.human_reviewer_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               THEN (SELECT CONCAT_WS(' ', first_name, last_name) FROM users WHERE id::text = u.human_reviewer_id)
          ELSE COALESCE(u.qa_decision_by, 'Unknown')
        END as reviewer_name
      FROM dr_photo_unified_reviews u
      WHERE u.drop_number = ${dropNumber}
        AND u.qa_decision IS NOT NULL
    `;

    for (const row of desktopReviews) {
      // Use step columns directly from the query
      const stepData: Record<number, boolean> = {
        1: row.step_01_house_photo || false,
        2: row.step_02_cable_from_pole || false,
        3: row.step_03_entry_outside || false,
        4: row.step_04_entry_inside || false,
        5: row.step_05_wall || false,
        6: row.step_06_ont_back || false,
        7: row.step_07_power_meter || false,
        8: row.step_08_final_installation || false,
        9: row.step_09_green_lights || false,
        10: row.step_10_signature || false,
      };

      // Calculate steps passed
      const steps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const stepsPassed = steps.filter((s) => stepData[s] === true).length;
      const stepsTotal = 10;
      const stepsPercent = Math.round((stepsPassed / stepsTotal) * 100);

      // Map qa_decision to pass_fail
      const passFail = row.qa_decision === 'PASS' ? 'PASS' :
        row.qa_decision === 'FAIL' ? 'FAIL' :
        row.qa_decision === 'REWORK_NEEDED' ? 'REWORK' : row.qa_decision;

      // Format fail reasons as comment if present
      let comment = row.qa_decision_notes || '';
      if (row.qa_decision_reasons && Array.isArray(row.qa_decision_reasons) && row.qa_decision_reasons.length > 0) {
        const reasonsText = row.qa_decision_reasons.join(', ');
        comment = comment ? `${comment}\n\nReasons: ${reasonsText}` : `Reasons: ${reasonsText}`;
      }

      reviews.push({
        id: row.id + '-desktop',
        drop_number: row.drop_number,
        project: row.project,
        review_date: row.qa_decision_at || row.human_review_completed_at,
        reviewer: row.reviewer_name || 'Unknown',
        step_01_house_photo: stepData[1] ?? false,
        step_02_cable_from_pole: stepData[2] ?? false,
        step_03_cable_entry_outside: stepData[3] ?? false,
        step_04_cable_entry_inside: stepData[4] ?? false,
        step_05_wall_installation: stepData[5] ?? false,
        step_06_ont_back: stepData[6] ?? false,
        step_07_power_meter: stepData[7] ?? false,
        step_08_final_installation: stepData[8] ?? false,
        step_09_green_lights: stepData[9] ?? false,
        step_10_signature: stepData[10] ?? false,
        completed_photos: row.photo_count,
        outstanding_photos: null,
        pass_fail: passFail,
        percent_complete: `${stepsPercent}%`,
        comment: comment || null,
        steps_passed: stepsPassed,
        steps_total: stepsTotal,
        steps_percent: stepsPercent,
        imported_at: row.qa_decision_at || row.human_review_completed_at || new Date().toISOString(),
        source: 'desktop_qa',
      });
    }

    // Sort all reviews by date (newest first)
    reviews.sort((a, b) => {
      const dateA = a.review_date ? new Date(a.review_date).getTime() : 0;
      const dateB = b.review_date ? new Date(b.review_date).getTime() : 0;
      return dateB - dateA;
    });

    log.info(`Found ${reviews.length} reviews for ${dropNumber} (${excelReviews.length} Excel, ${desktopReviews.length} desktop)`);

    return res.status(200).json({
      success: true,
      reviews,
      counts: {
        total: reviews.length,
        excel: excelReviews.length,
        desktop: desktopReviews.length,
      },
      _v: '2026-01-27-v2',
    });
  } catch (error) {
    log.error(`Error fetching reviews for ${dropNumber}`, { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
