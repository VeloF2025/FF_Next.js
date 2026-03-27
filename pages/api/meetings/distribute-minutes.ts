/**
 * POST /api/meetings/distribute-minutes
 * Send meeting minutes PDF to selected participants via Resend.
 *
 * Body: {
 *   meetingId: string,
 *   meetingTitle: string,
 *   meetingDate: string,
 *   recipients: { email: string; name: string }[],
 *   pdfBase64: string          // base64-encoded PDF content (no data-url prefix)
 *   fileName: string
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);
const FROM_ADDRESS = 'FibreFlow <notifications@fibreflow.app>';

function buildMinutesEmailHtml(meetingTitle: string, meetingDate: string, senderName: string): string {
  return `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <img src="https://app.fibreflow.app/help-assets/velocity-logo.jpg" alt="Velocity Fibre" style="height: 48px;" />
      </div>
      <div style="background: #f5f7fa; border: 1px solid #d2d7e1; border-radius: 8px; padding: 24px;">
        <h2 style="margin: 0 0 8px; color: #1e2846; font-size: 18px;">Meeting Minutes</h2>
        <p style="margin: 0 0 16px; color: #505050; font-size: 14px;">
          The minutes for <strong>${meetingTitle}</strong> held on <strong>${meetingDate}</strong>
          are attached to this email.
        </p>
        <p style="margin: 0; color: #787878; font-size: 13px;">
          Distributed by ${senderName} via FibreFlow.
        </p>
      </div>
      <p style="margin-top: 20px; color: #a0a0a0; font-size: 11px; text-align: center;">
        CONFIDENTIAL — For internal distribution only
      </p>
    </div>
  `;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const authReq = req as AuthenticatedNextApiRequest;
  const { meetingId, meetingTitle, meetingDate, recipients, pdfBase64, fileName } = req.body;

  if (!meetingId || !recipients?.length || !pdfBase64 || !fileName) {
    return apiResponse.badRequest(res, 'meetingId, recipients, pdfBase64, and fileName are required');
  }

  // Validate recipients
  const validRecipients = (recipients as { email: string; name: string }[]).filter(
    r => r.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)
  );

  if (validRecipients.length === 0) {
    return apiResponse.badRequest(res, 'No valid recipient email addresses provided');
  }

  const senderName = authReq.user.name || authReq.user.email || 'FibreFlow';
  const subject = `Meeting Minutes: ${meetingTitle || 'Untitled Meeting'}`;
  const bodyHtml = buildMinutesEmailHtml(
    meetingTitle || 'Untitled Meeting',
    meetingDate || 'Unknown date',
    senderName
  );

  const results: { email: string; status: string; error?: string }[] = [];

  const { resend } = await import('@/lib/email/resendClient');

  for (const recipient of validRecipients) {
    let outboxId: string | null = null;
    try {
      // Record in outbox
      const insertResult = await sql`
        INSERT INTO email_outbox (
          sender_id, recipient_email, recipient_name, subject,
          body_html, source_module, source_id, status, metadata
        ) VALUES (
          ${authReq.user.id}::uuid,
          ${recipient.email},
          ${recipient.name || null},
          ${subject},
          ${bodyHtml},
          'meeting-minutes',
          ${String(meetingId)},
          'sending',
          ${JSON.stringify({ meetingId, fileName })}
        )
        RETURNING id
      `;
      outboxId = insertResult[0]?.id ?? null;

      // Send via Resend with attachment
      const sendResult = await resend.emails.send({
        from: FROM_ADDRESS,
        to: recipient.email,
        subject,
        html: bodyHtml,
        attachments: [
          {
            filename: fileName,
            content: pdfBase64,
          },
        ],
      });

      const resendId = sendResult.data?.id || null;

      await sql`
        UPDATE email_outbox
        SET status = 'sent', resend_id = ${resendId}, sent_at = NOW()
        WHERE id = ${outboxId}::uuid
      `;

      results.push({ email: recipient.email, status: 'sent' });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('Failed to send meeting minutes', {
        to: recipient.email, meetingId, error: errorMsg,
      }, 'MeetingMinutes');

      if (outboxId) {
        await sql`
          UPDATE email_outbox
          SET status = 'failed', error_message = ${errorMsg}
          WHERE id = ${outboxId}::uuid
        `.catch(() => { /* best effort */ });
      }

      results.push({ email: recipient.email, status: 'failed', error: errorMsg });
    }
  }

  const sent = results.filter(r => r.status === 'sent').length;
  const failed = results.filter(r => r.status === 'failed').length;

  log.info('Meeting minutes distributed', {
    meetingId, sent, failed, total: validRecipients.length,
  }, 'MeetingMinutes');

  return apiResponse.success(res, { sent, failed, total: validRecipients.length, results });
}

export default withAuth(handler);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};
