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

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import pool from '@/lib/db';
import { PHOTO_TYPE_TO_STEP, STEP_LABELS, STEP_DESCRIPTIONS } from '@/modules/activate/utils/stepMapper';
import { logFeedbackSent } from '@/modules/activate/services/activityLogService';

interface SendFeedbackRequest {
  dropNumber: string;
  message?: string; // Optional: if not provided, will auto-generate
  autoGenerate?: boolean; // Flag to force auto-generation
  decision?: 'PASS' | 'FAIL' | 'REWORK_NEEDED'; // QA decision
  project?: string; // Project name
  destination?: 'group' | 'private' | 'both'; // Where to send feedback (default: group)
  staffId?: string; // Staff member to @mention (optional)
  sendStaffPrivate?: boolean; // Also send private copy to selected staff
  createTask?: boolean; // Whether to create follow-up task
  qaFindings?: {
    photoCoverage?: { covered: number; total: number; missing: number[] };
    powerMeter?: { value: number | null; inRange: boolean };
    serialValidation?: Record<string, unknown>;
    reasons?: string[];
    notes?: string;
  };
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
    const {
      dropNumber,
      message,
      autoGenerate,
      decision,
      project,
      destination = 'group', // Default to group for backwards compatibility
      staffId,
      sendStaffPrivate,
      createTask,
      qaFindings,
    } = req.body as SendFeedbackRequest;

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    log.info(`Sending feedback for ${dropNumber}`, { autoGenerate, staffId, createTask });

    // 1. Get unified review from database
    const review = await getUnifiedReview(dropNumber);

    if (!review) {
      return apiResponse.notFound(res, 'Unified review', dropNumber);
    }

