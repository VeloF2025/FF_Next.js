/**
 * API Route: /api/activate/summary
 *
 * Purpose: Get consolidated DR summary data for the Summary page
 * Method: GET
 * Query: dropNumber (required)
 *
 * Consolidates data from:
 * - dr_photo_unified_reviews (main review data)
 * - oes_activations (activation date, team, optical metrics)
 * - drops (installation date, installer)
 * - qa_photo_reviews (submitter info)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { DRSummary, DRState, QADecision } from '@/modules/activate/types/summary.types';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

/**
 * Determine current state of the DR based on available data
 */
function determineState(
  hasReview: boolean,
  hasActivation: boolean,
  hasDecision: boolean
): DRState {
  if (hasDecision) return 'reviewed';
  if (hasActivation) return 'activated';
  if (hasReview) return 'installed';
  return 'not_reviewed';
}

/**
 * Extract step coverage from photos metadata
 */
function calculateStepsCovered(photosMetadata: any[]): number {
  if (!Array.isArray(photosMetadata)) return 0;

  const stepsSet = new Set<number>();
  for (const photo of photosMetadata) {
    const step = photo.step || photo.vlm_step;
    if (step && step >= 1 && step <= 10) {
      stepsSet.add(step);
    }
  }
  return stepsSet.size;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res);
  }

  const dropNumber = req.query.dropNumber as string;

  if (!dropNumber) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
  }

  try {
    log.info('DRSummary', `Fetching summary for ${dropNumber}`);

    // Query all relevant tables in parallel
    const [unifiedResult, oesResult, dropsResult, qaResult] = await Promise.all([
      // Main unified review data
      pool.query(
        `SELECT
           drop_number,
           project,
           photo_count,
           photos_metadata,
           ont_serial_scanned,
           ups_serial_scanned,
           final_qa_decision,
           feedback_message,
           feedback_sent_at,
           reviewed_at,
           reviewed_by,
           created_at,
           updated_at
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

      // QA photo reviews (submitter info)
      pool.query(
        `SELECT
           user_name,
           user_phone,
           project
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

    // Parse photos metadata
    const photosMetadata = unified?.photos_metadata || [];
    const photoCount = unified?.photo_count || photosMetadata.length || 0;
    const stepsComplete = calculateStepsCovered(photosMetadata);

    // Build photo preview (first 6 photos with step info)
    const photoPreview = photosMetadata
      .slice(0, 6)
      .map((photo: any) => ({
        url: `/api/activate/photo/${dropNumber}/${photo.filename}`,
        step: photo.step || photo.vlm_step || 0,
        filename: photo.filename,
      }));

    // Determine project from available sources
    const project = unified?.project || qa?.project || null;

    // Determine current state
    const hasReview = !!unified;
    const hasActivation = !!oes;
    const hasDecision = !!unified?.final_qa_decision;
    const currentState = determineState(hasReview, hasActivation, hasDecision);

    // Build the summary response
    const summary: DRSummary = {
      dropNumber,
      project,
      currentState,

      timeline: {
        installationDate: drop?.installation_date?.toISOString() || null,
        submittedAt: unified?.created_at?.toISOString() || null,
        reviewedAt: unified?.reviewed_at?.toISOString() || null,
        feedbackSentAt: unified?.feedback_sent_at?.toISOString() || null,
        activationDate: oes?.activation_date || null,
      },

      team: {
        submitter: {
          name: qa?.user_name || null,
          phone: qa?.user_phone || null,
        },
        installer: {
          name: drop?.installed_by_name || null,
          id: drop?.installed_by_id || null,
        },
        oesTeam: oes?.team || null,
        reviewer: unified?.reviewed_by || null,
      },

      qaStatus: {
        stepsComplete,
        totalSteps: 10,
        feedbackSent: !!unified?.feedback_sent_at,
        feedbackMessage: unified?.feedback_message || null,
        decision: (unified?.final_qa_decision as QADecision) || null,
      },

      equipment: {
        ontSerial: unified?.ont_serial_scanned || oes?.serial_number || null,
        upsSerial: unified?.ups_serial_scanned || null,
      },

      photoPreview,
    };

    log.info('DRSummary', `Summary fetched for ${dropNumber}`, {
      state: currentState,
      photoCount,
      stepsComplete,
    });

    return apiResponse.success(res, summary);
  } catch (error) {
    log.error('DRSummary', `Error fetching summary for ${dropNumber}`, error);
    return apiResponse.internalError(res, error);
  }
}
