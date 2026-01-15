/**
 * API Route: /api/dr-photo-unified/send-feedback
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

interface UnifiedReview {
  drop_number: string;
  project: string;
  incorrect_steps: string[];
  incorrect_comments: Record<string, string>;
  ai_overall_status: 'PASS' | 'FAIL' | null;
  ai_average_score: number | null;
  feedback_sent: boolean;
  feedback_message: string | null;
}

/**
 * POST /api/dr-photo-unified/send-feedback
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
    const groupId = await getWhatsAppGroupId(review.project);

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
      feedback_message
    FROM dr_photo_unified_reviews
    WHERE drop_number = $1;
    `,
    [dropNumber]
  );

  return result.rows[0] || null;
}

/**
 * Generate auto-feedback based on review results
 */
function generateAutoFeedback(review: UnifiedReview): string {
  const incorrectCount = review.incorrect_steps.length;
  const aiPassed = review.ai_overall_status === 'PASS';
  const aiScore = review.ai_average_score || 0;

  // All passed - both manual and AI
  if (incorrectCount === 0 && aiPassed) {
    return `✅ *${review.drop_number} - All steps completed correctly!*\n\n` +
      `AI Evaluation: *PASS* (${aiScore.toFixed(1)}/10)\n\n` +
      `Great work! No issues found. Installation meets all quality standards.`;
  }

  // Manual passed, but AI flagged concerns
  if (incorrectCount === 0 && !aiPassed) {
    return `⚠️ *${review.drop_number} - Manual review passed, but AI flagged concerns*\n\n` +
      `AI Evaluation: *FAIL* (${aiScore.toFixed(1)}/10)\n\n` +
      `Please review the AI feedback and address any potential issues before proceeding.`;
  }

  // Manual review found issues
  if (incorrectCount > 0) {
    let message = `❌ *${review.drop_number} - ${incorrectCount} step${incorrectCount > 1 ? 's' : ''} marked incorrect*\n\n`;

    message += `Please address the following issues:\n\n`;

    review.incorrect_steps.forEach((stepStr) => {
      const step = parseInt(stepStr);
      const comment = review.incorrect_comments[stepStr] || 'No comment provided';
      message += `*Step ${step}:* ${comment}\n`;
    });

    message += `\nPlease fix these issues and resubmit photos.`;

    return message;
  }

  // Fallback (should not happen)
  return `*${review.drop_number}* - Review completed. Please check the system for details.`;
}

/**
 * Get WhatsApp group ID for a project
 */
async function getWhatsAppGroupId(project: string): Promise<string | null> {
  // Query the database for WhatsApp group configuration
  const result = await pool.query(
    `
    SELECT whatsapp_group_id
    FROM qa_photo_reviews
    WHERE project = $1
    LIMIT 1;
    `,
    [project]
  );

  if (result.rows.length === 0) {
    // Fallback to hardcoded mappings (from WA Monitor configuration)
    const groupMappings: Record<string, string> = {
      'Lawley': '120363418298130331@g.us',
      'Mohadin': '120363421532174586@g.us',
      'Velo Test': '120363421664266245@g.us',
      'Mamelodi': '120363408849234743@g.us',
    };

    return groupMappings[project] || null;
  }

  return result.rows[0].whatsapp_group_id;
}

/**
 * Send message to WhatsApp via Bridge API
 */
async function sendToWhatsApp(groupId: string, message: string): Promise<boolean> {
  try {
    // WhatsApp Bridge API endpoint (running on Velocity Server)
    const bridgeUrl = process.env.WHATSAPP_BRIDGE_URL || 'http://192.168.1.150:8080';

    const response = await fetch(`${bridgeUrl}/api/send-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chatId: groupId,
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
