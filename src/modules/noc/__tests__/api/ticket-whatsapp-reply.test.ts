import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/modules/communications/whatsapp/send/waSendClient', () => ({ sendWhatsAppText: vi.fn() }));
vi.mock('@/lib/auth/app-router', () => ({ requireAuth: vi.fn() }));
const sqlMock = vi.fn().mockResolvedValue([]);
vi.mock('@neondatabase/serverless', () => ({ neon: () => sqlMock }));

import { sendWhatsAppText } from '@/modules/communications/whatsapp/send/waSendClient';
import { requireAuth } from '@/lib/auth/app-router';
import { POST } from '@/app/api/noc/tickets/[id]/whatsapp/reply/route';

function replyReq(body: unknown) {
  return new Request('https://x/api/noc/tickets/t1/whatsapp/reply', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  sqlMock.mockResolvedValue([{ dr_number: 'DR123' }]);
  // authed by default
  vi.mocked(requireAuth).mockResolvedValue([{ id: 'u1', role: 'admin' }, null] as never);
});

describe('POST ticket whatsapp reply', () => {
  it('sends via the client and logs the outbound message tagged with the ticket DR', async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: true, channel: 'cloud', providerMessageId: 'wamid.9' });
    const res = await POST(replyReq({ toPhone: '27821234567', message: 'hi', channel: 'cloud' }) as never, { params: Promise.resolve({ id: 't1' }) } as never);
    const json = await res.json();
    expect(sendWhatsAppText).toHaveBeenCalledWith(expect.objectContaining({ toPhone: '27821234567', message: 'hi', channel: 'cloud' }));
    // ticket-DR lookup + the wa_message_logs insert
    expect(sqlMock).toHaveBeenCalledTimes(2);
    // the insert carries the DR derived from the ticket → drop_number populated
    expect(sqlMock.mock.calls[1]).toContain('DR123');
    expect(json).toMatchObject({ success: true, providerMessageId: 'wamid.9' });
  });

  it('returns 401 when unauthenticated and never sends', async () => {
    vi.mocked(requireAuth).mockResolvedValue([null, NextResponse.json({ success: false }, { status: 401 })] as never);
    const res = await POST(replyReq({ toPhone: '27821234567', message: 'hi' }) as never, { params: Promise.resolve({ id: 't1' }) } as never);
    expect(res.status).toBe(401);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(replyReq({ toPhone: '27821234567' }) as never, { params: Promise.resolve({ id: 't1' }) } as never);
    expect(res.status).toBe(400);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it('ignores an unknown channel (falls back to the configured provider)', async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: true, channel: 'waha' });
    await POST(replyReq({ toPhone: '27821234567', message: 'hi', channel: 'bogus' }) as never, { params: Promise.resolve({ id: 't1' }) } as never);
    expect(vi.mocked(sendWhatsAppText).mock.calls[0][0].channel).toBeUndefined();
  });

  it('returns 502 when the send fails', async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: false, channel: 'waha', error: 'down', outcome: 'AMBIGUOUS' });
    const res = await POST(replyReq({ toPhone: '27821234567', message: 'hi' }) as never, { params: Promise.resolve({ id: 't1' }) } as never);
    expect(res.status).toBe(502);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('logs the provider_message_id via ON CONFLICT DO NOTHING so a re-logged send stays one row', async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: true, channel: 'cloud', providerMessageId: 'wamid.9' });
    await POST(replyReq({ toPhone: '27821234567', message: 'hi', channel: 'cloud' }) as never, { params: Promise.resolve({ id: 't1' }) } as never);
    const [strings, ...values] = sqlMock.mock.calls[1] as [string[], ...unknown[]];
    const text = strings.join('?').toUpperCase();
    expect(text).toContain('PROVIDER_MESSAGE_ID');
    expect(text).toContain('ON CONFLICT');
    expect(text).toContain('DO NOTHING');
    expect(values).toContain('wamid.9');
  });
});
