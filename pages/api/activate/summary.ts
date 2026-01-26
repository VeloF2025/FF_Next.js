/**
 * API Route: /api/activate/summary
 *
 * Purpose: Get consolidated DR summary data for the Summary page
 * Method: GET
 * Query: dropNumber (required)
 *
 * UNIFIED ARCHITECTURE (Jan 2026):
 * ALL DR data is now stored in dr_photo_unified_reviews during processing.
 * This endpoint reads from the unified table - NO live API calls.
 *
 * Data sources (read-only, all pre-stored):
 * - dr_photo_unified_reviews (main data including contact info)
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
 * Build subscriber contact info from UNIFIED TABLE data
 * UNIFIED ARCHITECTURE: Contact info is stored in dr_photo_unified_reviews during processing
 * Returns both sources and whether they differ (to show Contact 1 / Contact 2)
 */
function buildSubscriberContact(
  unified: {
    subscriber_name: string | null;
    subscriber_phone: string | null;
    subscriber_email: string | null;
    subscriber_language: string | null;
    qcontact_name: string | null;
    qcontact_phone: string | null;
    qcontact_email: string | null;
  } | null
): DRSummary['subscriberContact'] {
  // Build 1Map contact (subscriber who signed up) from unified table
  const oneMapContact = (unified?.subscriber_name || unified?.subscriber_phone) ? {
    name: unified.subscriber_name || null,
    phone: unified.subscriber_phone || null,
    email: unified.subscriber_email || null,
    language: unified.subscriber_language || null,
  } : null;

  // Build QContact contact (customer who reported issue) from unified table
  const qContactContact = (unified?.qcontact_name || unified?.qcontact_phone) ? {
    name: unified.qcontact_name || null,
    phone: unified.qcontact_phone || null,
    email: unified.qcontact_email || null,
  } : null;

  // Determine if contacts differ
  let contactsDiffer = false;
  if (oneMapContact && qContactContact) {
    // Compare normalized phone numbers
    const normalizePhone = (p: string | null) => p?.replace(/\D/g, '').slice(-10) || '';
    const oneMapPhone = normalizePhone(oneMapContact.phone);
    const qContactPhone = normalizePhone(qContactContact.phone);

    // Differ if names are different OR phone numbers are different
    const namesDiffer = oneMapContact.name?.toLowerCase() !== qContactContact.name?.toLowerCase();
    const phonesDiffer = oneMapPhone !== qContactPhone && !!oneMapPhone && !!qContactPhone;
    contactsDiffer = namesDiffer || phonesDiffer;
  }

  return {
    oneMap: oneMapContact,
    qContact: qContactContact,
    contactsDiffer,
  };
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

    // UNIFIED ARCHITECTURE: All data from database tables only - NO live API calls
    const [unifiedResult, oesResult, dropsResult, qaResult] = await Promise.all([
      // Main unified review data (including contact info stored during processing)
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
           (submission_history->0->>'photo_count')::int as previous_photo_count,
           -- Contact info from 1Map (stored during process-new-dr)
           subscriber_name,
           subscriber_phone,
           subscriber_email,
           subscriber_language,
           signup_agent,
           installer_name,
           -- Contact info from QContact (stored during process-new-dr)
           qcontact_name,
           qcontact_phone,
           qcontact_email
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
          // UNIFIED: installer_name stored in unified table, fallback to drops
          name: unified?.installer_name || drop?.installed_by_name || null,
          id: drop?.installed_by_id || null,
        },
        // UNIFIED: signup_agent stored in unified table
        signupAgent: unified?.signup_agent || null,
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

      // UNIFIED: Subscriber contact info from unified table (stored during processing)
      subscriberContact: buildSubscriberContact(unified),

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
