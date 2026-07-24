import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { sendWhatsAppText } from '@/modules/communications/whatsapp/send/waSendClient';

// Auth note: this mirrors the sibling app-router NOC route
// (app/api/noc/tickets/[id]/notes/route.ts), which applies no in-handler
// withAuth guard — /api/* is gated by middleware.ts. Since this endpoint sends
// an outbound WhatsApp message, adding an explicit session guard is a
// recommended hardening step for Hein to confirm alongside the live rollout.
export async function POST(
  req: NextRequest,
  _context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const body = await req.json().catch(() => null) as { toPhone?: string; message?: string; channel?: 'cloud' | 'waha' } | null;
  if (!body?.toPhone || !body?.message) {
    return NextResponse.json({ success: false, error: 'toPhone and message are required' }, { status: 400 });
  }

  const result = await sendWhatsAppText({ toPhone: body.toPhone, message: body.message, channel: body.channel });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error, outcome: result.outcome }, { status: 502 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  await sql`
    INSERT INTO wa_message_logs (direction, service, message_type, group_jid, recipient_jid, message_content, status, created_at)
    VALUES ('outbound', ${result.channel}, 'text', NULL, ${body.toPhone}, ${body.message}, 'sent', NOW())
  `;

  return NextResponse.json({ success: true, providerMessageId: result.providerMessageId, channel: result.channel });
}
