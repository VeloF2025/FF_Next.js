/**
 * API Route: /api/activate/summary
 *
 * Purpose: Get consolidated DR summary data for the Summary page
 * Method: GET
 * Query: dropNumber (required)
 *
 * Consolidates data from:
 * - BOSS API (1Map data: installer_name, signup_agent, photos, serials)
 * - dr_photo_unified_reviews (main review data)
 * - oes_activations (activation date, team, optical metrics)
 * - drops (installation date - fallback)
 * - qa_photo_reviews (submitter info)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { DRSummary, DRState, QADecision } from '@/modules/activate/types/summary.types';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/**
 * Determine current state of the DR based on available data
 */
function determineState(
  hasReview: boolean,
  hasActivation: boolean,
  qaDecision: string | null
): DRState {
  if (qaDecision === 'PASS') return 'reviewed_pass';
  if (qaDecision === 'FAIL') return 'reviewed_fail';
  if (qaDecision === 'REWORK_NEEDED') return 'reviewed_rework';
  if (qaDecision) return 'reviewed';
  if (hasActivation) return 'activated';
  if (hasReview) return 'installed';
  return 'not_reviewed';
}

/**
 * Extract step coverage from VLM categorization results (preferred) or photos metadata
 */
/**
 * Fetch DR data from BOSS API (1Map data)
 * Returns installer_name, signup_agent, and other 1Map data
 */
async function fetchBossApiData(dropNumber: string): Promise<{
  installer_name: string | null;
  signup_agent: string | null;
  ont_barcode: string | null;
  ups_serial: string | null;
} | null> {
  try {
    const response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000), // 5s timeout
    });

    if (!response.ok) {
      log.warn('DRSummary', `BOSS API returned ${response.status} for ${dropNumber}`);
      return null;
    }

    const data = await response.json();
    return {
      installer_name: data.installer_name || null,
      signup_agent: data.signup_agent || null,
      ont_barcode: data.ont_barcode || null,
      ups_serial: data.ups_serial || null,
    };
  } catch (error) {
    log.warn('DRSummary', `BOSS API fetch failed for ${dropNumber}`, error);
    return null;
  }
}

