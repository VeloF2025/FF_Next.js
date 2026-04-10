/**
 * QField QA Notification Service
 * Sends WhatsApp notifications for photo rejections, escalations, and assignments
 *
 * @module qfield-qa/services/qfieldNotificationService
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { notify } from '@/modules/notifications/services';

const sql = neon(process.env.DATABASE_URL!);

const WA_SENDER_URL = process.env.WA_FEEDBACK_URL || 'http://100.96.203.105:8092';

export type NotificationType = 'rejection' | 'escalation' | 'assignment' | 'retake_reminder';

interface NotificationContext {
  validationId: string;
  photoKey: string;
  projectId?: string;
  projectName?: string;
  notes?: string;
  sentBy: string;
  recipientPhone?: string;
  recipientName?: string;
  // Assignment specific
  dueDate?: string;
  priority?: string;
  photoCount?: number;
}

interface SendResult {
  success: boolean;
  notificationId?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * Send rejection notification
 */
export async function sendRejectionNotification(
  context: NotificationContext
): Promise<SendResult> {
  return sendQFieldNotification('rejection', context);
}

/**
 * Send escalation notification
 */
export async function sendEscalationNotification(
  context: NotificationContext
): Promise<SendResult> {
  return sendQFieldNotification('escalation', context);
}

/**
 * Send assignment notification
 */
export async function sendAssignmentNotification(
  context: NotificationContext
): Promise<SendResult> {
  return sendQFieldNotification('assignment', context);
}

/**
 * Core notification sender
 */
