import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { requireAuth } from '@/lib/auth/app-router';
import { createLogger } from '@/lib/logger';
import { sendWhatsAppText } from '@/modules/communications/whatsapp/send/waSendClient';
import { normalizeMsisdn } from '@/modules/communications/whatsapp/utils/phone';

const logger = createLogger('api:noc:ticket-whatsapp-reply');

// Sending a WhatsApp reply to a customer is manager+ only, matching the sibling
// regenerate-ai-summary route (middleware does NOT gate /api/*).
const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager']);

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const [user, unauth] = await requireAuth(req);
  if (unauth) return unauth;

  if (!ALLOWED_ROLES.has(user.role)) {
    return NextResponse.json({ success: false, error: 'manager+ role required' }, { status: 403 });
  }

  const { id: ticketId } = await context.params;
  const body = (await req.json().catch(() => null)) as
    | { toPhone?: string; message?: string; channel?: string }
    | null;
  if (!body?.toPhone || !body?.message) {
    return NextResponse.json({ success: false, error: 'toPhone and message are required' }, { status: 400 });
  }
  // Only accept the two known channels; anything else falls back to the
  // configured provider rather than silently routing to WAHA.
  const channel = body.channel === 'cloud' || body.channel === 'waha' ? body.channel : undefined;

  const result = await sendWhatsAppText({ toPhone: body.toPhone, message: body.message, channel });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error, outcome: result.outcome }, { status: 502 });
  }

  // The message has now been sent. Best-effort log to wa_message_logs, tagged
  // with this ticket's DR (derived server-side) so it re-appears in the
  // ticket's own conversation feed. A logging failure must not report the
  // already-sent message as failed.
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const ticketRows = (await sql`
      SELECT dr_number FROM maintenance_tickets WHERE id = ${ticketId} LIMIT 1
    `) as { dr_number: string | null }[];
    const drNumber = ticketRows[0]?.dr_number ?? null;
    // Store the canonical MSISDN, not whatever shape the caller typed — Cloud
    // inbound always logs bare digits, so a manager-typed "+27 82 ..." would
    // otherwise read as a different participant than the same number's inbound
    // messages in the feed. Falls back to the raw value so an unnormalizable
    // number is still logged rather than silently dropped.
    const recipientJid = normalizeMsisdn(body.toPhone) ?? body.toPhone;
    // provider_message_id (the wamid, null for WAHA void sends) + ON CONFLICT keep
    // a re-logged send idempotent against the migration-459 partial unique index.
    await sql`
      INSERT INTO wa_message_logs (direction, service, message_type, group_jid, recipient_jid, message_content, status, drop_number, provider_message_id, created_at)
      VALUES ('outbound', ${result.channel}, 'text', NULL, ${recipientJid}, ${body.message}, 'sent', ${drNumber}, ${result.providerMessageId ?? null}, NOW())
      ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING
    `;
  } catch (e) {
    logger.error('outbound reply sent but log failed', { ticketId, error: e instanceof Error ? e.message : String(e) });
  }

  return NextResponse.json({ success: true, providerMessageId: result.providerMessageId, channel: result.channel });
}