function calculateStepsCovered(vlmCategorization: any[], photosMetadata: any[]): number {
  const stepsSet = new Set<number>();

  // Prefer VLM categorization results as they are more accurate
  if (Array.isArray(vlmCategorization) && vlmCategorization.length > 0) {
    for (const result of vlmCategorization) {
      const step = result.human_override_step ?? result.vlm_predicted_step;
      if (step && step >= 1 && step <= 10) {
        stepsSet.add(step);
      }
    }
    return stepsSet.size;
  }

  // Fallback to photos_metadata
  if (Array.isArray(photosMetadata)) {
    for (const photo of photosMetadata) {
      const step = photo.step || photo.vlm_step;
      if (step && step >= 1 && step <= 10) {
        stepsSet.add(step);
      }
    }
  }
  return stepsSet.size;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const dropNumber = req.query.dropNumber as string;

  if (!dropNumber) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
  }

  try {
    log.info('DRSummary', `Fetching summary for ${dropNumber}`);

    // Query BOSS API (1Map) and database tables in parallel
    const [bossData, unifiedResult, oesResult, dropsResult, qaResult] = await Promise.all([
      // BOSS API: installer_name, signup_agent, serials from 1Map
      fetchBossApiData(dropNumber),
      // Main unified review data (including resubmission fields)
      pool.query(
        `SELECT
           drop_number,
           project,
           photo_count,
           photos_metadata,
           vlm_categorization_results,
           ont_serial_scanned,
           ups_serial_scanned,
           qa_decision,
           qa_decision_notes,
           feedback_message,
           feedback_sent_at,
           reviewed_at,
           reviewed_by,
           created_at,
           updated_at,
           submission_count,
           (submission_history->0->>'photo_count')::int as previous_photo_count
         FROM dr_photo_unified_reviews
         WHERE drop_number = $1`,
        [dropNumber]
      ),

      // OES activation data
      pool.query(
        `SELECT
           activation_date,
           team,
           serial_number,
           status
         FROM oes_activations
         WHERE drop_number = $1
         LIMIT 1`,
        [dropNumber]
      ),

      // Drops table (installation info)
      pool.query(
        `SELECT
           installation_date,
           installed_by_name,
           installed_by_id,
           project_id
         FROM drops
         WHERE drop_number = $1
         LIMIT 1`,
        [dropNumber]
      ),

      // QA photo reviews (submitter info + review date for installation fallback)
      pool.query(
        `SELECT
           user_name,
           sender_phone,
           project,
           review_date
         FROM qa_photo_reviews
         WHERE drop_number = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [dropNumber]
      ),
    ]);

    const unified = unifiedResult.rows[0];
    const oes = oesResult.rows[0];
    const drop = dropsResult.rows[0];
    const qa = qaResult.rows[0];

    // If no data found anywhere
    if (!unified && !oes && !drop && !qa) {
      return apiResponse.notFound(res, 'DR', dropNumber);
    }

    // Parse photos metadata and VLM categorization
    const photosMetadata = unified?.photos_metadata || [];
    const vlmCategorization = unified?.vlm_categorization_results || [];
    const photoCount = unified?.photo_count || photosMetadata.length || 0;
    const stepsComplete = calculateStepsCovered(vlmCategorization, photosMetadata);

    // Build photo preview (first 6 photos with step info from VLM)
    const photoPreview = photosMetadata
      .slice(0, 6)
      .map((photo: any) => {
        // Get step from VLM categorization if available
        const vlmResult = vlmCategorization.find(
          (v: any) => v.photo_filename === photo.filename
        );
        const step = vlmResult?.human_override_step ?? vlmResult?.vlm_predicted_step ?? photo.step ?? 0;
        return {
          url: `/api/activate/photo/${dropNumber}/${photo.filename}`,
          step,
          filename: photo.filename,
        };
      });

    // Determine project from available sources
    const project = unified?.project || qa?.project || null;

    // Determine current state (includes PASS/FAIL distinction)
    const hasReview = !!unified;
    const hasActivation = !!oes;
    const qaDecision = unified?.qa_decision || null;
    const currentState = determineState(hasReview, hasActivation, qaDecision);

    // Build the summary response
    const summary: DRSummary = {
      dropNumber,
      project,
      currentState,

      timeline: {
        // Installation date: prefer drops table, fallback to WA Monitor review_date
        installationDate: drop?.installation_date
          ? String(drop.installation_date)
          : qa?.review_date
            ? new Date(qa.review_date).toISOString()
            : null,
        submittedAt: unified?.created_at ? new Date(unified.created_at).toISOString() : null,
        reviewedAt: unified?.reviewed_at ? new Date(unified.reviewed_at).toISOString() : null,
        feedbackSentAt: unified?.feedback_sent_at ? new Date(unified.feedback_sent_at).toISOString() : null,
        activationDate: oes?.activation_date ? String(oes.activation_date) : null,
      },

      team: {
        submitter: {
          name: qa?.user_name || null,
          phone: qa?.sender_phone || null,
        },
        installer: {
          // Prefer BOSS API (1Map) data, fallback to drops table
          name: bossData?.installer_name || drop?.installed_by_name || null,
          id: drop?.installed_by_id || null,
        },
        // Signup agent from 1Map (fieldnme2)
        signupAgent: bossData?.signup_agent || null,
        oesTeam: oes?.team || null,
        reviewer: unified?.reviewed_by || null,
      },

      qaStatus: {
        stepsComplete,
        totalSteps: 10,
        feedbackSent: !!unified?.feedback_sent_at,
        feedbackMessage: unified?.feedback_message || null,
        decision: (unified?.qa_decision as QADecision) || null,
      },

      equipment: {
        ontSerial: unified?.ont_serial_scanned || oes?.serial_number || null,
        upsSerial: unified?.ups_serial_scanned || null,
      },

      photoPreview,

      // Resubmission tracking (Jan 2026)
      submission_count: unified?.submission_count || 1,
      is_resubmission: (unified?.submission_count || 1) > 1,
      previous_photo_count: unified?.previous_photo_count || null,
      feedback_message: unified?.feedback_message || null,
    };

    log.info('DRSummary', `Summary fetched for ${dropNumber}`, {
      state: currentState,
      photoCount,
      stepsComplete,
      isResubmission: (unified?.submission_count || 1) > 1,
    });

    return apiResponse.success(res, summary);
  } catch (error) {
    log.error('DRSummary', `Error fetching summary for ${dropNumber}`, error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
