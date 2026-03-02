/**
 * Pole Install Completion Service
 *
 * When a pole_install_session reaches all required photos, this service:
 * 1. Creates a construction_qa_reviews record
 * 2. Sets civil step flags based on classified photos
 * 3. Links field_ops_wa_photos to the QA review
 *
 * @module field-ops/services/poleInstallCompletionService
 */

import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';

const logger = createLogger('poleInstallCompletionService');

function getDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
  return neon(process.env.DATABASE_URL);
}

interface CompletedSession {
  id: string;
  project_id: string;
  pole_number: string | null;
  wa_group_jid: string;
  sender_jid: string | null;
  before_count: number;
  during_count: number;
  depth_count: number;
  endplate_count: number;
  compaction_count: number;
  level_count: number;
  stumping_count: number;
  housekeeping_count: number;
  signature_count: number;
  total_photos: number;
}

/**
 * Create a construction_qa_reviews record from a completed pole install session
 * and link the associated photos.
 */
export async function linkSessionToQaReview(sessionId: string): Promise<string | null> {
  const sql = getDb();

  try {
    // Fetch session
    const sessions = await sql`
      SELECT * FROM pole_install_sessions WHERE id = ${sessionId}::uuid
    `;
    if (sessions.length === 0) {
      logger.error('Session not found for QA link', { sessionId });
      return null;
    }
    const session = sessions[0] as unknown as CompletedSession;

    // Check if QA review already exists for this pole + project
    const existing = await sql`
      SELECT id FROM construction_qa_reviews
      WHERE project_id = ${session.project_id}::uuid
        AND feature_id = ${session.pole_number}
        AND discipline = 'civil'
      LIMIT 1
    `;

    let qaReviewId: string;

    const existingReview = existing[0];
    if (existingReview) {
      qaReviewId = String(existingReview.id);
    } else {
      // Create new QA review
      const inserted = await sql`
        INSERT INTO construction_qa_reviews (
          project_id, discipline, feature_type, feature_id,
          photo_count, photo_sources, wa_group_jid, wa_technician_phone,
          workflow_status,
          civil_step_01_before_photo,
          civil_step_02_during_photo,
          civil_step_03_depth_photo,
          civil_step_04_end_plates,
          civil_step_05_compaction,
          civil_step_06_level_check,
          civil_step_07_after_photo,
          civil_step_08_signature
        ) VALUES (
          ${session.project_id}::uuid, 'civil', 'pole', ${session.pole_number},
          ${session.total_photos}, ARRAY['whatsapp']::text[], ${session.wa_group_jid},
          ${session.sender_jid},
          'pending',
          ${session.before_count > 0},
          ${session.during_count > 0},
          ${session.depth_count > 0},
          ${session.endplate_count > 0},
          ${session.compaction_count > 0},
          ${session.level_count > 0},
          ${session.stumping_count > 0},
          ${session.signature_count > 0}
        )
        RETURNING id
      `;
      const newReview = inserted[0];
      qaReviewId = String(newReview?.id ?? '');
    }

    // Link session to QA review
    await sql`
      UPDATE pole_install_sessions
      SET construction_qa_review_id = ${qaReviewId}::uuid, updated_at = NOW()
      WHERE id = ${sessionId}::uuid
    `;

    // Link photos to QA review
    await sql`
      UPDATE field_ops_wa_photos
      SET construction_qa_review_id = ${qaReviewId}::uuid
      WHERE pole_install_session_id = ${sessionId}::uuid
    `;

    logger.info('Session linked to QA review', { sessionId, qaReviewId });
    return qaReviewId;
  } catch (err) {
    logger.error('Failed to link session to QA review', {
      error: err instanceof Error ? err.message : String(err),
      sessionId,
    });
    return null;
  }
}
