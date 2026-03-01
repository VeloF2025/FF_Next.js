/**
 * POST /api/communications/email-send
 * Compose and send an email via Resend, record in email_outbox
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);
const FROM_ADDRESS = 'FibreFlow <notifications@fibreflow.app>';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const authReq = req as AuthenticatedNextApiRequest;
  const { to, toName, subject, bodyHtml, bodyText } = req.body;

  if (!to || !subject || !bodyHtml) {
    return apiResponse.badRequest(res, 'to, subject, and bodyHtml are required');
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return apiResponse.badRequest(res, 'Invalid email address');
  }

  let outboxId: string | null = null;

  try {
    // Insert into outbox as 'sending'
    const insertResult = await sql`
      INSERT INTO email_outbox (
        sender_id, recipient_email, recipient_name, subject,
        body_html, body_text, source_module, status
      ) VALUES (
        ${authReq.user.id}::uuid, ${to}, ${toName || null}, ${subject},
        ${bodyHtml}, ${bodyText || null}, 'manual', 'sending'
      )
      RETURNING id
    `;
    outboxId = insertResult[0].id;

    // Send via Resend
    const { resend } = await import('@/lib/email/resendClient');
    const sendResult = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html: bodyHtml,
      ...(bodyText ? { text: bodyText } : {}),
    });

    const resendId = sendResult.data?.id || null;

    // Update outbox with success
    await sql`
      UPDATE email_outbox
      SET status = 'sent', resend_id = ${resendId}, sent_at = NOW()
      WHERE id = ${outboxId}::uuid
    `;

    log.info('Email sent via compose', {
      to, subject, outboxId, resendId,
    }, 'EmailCompose');

    return apiResponse.success(res, { id: outboxId, status: 'sent', resendId });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('Email compose send failed', { to, subject, error: errorMsg }, 'EmailCompose');

    // Update outbox with failure if we have an ID
    if (outboxId) {
      await sql`
        UPDATE email_outbox
        SET status = 'failed', error_message = ${errorMsg}
        WHERE id = ${outboxId}::uuid
      `.catch(() => {});
    }

    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
