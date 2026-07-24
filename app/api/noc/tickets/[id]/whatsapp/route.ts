import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getMessagesForDR } from '@/modules/noc/services/waMaintenanceProcessor';

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
    from: r.recipient_jid,
    text: r.message_content,
    at: toIso(r.created_at),
  }));
  return [...group, ...oneToOne].sort((a, b) => a.at.localeCompare(b.at));
}

export async function GET(
  req: NextRequest,
  _context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const sql = neon(process.env.DATABASE_URL!);
  const dr = new URL(req.url).searchParams.get('dr');
  // 1:1 messages logged for this ticket's contact live in wa_message_logs
  // (service in cloud|waha). Phase 1 keys them by DR-derived recipient; refine
  // the WHERE once ticket→customer-phone mapping is wired (see plan Open Items).
  const logs = (await sql`
    SELECT id, direction, service, recipient_jid, message_content, created_at
    FROM wa_message_logs
    WHERE service IN ('cloud','waha')
      AND recipient_jid IS NOT NULL
      AND ${dr ?? ''} <> ''
    ORDER BY created_at ASC
    LIMIT 200
  `) as WaLogRow[];
  const items = await buildConversation(dr, logs);
  return NextResponse.json({ success: true, data: { items } });
}
