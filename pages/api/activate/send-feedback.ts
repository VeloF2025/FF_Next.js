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
import { PHOTO_TYPE_TO_STEP, STEP_LABELS, STEP_DESCRIPTIONS } from '@/modules/activate/utils/stepMapper';

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
  original_type?: string;
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
  ont_serial_scanned: string | null;
  ups_serial_scanned: string | null;
  // WhatsApp threading fields
  wa_message_id: string | null;
  wa_sender_jid: string | null;
  wa_original_text: string | null;
  wa_group_jid: string | null;
}

// STEP_LABELS imported from stepMapper.ts

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

    // 5. Send to WhatsApp via Bridge API (with threading and @mention if available)
    const replyParams: WhatsAppReplyParams | undefined = review.wa_message_id
      ? {
          replyToId: review.wa_message_id,
          replyToSender: review.wa_sender_jid,
          quotedContent: review.wa_original_text || `${dropNumber}`,
          // Include sender JID for @mention tagging
          mentionJIDs: review.wa_sender_jid ? [review.wa_sender_jid] : [],
        }
      : undefined;

    // Add @mention prefix to message if we have sender info
    const messageWithMention = review.wa_sender_jid
      ? `@${extractPhoneFromJid(review.wa_sender_jid)} ${feedbackMessage}`
      : feedbackMessage;

    const sendResult = await sendToWhatsApp(groupId, messageWithMention, replyParams);

    if (!sendResult.success) {
      throw new Error('Failed to send message via WhatsApp Bridge');
    }

    // 6. Update database with feedback status and store our message ID for future threading
    // This allows re-reviews to thread off our feedback even if original DR had no message ID
    await updateFeedbackStatus(dropNumber, feedbackMessage, sendResult.messageId, groupId);

    log.info(`Feedback sent successfully for ${dropNumber}`);

    return apiResponse.success(res, {
      dropNumber,
      message: messageWithMention, // Return the actual message sent (with @mention if applicable)
      sent: true,
      sentAt: new Date().toISOString(),
      threading: {
        hadThreading: !!replyParams,
        hadMention: !!review.wa_sender_jid,
      },
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
      photo_count,
      ont_serial_scanned,
      ups_serial_scanned,
      wa_message_id,
      wa_sender_jid,
      wa_original_text,
      wa_group_jid
    FROM dr_photo_unified_reviews
    WHERE drop_number = $1;
    `,
    [dropNumber]
  );

  return result.rows[0] || null;
}

/**
 * Extract photo type from a photo object
 * Prefers original_type field, falls back to parsing filename
 */
function extractPhotoType(photo: Photo): string | null {
  // Prefer original_type if available
  if (photo.original_type) {
    return photo.original_type;
  }

  // Fallback: parse from filename (DR1234_ph_prop_001.jpg)
  const match = photo.filename.match(/DR\d+_([a-z_]+\d*)_\d+\./i);
  return match?.[1] ?? null;
}

/**
 * Detect which steps are missing photos
 * Dynamically maps photo types to steps using PHOTO_TYPE_TO_STEP
 * Returns array of missing step numbers (1-10)
 */
function detectMissingSteps(photos: Photo[] | null): number[] {
  if (!photos || photos.length === 0) {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  }

  const stepsWithPhotos = new Set<number>();

  for (const photo of photos) {
    // First try pre-computed step
    if (photo.step && photo.step >= 1 && photo.step <= 10) {
      stepsWithPhotos.add(photo.step);
      continue;
    }

    // Fallback: extract type and map to step dynamically
    const photoType = extractPhotoType(photo);
    if (photoType) {
      const step = PHOTO_TYPE_TO_STEP[photoType];
      if (step && step >= 1 && step <= 10) {
        stepsWithPhotos.add(step);
      }
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
 * Generate receipt acknowledgment message
 * Note: This is just a receipt - QA review (AI + human) will come later
 */
function generateAutoFeedback(review: UnifiedReview): string {
  const photoCount = review.photo_count || 0;
  const missingSteps = detectMissingSteps(review.photos_metadata);
  const stepsReceived = 10 - missingSteps.length;

  // Build message
  let message = `📥 *${review.drop_number} - Received*\n\n`;

  // Photo summary
  message += `📷 *${photoCount} photos* (${stepsReceived}/10 steps)\n`;

  // Serial numbers
  if (review.ont_serial_scanned) {
    message += `🔌 ONT: ${review.ont_serial_scanned}\n`;
  } else {
    message += `🔌 ONT: _Not scanned_\n`;
  }

  if (review.ups_serial_scanned) {
    message += `🔋 UPS: ${review.ups_serial_scanned}\n`;
  } else {
    message += `🔋 UPS: _Not scanned_\n`;
  }

  // Missing photos
  if (missingSteps.length > 0 && missingSteps.length < 10) {
    message += `\n⚠️ *Missing:*\n`;
    for (const step of missingSteps) {
      message += `• ${STEP_DESCRIPTIONS[step]}\n`;
    }
    message += `\nPlease upload missing photos.`;
  }

  // Footer
  message += `\n\n_QA review to follow._`;

  return message;
}

/**
 * Extract phone/user ID from a WhatsApp JID
 * JID formats: 218738725019786@lid or 27123456789@s.whatsapp.net
 */
function extractPhoneFromJid(jid: string): string {
  if (!jid) return '';
  // Extract everything before the @ symbol
  const atIndex = jid.indexOf('@');
  if (atIndex > 0) {
    return jid.substring(0, atIndex);
  }
  return jid;
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

interface WhatsAppReplyParams {
  replyToId?: string | null;
  replyToSender?: string | null;
  quotedContent?: string | null;
  mentionJIDs?: string[];
}

interface SendResult {
  success: boolean;
  messageId?: string;
}

/**
 * Send message to WhatsApp via Bridge API
 * Supports threaded replies and @mentions when replyParams are provided
 * Returns the sent message ID for future threading
 */
async function sendToWhatsApp(
  groupId: string,
  message: string,
  replyParams?: WhatsAppReplyParams
): Promise<SendResult> {
  try {
    // WhatsApp Bridge API endpoint (running on Velocity Server port 8083)
    const bridgeUrl = process.env.WHATSAPP_BRIDGE_URL || 'http://192.168.1.150:8083';

    // Build request body with optional reply threading and mentions
    const requestBody: Record<string, string | string[]> = {
      recipient: groupId,
      message: message,
    };

    // Add reply threading params if available (for threaded replies)
    if (replyParams?.replyToId && replyParams?.replyToSender) {
      requestBody.replyToId = replyParams.replyToId;
      requestBody.replyToSender = replyParams.replyToSender;
      if (replyParams.quotedContent) {
        requestBody.quotedContent = replyParams.quotedContent;
      }
      // Add mentions to tag the original sender
      if (replyParams.mentionJIDs && replyParams.mentionJIDs.length > 0) {
        requestBody.mentionJIDs = replyParams.mentionJIDs;
      }
      log.info('Sending threaded reply with mention', {
        replyToId: replyParams.replyToId,
        replyToSender: replyParams.replyToSender,
        hasMention: !!(replyParams.mentionJIDs?.length),
      });
    }

    const response = await fetch(`${bridgeUrl}/api/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      log.error('WhatsApp Bridge API error', {
        status: response.status,
        error: errorData,
      });
      return { success: false };
    }

    const data = await response.json();
    log.info('Message sent via WhatsApp Bridge', {
      messageId: data.messageId,
      wasThreadedReply: !!(replyParams?.replyToId),
    });

    return { success: true, messageId: data.messageId };
  } catch (error) {
    log.error('Failed to send message via WhatsApp Bridge', { error });
    return { success: false };
  }
}

/**
 * Update database with feedback status
 * Also stores our sent message ID so future re-reviews can thread off it
 */
async function updateFeedbackStatus(
  dropNumber: string,
  message: string,
  sentMessageId?: string,
  groupJid?: string
): Promise<void> {
  try {
    await pool.query(
      `
      UPDATE dr_photo_unified_reviews
      SET
        feedback_sent = true,
        feedback_message = $1,
        feedback_sent_at = NOW(),
        -- Store our feedback message ID for future threading (re-reviews)
        -- Only update if we don't already have an original message ID
        wa_message_id = COALESCE(wa_message_id, $3),
        wa_group_jid = COALESCE(wa_group_jid, $4),
        updated_at = NOW()
      WHERE drop_number = $2;
      `,
      [message, dropNumber, sentMessageId || null, groupJid || null]
    );

    log.info(`Updated feedback status for ${dropNumber}`, {
      storedMessageId: !!sentMessageId,
    });
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
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  return handlePost(req, res);
}
