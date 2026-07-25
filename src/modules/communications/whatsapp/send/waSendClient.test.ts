import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/waProviderConfig', () => ({
  getWaProvider: vi.fn(),
  getWaCloudCreds: vi.fn(),
}));
vi.mock('./waCloudClient', async (orig) => ({
  ...(await orig<typeof import('./waCloudClient')>()),
  sendViaCloud: vi.fn(),
}));
// The raw WAHA 1:1 sender is sendWahaDm(phone, message): Promise<void>. It used
// to be reached through @/modules/notifications/services/whatsappDelivery, which
// made the two senders import each other; it now lives in the dependency-free
// ./wahaDmClient (see importGraph.test.ts).
vi.mock('./wahaDmClient', () => ({
  sendWahaDm: vi.fn(),
}));

import { getWaProvider, getWaCloudCreds } from '../config/waProviderConfig';
import { sendViaCloud } from './waCloudClient';
import { sendWahaDm } from './wahaDmClient';
import { sendWhatsAppText } from './waSendClient';

beforeEach(() => vi.clearAllMocks());

describe('sendWhatsAppText channel routing', () => {
  it('uses Cloud when channel="cloud"', async () => {
    vi.mocked(getWaCloudCreds).mockResolvedValue({ phoneNumberId: 'PN1', accessToken: 'T', appSecret: 'S', verifyToken: 'V' });
    vi.mocked(sendViaCloud).mockResolvedValue({ ok: true, channel: 'cloud', providerMessageId: 'wamid.1' });
    const r = await sendWhatsAppText({ toPhone: '27821234567', message: 'hi', channel: 'cloud' });
    expect(sendViaCloud).toHaveBeenCalledOnce();
    expect(sendWahaDm).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, channel: 'cloud', providerMessageId: 'wamid.1' });
  });

  it('uses WAHA when channel="waha"', async () => {
    // Real sendWahaDm resolves void on success (throws on failure).
    vi.mocked(sendWahaDm).mockResolvedValue(undefined);
    const r = await sendWhatsAppText({ toPhone: '27821234567', message: 'hi', channel: 'waha' });
    expect(sendWahaDm).toHaveBeenCalledWith('27821234567', 'hi');
    expect(sendViaCloud).not.toHaveBeenCalled();
    expect(r.channel).toBe('waha');
    expect(r.ok).toBe(true);
  });

  it('reports ok:false when the WAHA DM throws', async () => {
    vi.mocked(sendWahaDm).mockRejectedValue(new Error('WAHA DM failed: HTTP 500 — down'));
    const r = await sendWhatsAppText({ toPhone: '27821234567', message: 'hi', channel: 'waha' });
    expect(r).toMatchObject({ ok: false, channel: 'waha', outcome: 'AMBIGUOUS' });
  });

  it('returns ok:false (never throws) when Cloud creds are not configured', async () => {
    vi.mocked(getWaCloudCreds).mockRejectedValue(new Error('WhatsApp Cloud credentials are not fully configured'));
    const r = await sendWhatsAppText({ toPhone: '27821234567', message: 'hi', channel: 'cloud' });
    expect(r).toMatchObject({ ok: false, channel: 'cloud', outcome: 'AMBIGUOUS' });
    expect(sendViaCloud).not.toHaveBeenCalled();
  });

  it('falls back to the configured provider when channel is omitted', async () => {
    vi.mocked(getWaProvider).mockResolvedValue('cloud');
    vi.mocked(getWaCloudCreds).mockResolvedValue({ phoneNumberId: 'PN1', accessToken: 'T', appSecret: 'S', verifyToken: 'V' });
    vi.mocked(sendViaCloud).mockResolvedValue({ ok: true, channel: 'cloud', providerMessageId: 'wamid.2' });
    await sendWhatsAppText({ toPhone: '27821234567', message: 'hi' });
    expect(getWaProvider).toHaveBeenCalledOnce();
    expect(sendViaCloud).toHaveBeenCalledOnce();
  });
});
