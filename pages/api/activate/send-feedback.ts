/**
 * API Route: /api/activate/send-feedback
 *
 * Purpose: Generate and send WhatsApp feedback for a unified review
 * Method: POST
 *
 * Following FibreFlow standards:
 * - Uses apiResponse helper for consistent responses
 * - Neon PostgreSQL with ep-dry-night-a9qyh4sj endpoint
 * - Proper error handling and logging
 * - WhatsApp Bridge API integration
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

// CRITICAL: Use correct Neon endpoint (ep-dry-night-a9qyh4sj)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

interface SendFeedbackRequest {
  dropNumber: string;
  message?: string; // Optional: if not provided, will auto-generate
  autoGenerate?: boolean; // Flag to force auto-generation
}

interface Photo {
  filename: string;
  step: number | null;
  url: string;
}

interface UnifiedReview {
  drop_number: string;
  project: string;
  incorrect_steps: string[];
  incorrect_comments: Record<string, string>;
  ai_overall_status: 'PASS' | 'FAIL' | null;
  ai_average_score: number | null;
  feedback_sent: boolean;
  feedback_message: string | null;
  photos_metadata: Photo[] | null;
  photo_count: number;
}

/**
 * Step labels for feedback messages
 */
const STEP_LABELS: Record<number, string> = {
  1: 'House Photo',
  2: 'Cable from Pole',
  3: 'Entry Outside',
  4: 'Entry Inside',
  5: 'Wall',
  6: 'ONT Back',
  7: 'Power Meter',
  8: 'Final Installation',
  9: 'Green Lights',
  10: 'Signature',
};

/**
 * POST /api/activate/send-feedback
 * Send feedback to WhatsApp group
 */