    // 2. Check if feedback already sent (autoGenerate flag allows resending)
    if (review.feedback_sent && !autoGenerate) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Feedback already sent for this review. Use autoGenerate=true to resend.');
    }

    // 3. Generate or use provided message
    // Always prefer a provided message — autoGenerate only bypasses the
    // feedback_sent guard above, it should NOT override a custom message.
    let feedbackMessage: string;

    if (message) {
      feedbackMessage = message;
      log.info(`Using provided feedback message for ${dropNumber}`, { isResend: review.feedback_sent });
    } else {
      feedbackMessage = generateAutoFeedback(review);
      log.info(`Auto-generated feedback message for ${dropNumber}`);
    }

    // 4. Resolve project name - fallback to drops table if null
    let projectName = review.project || project;
    if (!projectName) {
      const fallback = await pool.query(
        `SELECT p.project_name FROM drops d JOIN projects p ON d.project_id = p.id WHERE d.drop_number = $1`,
        [dropNumber]
      );
      if (fallback.rows[0]?.project_name) {
        projectName = fallback.rows[0].project_name;
        // Backfill the unified review so this doesn't happen again
        await pool.query(
          `UPDATE dr_photo_unified_reviews SET project = $1, updated_at = NOW() WHERE drop_number = $2 AND project IS NULL`,
          [projectName, dropNumber]
        );
        log.info(`Backfilled project for ${dropNumber}: ${projectName}`);
      }
    }

    // Get WhatsApp group ID for project
    const groupId = getWhatsAppGroupId(projectName || '');

    if (!groupId) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, `No WhatsApp group configured for project: ${projectName || 'unknown'}`);
    }

    // 5. Get staff WhatsApp ID if staffId provided
    let staffJid: string | null = null;
    if (staffId) {
      staffJid = await getStaffWhatsAppJid(staffId);
      if (staffJid) {
        log.info('Adding staff to mentions', { staffId, staffJid });
      } else {
        log.warn('Staff has no WhatsApp ID configured', { staffId });
      }
    }

    // 6. Validate destination requirements
    const needsPrivate = destination === 'private' || destination === 'both';
    if (needsPrivate && !review.wa_sender_jid) {
      return apiResponse.error(
        res,
        ErrorCode.BAD_REQUEST,
        'Cannot send private message: technician JID not available for this DR'
      );
    }

    // 7. Send to WhatsApp based on destination
    const sendResults: {
      group?: SendResult;
      technicianPrivate?: SendResult;
      staffPrivate?: SendResult;
    } = {};

    // Build mentions array for group messages
    const mentionJIDs: string[] = [];
    if (review.wa_sender_jid) {
      mentionJIDs.push(review.wa_sender_jid);
    }
    if (staffJid && staffJid !== review.wa_sender_jid) {
      mentionJIDs.push(staffJid);
    }

    // Build reply params for threading and logging
    const replyParams: WhatsAppReplyParams = {
      replyToId: review.wa_message_id || undefined,
      replyToSender: review.wa_sender_jid || undefined,
      quotedContent: review.wa_original_text || `${dropNumber}`,
      mentionJIDs: mentionJIDs.length > 0 ? mentionJIDs : undefined,
      dropNumber: dropNumber,
      project: review.project,
    };

    // Note: We DON'T add @phone text to the message here
    // The bridge adds the @mention text AND the MentionedJID context info
    // This allows WhatsApp to display the user's name instead of raw number
    const groupMessage = feedbackMessage;

    // Send to GROUP if destination is 'group' or 'both'
    if (destination === 'group' || destination === 'both') {
      log.info(`Sending feedback to group for ${dropNumber}`, { groupId, mentionJIDs });
      sendResults.group = await sendToWhatsApp(groupId, groupMessage, replyParams);
      if (!sendResults.group.success) {
        log.error('Failed to send to group', { dropNumber, groupId });
      }
    }

    // Send PRIVATE to technician if destination is 'private' or 'both'
    if ((destination === 'private' || destination === 'both') && review.wa_sender_jid) {
      log.info(`Sending private feedback to technician for ${dropNumber}`, {
        technicianJid: review.wa_sender_jid,
      });
      // Private message - no @mentions needed (it's a direct message)
      sendResults.technicianPrivate = await sendToWhatsApp(review.wa_sender_jid, feedbackMessage, {
        dropNumber,
        project: review.project,
      });
      if (!sendResults.technicianPrivate.success) {
        log.error('Failed to send private to technician', { dropNumber });
      }
    }

    // Send PRIVATE copy to staff if requested and staffJid available
    if (sendStaffPrivate && staffJid) {
      log.info(`Sending private copy to staff for ${dropNumber}`, { staffJid });
      sendResults.staffPrivate = await sendToWhatsApp(staffJid, feedbackMessage, {
        dropNumber,
        project: review.project,
      });
      if (!sendResults.staffPrivate.success) {
        log.error('Failed to send private to staff', { dropNumber, staffJid });
      }
    }

    // Check if at least one message was sent successfully
    const anySent =
      sendResults.group?.success ||
      sendResults.technicianPrivate?.success ||
      sendResults.staffPrivate?.success;

    if (!anySent) {
      throw new Error('Failed to send message via WhatsApp Bridge to any destination');
    }

    // 8. Update database with feedback status
    // Use group message ID for threading if available, otherwise use technician private message ID
    const sentMessageId = sendResults.group?.messageId || sendResults.technicianPrivate?.messageId;
    await updateFeedbackStatus(dropNumber, feedbackMessage, sentMessageId, groupId);

    // 9. Create follow-up task if requested or if decision is FAIL/REWORK_NEEDED
    let taskId: string | null = null;
    const shouldCreateTask = createTask || decision === 'FAIL' || decision === 'REWORK_NEEDED';
    if (shouldCreateTask) {
      const projectId = project ? await getProjectId(project) : null;
      taskId = await createQaReworkTask({
        dropNumber,
        projectId,
        staffId: staffId || null,
        decision: decision || 'FAIL',
        qaFindings,
      });
    }

    log.info(`Feedback sent successfully for ${dropNumber}`, {
      destination,
      sentToGroup: !!sendResults.group?.success,
      sentToTechnicianPrivate: !!sendResults.technicianPrivate?.success,
      sentToStaffPrivate: !!sendResults.staffPrivate?.success,
      taskCreated: !!taskId,
    });

    // Log activity for audit trail
    try {
      await logFeedbackSent(dropNumber, groupId || 'private', sentMessageId || undefined);
    } catch (activityError) {
      log.warn('SendFeedback', `Failed to log activity for ${dropNumber}`, activityError);
    }

    return apiResponse.success(res, {
      dropNumber,
      destination,
      sentTo: {
        group: sendResults.group?.success || false,
        technicianPrivate: sendResults.technicianPrivate?.success || false,
        staffPrivate: sendResults.staffPrivate?.success || false,
      },
      message: destination === 'group' || destination === 'both' ? groupMessage : feedbackMessage,
      sent: true,
      sentAt: new Date().toISOString(),
      threading: {
        hadThreading: !!(replyParams && (destination === 'group' || destination === 'both')),
        technicianMentioned: !!(review.wa_sender_jid && (destination === 'group' || destination === 'both')),
        staffMentioned: !!(staffJid && (destination === 'group' || destination === 'both')),
      },
      task: taskId ? { id: taskId, created: true } : null,
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
 * Get staff member's WhatsApp ID by staff ID
 * Returns the whatsapp_id as JID format (with @lid suffix)
 */
async function getStaffWhatsAppJid(staffId: string): Promise<string | null> {
  try {
    const result = await pool.query(
      `SELECT whatsapp_id FROM staff WHERE id = $1 AND whatsapp_id IS NOT NULL`,
      [staffId]
    );
    if (result.rows[0]?.whatsapp_id) {
      const whatsappId = result.rows[0].whatsapp_id;
      // Add @lid suffix if not present
      return whatsappId.includes('@') ? whatsappId : `${whatsappId}@lid`;
    }
    return null;
  } catch (error) {
    log.error('Failed to get staff WhatsApp ID', { staffId, error });
    return null;
  }
}

/**
 * Get project ID by project name
 */
async function getProjectId(projectName: string): Promise<string | null> {
  try {
    const result = await pool.query(
      `SELECT id FROM projects WHERE project_name = $1`,
      [projectName]
    );
    return result.rows[0]?.id || null;
  } catch (error) {
    log.error('Failed to get project ID', { projectName, error });
    return null;
  }
}

/**
 * Create a follow-up task for QA rework
 */
async function createQaReworkTask(params: {
  dropNumber: string;
  projectId: string | null;
  staffId: string | null;
  decision: string;
  qaFindings?: Record<string, unknown>;
}): Promise<string | null> {
  try {
    const { dropNumber, projectId, staffId, decision, qaFindings } = params;

    const title = `QA Rework: ${dropNumber}`;
    const priority = decision === 'FAIL' ? 'high' : 'medium';

    // Build description from QA findings
    let description = `QA decision: ${decision}\n\n`;
    if (qaFindings?.reasons && Array.isArray(qaFindings.reasons) && qaFindings.reasons.length > 0) {
      description += `Issues:\n${(qaFindings.reasons as string[]).map(r => `- ${r}`).join('\n')}\n\n`;
    }
    if (qaFindings?.notes) {
      description += `Notes: ${qaFindings.notes}`;
    }

    const result = await pool.query(
      `
      INSERT INTO tasks (
        task_code, title, description, project_id, assigned_to,
        priority, status, category, metadata, created_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, 'pending', 'QA_REWORK', $7, NOW(), NOW()
      )
      RETURNING id
      `,
      [
        `QA-${dropNumber}`,
        title,
        description,
        projectId,
        staffId,
        priority,
        JSON.stringify({ dropNumber, decision, qaFindings }),
      ]
    );

    const taskId = result.rows[0]?.id;
    log.info('Created QA rework task', { taskId, dropNumber, decision });
    return taskId;
  } catch (error) {
    log.error('Failed to create QA rework task', { dropNumber: params.dropNumber, error });
    return null;
  }
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
  dropNumber?: string;
  project?: string;
}

interface SendResult {
  success: boolean;
  messageId?: string;
}

/**
 * Send message to WhatsApp via wa-feedback service
 * All messages (group and private) go through wa-feedback (port 8092) which proxies to bridge-2 (8083)
 * Bridge-2 uses phone number 063 841 2276
 * Returns the sent message ID for future threading
 */
async function sendToWhatsApp(
  recipient: string,
  message: string,
  replyParams?: WhatsAppReplyParams
): Promise<SendResult> {
  try {
    // wa-feedback service (port 8092) - proxies to bridge-2 (port 8083)
    // All environments use the same Velocity server via Tailscale
    const waFeedbackUrl = process.env.WA_FEEDBACK_URL || 'http://100.96.203.105:8092';

    const requestBody: Record<string, string | string[]> = {
      recipient: recipient,
      message: message,
    };

    // Add mentions if provided (for group messages)
    if (replyParams?.mentionJIDs && replyParams.mentionJIDs.length > 0) {
      requestBody.mentionJIDs = replyParams.mentionJIDs;
    }

    log.info('Sending message via wa-feedback', {
      recipient,
      isGroup: recipient.includes('@g.us'),
      hasMentions: !!(replyParams?.mentionJIDs?.length),
      waFeedbackUrl,
    });

    const response = await fetch(`${waFeedbackUrl}/send-feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      log.error('wa-feedback API error', {
        status: response.status,
        error: errorData,
      });
      return { success: false };
    }

    const data = await response.json();
    log.info('Message sent via wa-feedback (063 841 2276)', {
      success: data.success,
      messageId: data.messageId,
    });

    // Log to wa_message_logs for WhatsApp Portal visibility
    const isGroup = recipient.includes('@g.us');
    await logWhatsAppMessage({
      direction: 'outbound',
      service: 'sender',
      messageType: 'feedback',
      groupJid: isGroup ? recipient : null,
      recipientJid: isGroup ? null : recipient,
      messageContent: message,
      status: data.success !== false ? 'sent' : 'failed',
      dropNumber: replyParams?.dropNumber || null,
      project: replyParams?.project || null,
      templateKey: 'feedback_pass', // Could be enhanced to detect actual template
    });

    return { success: data.success !== false, messageId: data.messageId };
  } catch (error) {
    log.error('Failed to send message via WhatsApp', { error });
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
 * Log WhatsApp message to wa_message_logs for portal visibility
 */
interface WaMessageLogParams {
  direction: 'inbound' | 'outbound';
  service: 'bridge' | 'sender';
  messageType: string;
  groupJid: string | null;
  recipientJid: string | null;
  messageContent: string;
  status: 'pending' | 'sent' | 'delivered' | 'failed' | 'read';
  dropNumber: string | null;
  project: string | null;
  templateKey: string | null;
}

async function logWhatsAppMessage(params: WaMessageLogParams): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO wa_message_logs (
        direction, service, message_type, group_jid, recipient_jid,
        message_content, status, drop_number, project, template_key, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        params.direction,
        params.service,
        params.messageType,
        params.groupJid,
        params.recipientJid,
        params.messageContent,
        params.status,
        params.dropNumber,
        params.project,
        params.templateKey,
      ]
    );
    log.info('Logged WhatsApp message', {
      direction: params.direction,
      messageType: params.messageType,
      status: params.status,
      dropNumber: params.dropNumber,
    });
  } catch (error) {
    // Don't fail the main operation if logging fails
    log.error('Failed to log WhatsApp message', { error, params });
  }
}

/**
 * Main handler
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  return handlePost(req, res);
}

export default withAuth(handler);
