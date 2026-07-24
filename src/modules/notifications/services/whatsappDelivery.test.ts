import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));
vi.mock('@/lib/db-neon', () => ({ neon: vi.fn(() => mockSql) }));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ log: loggerMock }));

vi.mock('@/modules/communications/whatsapp/send/waSendClient', () => ({ sendWhatsAppText: vi.fn() }));

import { sendWhatsAppText } from '@/modules/communications/whatsapp/send/waSendClient';
import { deliverWhatsApp } from './whatsappDelivery';
import type { NotifyPayload } from '../types';

function payload(overrides: Partial<NotifyPayload> = {}): NotifyPayload {
  return {
    event_type: 'test_event',
    title: 'Title',
    recipient_user_ids: ['u1'],
    ...overrides,
  } as NotifyPayload;
}

function logDeliveryCalls() {
  return mockSql.mock.calls.filter(([strings]) =>
    (strings as unknown as string[]).join('?').toUpperCase().includes('INSERT INTO NOTIFICATION_DELIVERY_LOG'));
}

beforeEach(() => {
  vi.clearAllMocks();
  // First sql call inside deliverWhatsApp's DM branch is the staff phone lookup.
  mockSql.mockResolvedValue([{ phone: '27821234567' }]);
  // Safety net only — the DM path is expected to go through the mocked
  // sendWhatsAppText and never touch fetch directly; this just prevents a real
  // network call if a call site still falls through to the raw WAHA sender.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => vi.unstubAllGlobals());

describe('deliverWhatsApp — individual DM branch', () => {
  it('sends via the provider-aware client and logs "sent" on success', async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: true, channel: 'waha' });
    await deliverWhatsApp('u1', payload(), 'n1');

    expect(sendWhatsAppText).toHaveBeenCalledWith({ toPhone: '27821234567', message: 'Title' });
    const calls = logDeliveryCalls();
    expect(calls).toHaveLength(1);
    const [, ...values] = calls[0] as [string[], ...unknown[]];
    expect(values).toContain('sent');
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('treats an {ok:false} result as a failure — never logs "sent" for a send that did not go out', async () => {
    vi.mocked(sendWhatsAppText).mockResolvedValue({ ok: false, channel: 'waha', error: 'WAHA down', outcome: 'AMBIGUOUS' });
    await deliverWhatsApp('u1', payload(), 'n1');

    const calls = logDeliveryCalls();
    expect(calls).toHaveLength(1);
    const [, ...values] = calls[0] as [string[], ...unknown[]];
    expect(values).not.toContain('sent');
    expect(values).toContain('failed');
    expect(values).toContain('WAHA down');
    expect(loggerMock.error).toHaveBeenCalledWith(
      'WA delivery failed',
      expect.objectContaining({ userId: 'u1', error: 'WAHA down' }),
      'WADelivery',
    );
  });

  it('still logs "failed" via the outer catch if the client unexpectedly throws', async () => {
    vi.mocked(sendWhatsAppText).mockRejectedValue(new Error('unexpected throw'));
    await deliverWhatsApp('u1', payload(), 'n1');

    const calls = logDeliveryCalls();
    expect(calls).toHaveLength(1);
    const [, ...values] = calls[0] as [string[], ...unknown[]];
    expect(values).toContain('failed');
    expect(values).toContain('unexpected throw');
  });
});

describe('deliverWhatsApp — group branch (unaffected by the DM reroute)', () => {
  it('still sends group messages through the bridge, not the provider-aware client', async () => {
    await deliverWhatsApp('u1', payload({ wa_group_jid: '123@g.us' }), 'n1');
    expect(sendWhatsAppText).not.toHaveBeenCalled();
    const calls = logDeliveryCalls();
    const [, ...values] = calls[0] as [string[], ...unknown[]];
    expect(values).toContain('sent');
    expect(values).toContain('123@g.us');
  });
});