async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  try {
    const { dropNumber, message, autoGenerate } = req.body as SendFeedbackRequest;

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    log.info(`Sending feedback for ${dropNumber}`, { autoGenerate });

    // 1. Get unified review from database
    const review = await getUnifiedReview(dropNumber);

    if (!review) {
      return apiResponse.notFound(res, 'Unified review', dropNumber);
    }

    // 2. Check if feedback already sent
    if (review.feedback_sent && !autoGenerate) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Feedback already sent for this review. Use autoGenerate=true to resend.');
    }

    // 3. Generate or use provided message
    let feedbackMessage: string;

    if (message && !autoGenerate) {
      feedbackMessage = message;
      log.info(`Using provided feedback message for ${dropNumber}`);
    } else {
      feedbackMessage = generateAutoFeedback(review);
      log.info(`Auto-generated feedback message for ${dropNumber}`);
    }

    // 4. Get WhatsApp group ID for project
    const groupId = getWhatsAppGroupId(review.project);

    if (!groupId) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, `No WhatsApp group configured for project: ${review.project}`);
    }

    // 5. Send to WhatsApp via Bridge API
    const sent = await sendToWhatsApp(groupId, feedbackMessage);

    if (!sent) {
      throw new Error('Failed to send message via WhatsApp Bridge');
    }

    // 6. Update database with feedback status
    await updateFeedbackStatus(dropNumber, feedbackMessage);

    log.info(`Feedback sent successfully for ${dropNumber}`);

    return apiResponse.success(res, {
      dropNumber,
      message: feedbackMessage,
      sent: true,
      sentAt: new Date().toISOString(),
    });
  } catch (error) {
    log.error('Error sending feedback:', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Get unified review from database
 */
async function getUnifiedReview(dropNumber: string): Promise<UnifiedReview | null> {
  const result = await pool.query(
    `
    SELECT
      drop_number,
      project,
      incorrect_steps,
      incorrect_comments,
      ai_overall_status,
      ai_average_score,
      feedback_sent,
      feedback_message,
      photos_metadata,
      photo_count
    FROM dr_photo_unified_reviews
    WHERE drop_number = $1;
    `,
    [dropNumber]
  );

  return result.rows[0] || null;
}

/**
 * Detect which steps are missing photos
 * Returns array of missing step numbers (1-10)
 */
function detectMissingSteps(photos: Photo[] | null): number[] {
  if (!photos || photos.length === 0) {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  }

  const stepsWithPhotos = new Set<number>();
  for (const photo of photos) {
    if (photo.step && photo.step >= 1 && photo.step <= 10) {
      stepsWithPhotos.add(photo.step);
    }
  }

  const missingSteps: number[] = [];
  for (let step = 1; step <= 10; step++) {
    if (!stepsWithPhotos.has(step)) {
      missingSteps.push(step);
    }
  }

  return missingSteps;
}

/**
 * Generate missing photos warning message
 */
function generateMissingPhotosWarning(missingSteps: number[]): string {
  if (missingSteps.length === 0 || missingSteps.length === 10) {
    return '';
  }

  let warning = '\n\n📷 *Missing photos:*\n';
  for (const step of missingSteps) {
    warning += `Step ${step} (${STEP_LABELS[step]}): Photo not present\n`;
  }

  return warning;
}

/**
 * Generate auto-feedback based on review results
 */
function generateAutoFeedback(review: UnifiedReview): string {
  // Safely handle null arrays from database
  const incorrectSteps = review.incorrect_steps || [];
  const incorrectComments = review.incorrect_comments || {};
  const incorrectCount = incorrectSteps.length;
  const aiPassed = review.ai_overall_status === 'PASS';
  const aiScore = review.ai_average_score || 0;

  // Detect missing photo steps
  const missingSteps = detectMissingSteps(review.photos_metadata);
  const missingPhotosWarning = generateMissingPhotosWarning(missingSteps);

  // Submission received - AI initial check passed
  if (incorrectCount === 0 && aiPassed) {
    let message = `📥 *${review.drop_number} - Submission received*\n\n` +
      `AI Pre-check: *PASS* (${aiScore.toFixed(1)}/10)\n\n` +
      `Photos submitted. Pending QA verification.`;

    message += missingPhotosWarning;

    return message;
  }

  // Submission received - AI flagged potential issues
  if (incorrectCount === 0 && !aiPassed) {
    let message = `📥 *${review.drop_number} - Submission received*\n\n` +
      `AI Pre-check: *NEEDS REVIEW* (${aiScore.toFixed(1)}/10)\n\n` +
      `Photos submitted but AI flagged potential issues. QA will review.`;

    message += missingPhotosWarning;

    return message;
  }

  // QA review found issues - needs resubmission
  if (incorrectCount > 0) {
    let message = `❌ *${review.drop_number} - ${incorrectCount} issue${incorrectCount > 1 ? 's' : ''} found*\n\n`;

    message += `Please address the following:\n\n`;

    incorrectSteps.forEach((stepStr) => {
      const step = parseInt(stepStr);
      const comment = incorrectComments[stepStr] || 'No comment provided';
      message += `*Step ${step}:* ${comment}\n`;
    });

    message += missingPhotosWarning;

    message += `\nPlease fix and resubmit.`;

    return message;
  }

  // Fallback (should not happen)
  return `*${review.drop_number}* - Submission received. Pending QA review.${missingPhotosWarning}`;
}

/**
 * Get WhatsApp group ID for a project
 * Note: Using hardcoded mappings from WA Monitor configuration
 * These match the groups configured in /opt/wa-monitor/prod/config/projects.yaml
 */
function getWhatsAppGroupId(project: string): string | null {
  const groupMappings: Record<string, string> = {
    'Lawley': '120363418298130331@g.us',
    'Mohadin': '120363421532174586@g.us',
    'Velo Test': '120363421664266245@g.us',
    'Mamelodi': '120363408849234743@g.us',
  };

  return groupMappings[project] || null;
}

/**
 * Send message to WhatsApp via Bridge API
 */
async function sendToWhatsApp(groupId: string, message: string): Promise<boolean> {
  try {
    // WhatsApp Bridge API endpoint (running on Velocity Server port 8083)
    const bridgeUrl = process.env.WHATSAPP_BRIDGE_URL || 'http://192.168.1.150:8083';

    const response = await fetch(`${bridgeUrl}/api/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: groupId,
        message: message,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      log.error('WhatsApp Bridge API error', {
        status: response.status,
        error: errorData,
      });
      return false;
    }

    const data = await response.json();
    log.info('Message sent via WhatsApp Bridge', { messageId: data.messageId });

    return true;
  } catch (error) {
    log.error('Failed to send message via WhatsApp Bridge', { error });
    return false;
  }
}

/**
 * Update database with feedback status
 */
async function updateFeedbackStatus(
  dropNumber: string,
  message: string
): Promise<void> {
  try {
    await pool.query(
      `
      UPDATE dr_photo_unified_reviews
      SET
        feedback_sent = true,
        feedback_message = $1,
        feedback_sent_at = NOW(),
        updated_at = NOW()
      WHERE drop_number = $2;
      `,
      [message, dropNumber]
    );

    log.info(`Updated feedback status for ${dropNumber}`);
  } catch (error) {
    log.error('Failed to update feedback status', { dropNumber, error });
    throw error;
  }
}

/**
 * Main handler
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res);
  }

  return handlePost(req, res);
}
