import { afterEach, describe, it, expect, vi } from 'vitest';
import { sendViaCloud } from './waCloudClient';

const creds = { phoneNumberId: 'PN1', accessToken: 'TOK', appSecret: 'SEC', verifyToken: 'VER' };

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('sendViaCloud', () => {
  it('POSTs a text message to Graph and returns the wamid', async () => {
    vi.stubEnv('WHATSAPP_GRAPH_VERSION', 'v23.0');
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.A' }] }) });
    vi.stubGlobal('fetch', fetchSpy);

    const r = await sendViaCloud({ toPhone: '0821234567', message: 'hi', creds });

    expect(r).toEqual({ ok: true, channel: 'cloud', providerMessageId: 'wamid.A' });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/PN1/messages');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer TOK' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      messaging_product: 'whatsapp', to: '27821234567', type: 'text', text: { body: 'hi' },
    });
  });

  it('classifies a 400 as DEFINITELY_REJECTED and a 503 as AMBIGUOUS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad' }));
    expect((await sendViaCloud({ toPhone: '27821234567', message: 'x', creds })).outcome).toBe('DEFINITELY_REJECTED');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'up' }));
    expect((await sendViaCloud({ toPhone: '27821234567', message: 'x', creds })).outcome).toBe('AMBIGUOUS');
  });

  it('holds a 200 without a wamid as AMBIGUOUS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) }));
    const r = await sendViaCloud({ toPhone: '27821234567', message: 'x', creds });
    expect(r).toMatchObject({ ok: false, outcome: 'AMBIGUOUS' });
  });
});
