import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { requireAuth } from '@/lib/auth/app-router';
import { createLogger } from '@/lib/logger';
import { sendWhatsAppText } from '@/modules/communications/whatsapp/send/waSendClient';

const logger = createLogger('api:noc:ticket-whatsapp-reply');

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const [, unauth] = await requireAuth(req);
  if (unauth) return unauth;

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
    await sql`
      INSERT INTO wa_message_logs (direction, service, message_type, group_jid, recipient_jid, message_content, status, drop_number, created_at)
      VALUES ('outbound', ${result.channel}, 'text', NULL, ${body.toPhone}, ${body.message}, 'sent', ${drNumber}, NOW())
    `;
  } catch (e) {
    logger.error('outbound reply sent but log failed', { ticketId, error: e instanceof Error ? e.message : String(e) });
  }

  return NextResponse.json({ success: true, providerMessageId: result.providerMessageId, channel: result.channel });
}
