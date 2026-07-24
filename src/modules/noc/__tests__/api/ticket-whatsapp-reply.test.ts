import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/communications/whatsapp/send/waSendClient', () => ({ sendWhatsAppText: vi.fn() }));
const sqlMock = vi.fn().mockResolvedValue([]);
vi.mock('@neondatabase/serverless', () => ({ neon: () => sqlMock }));

import { sendWhatsAppText } from '@/modules/communications/whatsapp/send/waSendClient';
import { POST } from '@/app/api/noc/tickets/[id]/whatsapp/reply/route';

beforeEach(() => vi.clearAllMocks());

describe('POST ticket whatsapp reply', () => {
  it('sends via the client and logs the outbound message', async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: true, channel: 'cloud', providerMessageId: 'wamid.9' });
    const req = new Request('https://x/api/noc/tickets/t1/whatsapp/reply', {
      method: 'POST', body: JSON.stringify({ toPhone: '27821234567', message: 'hi', channel: 'cloud' }),
    });
    const res = await POST(req as never, { params: { id: 't1' } } as never);
    const json = await res.json();
    expect(sendWhatsAppText).toHaveBeenCalledWith(expect.objectContaining({ toPhone: '27821234567', message: 'hi', channel: 'cloud' }));
    expect(sqlMock).toHaveBeenCalledOnce(); // wa_message_logs insert
    expect(json).toMatchObject({ success: true, providerMessageId: 'wamid.9' });
  });

  it('returns 502 when the send fails', async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: false, channel: 'waha', error: 'down', outcome: 'AMBIGUOUS' });
    const req = new Request('https://x/api/noc/tickets/t1/whatsapp/reply', {
      method: 'POST', body: JSON.stringify({ toPhone: '27821234567', message: 'hi' }),
    });
    const res = await POST(req as never, { params: { id: 't1' } } as never);
    expect(res.status).toBe(502);
  });
});