async function sendQFieldNotification(
  type: NotificationType,
  context: NotificationContext
): Promise<SendResult> {
  const logPrefix = `QFieldNotification:${type}`;

  try {
    // Get project WhatsApp config
    const projectConfig = await getProjectWhatsAppConfig(context.projectId);

    if (!projectConfig || !projectConfig.group_jid) {
      log.debug(logPrefix, { projectId: context.projectId }, 'No WhatsApp group configured for project');
      return {
        success: true,
        skipped: true,
        skipReason: 'no_whatsapp_group',
      };
    }

    // Get message template
    const templateKey = getTemplateKey(type);
    const template = await getMessageTemplate(templateKey);

    if (!template) {
      log.error(logPrefix, { templateKey }, 'Template not found');
      return {
        success: false,
        error: `Template ${templateKey} not found`,
      };
    }

    // Build message from template
    const message = buildMessage(template.template_content, {
      photo_name: context.photoKey.split('/').pop() || context.photoKey,
      project_name: context.projectName || projectConfig.project_name || 'Unknown Project',
      rejection_notes: context.notes || 'No notes provided',
      escalation_reason: context.notes || 'No reason provided',
      escalated_by: context.sentBy,
      photo_count: String(context.photoCount || 1),
      due_date: context.dueDate || 'Not set',
      priority: context.priority || 'Normal',
      review_link: `https://app.fibreflow.app/qfield/qa?tab=queue`,
    });

    // Create notification record
    const notificationResult = await sql`
      INSERT INTO qfield_qa_notifications (
        validation_id, notification_type, recipient_phone, recipient_name,
        group_jid, message_content, status, sent_by
      ) VALUES (
        ${context.validationId}::uuid,
        ${type},
        ${context.recipientPhone || null},
        ${context.recipientName || null},
        ${projectConfig.group_jid},
        ${message},
        'pending',
        ${context.sentBy}
      )
      RETURNING id
    `;

    const notificationId = notificationResult[0]?.id;

    // Send via WhatsApp
    const sendResult = await sendWhatsAppMessage(
      projectConfig.group_jid,
      message,
      context.recipientPhone
    );

    // Update notification status
    await sql`
      UPDATE qfield_qa_notifications
      SET
        status = ${sendResult.success ? 'sent' : 'failed'},
        error_message = ${sendResult.error || null},
        sent_at = ${sendResult.success ? new Date().toISOString() : null}
      WHERE id = ${notificationId}::uuid
    `;

    if (sendResult.success) {
      log.info(logPrefix, { notificationId, projectId: context.projectId }, 'Notification sent');
    } else {
      log.error(logPrefix, { notificationId, error: sendResult.error }, 'Failed to send notification');
    }

    // UNS: fire-and-forget in-app notification for rejection/escalation
    if (type === 'rejection' || type === 'escalation') {
      const eventType = type === 'rejection' ? 'activate.qa_rejected' : 'activate.qa_rejected';
      // Resolve user_id from staff phone if available
      const staffUserId = await resolveStaffUserId(context.recipientPhone);
      if (staffUserId) {
        notify({
          event_type: eventType,
          title: type === 'rejection'
            ? `QA Photo Rejected — ${context.projectName || 'Unknown Project'}`
            : `QA Escalation — ${context.projectName || 'Unknown Project'}`,
          body: context.notes || undefined,
          action_url: '/app/qfield/qa?tab=queue',
          source_module: 'qfield-qa',
          source_id: context.validationId,
          recipient_user_ids: [staffUserId],
        }).catch(() => {});
      }
    }

    return {
      success: sendResult.success,
      notificationId,
      error: sendResult.error,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(logPrefix, { error: errorMessage, context }, 'Notification failed');
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Get WhatsApp config for a project
 */
async function getProjectWhatsAppConfig(projectId?: string): Promise<{
  group_jid: string;
  project_name: string;
} | null> {
  if (!projectId) return null;

  try {
    const result = await sql`
      SELECT
        wg.group_jid,
        qp.name as project_name
      FROM qfield_projects qp
      JOIN wa_group_config wg ON qp.wa_group_id = wg.id
      WHERE qp.id = ${projectId}::uuid
        AND wg.enabled = true
    `;

    return result[0] || null;
  } catch {
    return null;
  }
}

/**
 * Get message template
 */
async function getMessageTemplate(templateKey: string): Promise<{
  template_content: string;
} | null> {
  try {
    const result = await sql`
      SELECT template_content
      FROM wa_message_templates
      WHERE template_key = ${templateKey}
        AND enabled = true
    `;

    return result[0] || null;
  } catch {
    return null;
  }
}

/**
 * Get template key for notification type
 */
function getTemplateKey(type: NotificationType): string {
  switch (type) {
    case 'rejection':
      return 'qfield_photo_rejected';
    case 'escalation':
      return 'qfield_photo_escalated';
    case 'assignment':
      return 'qfield_photos_assigned';
    default:
      return 'qfield_photo_rejected';
  }
}

/**
 * Build message from template with variable substitution
 */
function buildMessage(template: string, variables: Record<string, string>): string {
  let message = template;
  for (const [key, value] of Object.entries(variables)) {
    message = message.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return message;
}

/**
 * Send WhatsApp message via sender service
 */
async function sendWhatsAppMessage(
  groupJid: string,
  message: string,
  mentionPhone?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Format recipient JID for mentions
    let recipientJid = '0@s.whatsapp.net';
    if (mentionPhone) {
      let phone = mentionPhone.replace(/[^0-9]/g, '');
      if (phone.startsWith('0')) {
        phone = '27' + phone.substring(1);
      }
      recipientJid = `${phone}@s.whatsapp.net`;
    }

    const response = await fetch(`${WA_SENDER_URL}/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_jid: groupJid,
        recipient_jid: recipientJid,
        message: message,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}

/**
 * Resolve a user_id from a staff phone number for UNS notifications
 */
async function resolveStaffUserId(phone?: string): Promise<string | null> {
  if (!phone) return null;
  try {
    const rows = await sql`
      SELECT user_id FROM staff
      WHERE phone = ${phone} AND user_id IS NOT NULL
      LIMIT 1
    `;
    return rows[0]?.user_id || null;
  } catch {
    return null;
  }
}

/**
 * Send batch rejection notifications
 * Used when bulk rejecting photos
 */
export async function sendBulkRejectionNotifications(
  validationIds: string[],
  notes: string,
  sentBy: string
): Promise<{ sent: number; skipped: number; failed: number }> {
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // Get all validations with project info
  const validations = await sql`
    SELECT
      v.id,
      v.photo_key,
      v.project_id,
      qp.name as project_name
    FROM qfield_photo_validations v
    LEFT JOIN qfield_projects qp ON v.project_id = qp.id
    WHERE v.id = ANY(${validationIds}::uuid[])
  `;

  // Group by project to send one notification per project
  const byProject = new Map<string, typeof validations>();
  for (const v of validations) {
    const key = v.project_id || 'no_project';
    if (!byProject.has(key)) {
      byProject.set(key, []);
    }
    byProject.get(key)!.push(v);
  }

  // Send one notification per project
  for (const [projectId, photos] of byProject) {
    if (projectId === 'no_project') {
      skipped += photos.length;
      continue;
    }

    const result = await sendQFieldNotification('rejection', {
      validationId: photos[0]!.id,
      photoKey: photos.length === 1
        ? photos[0]!.photo_key
        : `${photos.length} photos`,
      projectId,
      projectName: photos[0]!.project_name,
      notes: photos.length === 1
        ? notes
        : `${photos.length} photos rejected: ${notes}`,
      sentBy,
      photoCount: photos.length,
    });

    if (result.skipped) {
      skipped += photos.length;
    } else if (result.success) {
      sent += photos.length;
    } else {
      failed += photos.length;
    }
  }

  return { sent, skipped, failed };
}
