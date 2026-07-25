import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { requireAuth } from '@/lib/auth/app-router';
import { getMessagesForDR } from '@/modules/noc/services/waMaintenanceProcessor';
import { normalizeMsisdn } from '@/modules/communications/whatsapp/utils/phone';

export type ConversationItem = {
  id: string;
  direction: 'inbound' | 'outbound';
  channel: 'group' | 'cloud' | 'waha';
  from: string | null;
  text: string;
  at: string;
};

type WaLogRow = {
  id: string; direction: string; service: string;
  recipient_jid: string | null; message_content: string; created_at: string | Date;
};

/** Normalize a timestamp (pg returns strings; getMessagesForDR returns Dates) to ISO. */
function toIso(v: string | number | Date): string {
  return new Date(v).toISOString();
}

/** Pure merge — DB-free for testability. */
export async function buildConversation(
  drNumber: string | null,
  logs: WaLogRow[],
): Promise<ConversationItem[]> {
  const group: ConversationItem[] = drNumber
    ? (await getMessagesForDR(drNumber)).map((m) => ({
        id: m.id,
        direction: 'inbound' as const,
        channel: 'group' as const,
        from: m.sender_name ?? null,
        text: m.message_text,
        at: toIso(m.message_timestamp),
      }))
    : [];
  const oneToOne: ConversationItem[] = logs.map((r) => ({
    id: r.id,
    direction: r.direction === 'outbound' ? 'outbound' : 'inbound',
    channel: r.service === 'cloud' ? 'cloud' : 'waha',
    // Outbound 1:1 rows store the counterparty in recipient_jid; the panel should
    // render those as "You", so leave `from` null for outbound.
    // Cloud and bridge write recipient_jid in different raw shapes (bare MSISDN vs
    // JID-suffixed); normalize so the same subscriber reads as one participant
    // regardless of channel. Falls back to the raw value so an unnormalizable jid
    // is still shown rather than silently dropped.
    from: r.direction === 'outbound' ? null : (r.recipient_jid ? (normalizeMsisdn(r.recipient_jid) ?? r.recipient_jid) : null),
    text: r.message_content,
    at: toIso(r.created_at),
  }));
  return [...group, ...oneToOne].sort((a, b) => a.at.localeCompare(b.at));
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const [, unauth] = await requireAuth(req);
  if (unauth) return unauth;

  const { id: ticketId } = await context.params;
  const sql = neon(process.env.DATABASE_URL!);

  // Scope the feed to THIS ticket's DR, derived server-side from the ticket —
  // never a client-supplied query param — so the 1:1 feed cannot leak other
  // tickets' / other customers' messages (blind-review H2/H3).
  const ticketRows = (await sql`
    SELECT dr_number FROM maintenance_tickets WHERE id = ${ticketId} LIMIT 1
  `) as { dr_number: string | null }[];
  const dr = ticketRows[0]?.dr_number ?? null;

  const logs = dr
    ? ((await sql`
        SELECT id, direction, service, recipient_jid, message_content, created_at
        FROM wa_message_logs
        WHERE service IN ('cloud','waha')
          AND drop_number = ${dr}
        ORDER BY created_at ASC
        LIMIT 200
      `) as WaLogRow[])
    : [];
  const items = await buildConversation(dr, logs);
  return NextResponse.json({ success: true, data: { items } });
}
