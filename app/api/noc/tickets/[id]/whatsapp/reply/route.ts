import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { requireAuth } from '@/lib/auth/app-router';
import { createLogger } from '@/lib/logger';
import { sendWhatsAppText } from '@/modules/communications/whatsapp/send/waSendClient';
import { evaluateOutboundPreconditions } from '@/modules/communications/whatsapp/outbound/outboundPreconditions';

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
  // `message` is deliberately absent from this type. Every send here is
  // business-initiated, so Meta requires approved template copy — the body is built
  // server-side from the template plus ticket-derived variables. A caller-supplied
  // message field is ignored rather than rejected, because the failure it used to cause
  // was silent: a valid templateKey paired with arbitrary text sent that text verbatim,
  // so the "approved template" check proved a key had been named and nothing more.
  const body = (await req.json().catch(() => null)) as
    | { toPhone?: string; channel?: string; templateKey?: string }
    | null;
  if (!body?.toPhone || !body?.templateKey) {
    return NextResponse.json(
      { success: false, error: 'toPhone and templateKey are required' },
      { status: 400 },
    );
  }
  // Only accept the two known channels; anything else falls back to the
  // configured provider rather than silently routing to WAHA.
  const channel = body.channel === 'cloud' || body.channel === 'waha' ? body.channel : undefined;

  // Every send from here is business-initiated, so it must clear consent,
  // contact, FNO attribution and an approved template first (#2276). This runs
  // before the send client is touched: a blocked ticket must not reach the
  // provider at all, on either channel.
  const preconditions = await evaluateOutboundPreconditions({
    ticketId,
    templateKey: body.templateKey,
    requestedPhone: body.toPhone,
  });
  if (!preconditions.allowed) {
    logger.warn('outbound reply refused by preconditions', {
      ticketId,
      reasons: preconditions.reasons,
      missingVariables: preconditions.missingVariables,
      userId: user.id,
    });
    // 422, not 403: the caller is authorised (403 on this route already means
    // "not manager+", and reusing it would make the two indistinguishable). The
    // request is well-formed but the ticket cannot lawfully be messaged. It is
    // also not 502 — that means the provider was asked and failed, whereas here
    // nothing was sent and no attempt was made.
    return NextResponse.json(
      {
        success: false,
        error: 'Outbound send blocked by preconditions',
        reasons: preconditions.reasons,
        missingVariables: preconditions.missingVariables,
      },
      { status: 422 },
    );
  }

  // Both values come from the guard, which derived them from the ticket: the recipient
  // is the ticket's subscriber, and the text is the approved template rendered with
  // ticket data. Nothing from the request body is transmitted.
  const recipientMsisdn = preconditions.msisdn;
  const outboundMessage = preconditions.message;
  const result = await sendWhatsAppText({ toPhone: recipientMsisdn, message: outboundMessage, channel });
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
    // recipient_jid is already canonical: the guard resolved it from the ticket
    // and only ever returns a normalized MSISDN. Cloud inbound logs bare digits
    // too, so this reads as the same participant as that number's inbound
    // messages in the feed.
    //
    // template_key records which approved template cleared the send, so the
    // audit trail shows what was authorised and not merely that something went
    // out. provider_message_id (the wamid, null for WAHA void sends) +
    // ON CONFLICT keep a re-logged send idempotent against the migration-459
    // partial unique index.
    await sql`
      INSERT INTO wa_message_logs (direction, service, message_type, group_jid, recipient_jid, message_content, status, drop_number, provider_message_id, template_key, created_at)
      VALUES ('outbound', ${result.channel}, 'text', NULL, ${recipientMsisdn}, ${outboundMessage}, 'sent', ${drNumber}, ${result.providerMessageId ?? null}, ${preconditions.templateKey}, NOW())
      ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING
    `;
  } catch (e) {
    logger.error('outbound reply sent but log failed', { ticketId, error: e instanceof Error ? e.message : String(e) });
  }

  return NextResponse.json({ success: true, providerMessageId: result.providerMessageId, channel: result.channel });
}
