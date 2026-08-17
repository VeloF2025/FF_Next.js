/**
 * What notify() reports back, and why it matters.
 *
 * notify() catches per-recipient failures and resolves regardless — deliberately,
 * because a broken mail server must never take a caller's run down with it. That
 * made "the promise resolved" indistinguishable from "somebody was told": fleet
 * tracking alerts died at the in-app INSERT for nine days (2026-08-08 → 08-17)
 * while raiseTrackingAlert reported delivered: true and stamped the 24h cooldown
 * that suppressed the retries. These tests pin the counters that make the two
 * cases distinguishable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ sql: mockSql }));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ log: loggerMock }));

vi.mock('./emailDelivery', () => ({ deliverEmail: vi.fn(async () => undefined) }));
vi.mock('./whatsappDelivery', () => ({ deliverWhatsApp: vi.fn(async () => undefined) }));

import { deliverEmail } from './emailDelivery';
import { deliverWhatsApp } from './whatsappDelivery';
import { notify } from './notificationBus';

function queryText(strings: TemplateStringsArray): string {
  return Array.from(strings).join(' ');
}

/** Route the tagged-template calls: preference lookup first, then the in-app insert. */
function installSql(opts: { insert: (userId: string) => unknown[]; prefs?: unknown[] }) {
  mockSql.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = queryText(strings);
    if (/INSERT INTO user_notifications/i.test(text)) {
      return Promise.resolve(opts.insert(String(values[0])));
    }
    if (/FROM notification_preferences/i.test(text)) {
      // [] means "no user override" — notify() then uses the system defaults,
      // which for fleet.tracking_data_gap are in_app: true, email: true.
      return Promise.resolve(opts.prefs ?? []);
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
}

function payload(recipients: string[]) {
  return {
    event_type: 'fleet.tracking_data_gap',
    title: 'No tracking data from cartrack',
    body: 'cartrack/urent: 0 positions',
    source_module: 'fleet',
    recipient_user_ids: recipients,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('notify() delivery reporting', () => {
  it('reports the recipient as failed — not delivered — when the in-app insert throws', async () => {
    // The exact production failure: source_id carried "cartrack:urent" into a
    // uuid column, so every insert died here. notify() logged it and resolved,
    // and the caller read that resolution as success.
    installSql({
      insert: () => { throw new Error('invalid input syntax for type uuid: "cartrack:urent"'); },
    });

    const result = await notify(payload(['11111111-1111-4111-8111-111111111111']));

    expect(result).toEqual({ delivered: 0, suppressed: 0, failed: 1 });
    expect(loggerMock.error).toHaveBeenCalled();
    // Still no throw: callers depend on that, and this change must not alter it.
  });

  it('reports a delivered recipient once the in-app row is written', async () => {
    installSql({ insert: () => [{ id: 'n1' }] });

    const result = await notify(payload(['11111111-1111-4111-8111-111111111111']));

    expect(result).toEqual({ delivered: 1, suppressed: 0, failed: 0 });
  });

  it('counts each recipient separately — one bad row does not hide the good one', async () => {
    const bad = '22222222-2222-4222-8222-222222222222';
    installSql({
      insert: (userId) => {
        if (userId === bad) throw new Error('insert failed');
        return [{ id: 'n1' }];
      },
    });

    const result = await notify(payload(['11111111-1111-4111-8111-111111111111', bad]));

    expect(result).toEqual({ delivered: 1, suppressed: 0, failed: 1 });
  });

  it('reports nothing delivered when the payload has no recipients', async () => {
    installSql({ insert: () => [{ id: 'n1' }] });

    const result = await notify(payload([]));

    expect(result).toEqual({ delivered: 0, suppressed: 0, failed: 0 });
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('reports a recipient who muted every channel as neither delivered nor failed', async () => {
    // Nothing was written and nothing was dispatched, so claiming delivery here
    // would be the same overstatement that hid the original bug — and nothing
    // broke either, so it is not a failure. It is simply not a delivery.
    installSql({
      insert: () => { throw new Error('in-app is muted; this must never run'); },
      prefs: [{ channel_in_app: false, channel_email: false, channel_whatsapp: false }],
    });

    const result = await notify(payload(['11111111-1111-4111-8111-111111111111']));

    expect(result).toEqual({ delivered: 0, suppressed: 0, failed: 0 });
    expect(deliverEmail).not.toHaveBeenCalled();
    expect(deliverWhatsApp).not.toHaveBeenCalled();
  });

  it('reports delivered when in-app is muted but an async channel was dispatched', async () => {
    // Weaker evidence than an in-app row — deliverEmail is fire-and-forget, so
    // this says "handed to the channel", never "a human received it".
    installSql({
      insert: () => { throw new Error('in-app is muted; this must never run'); },
      prefs: [{ channel_in_app: false, channel_email: true, channel_whatsapp: false }],
    });

    const result = await notify(payload(['11111111-1111-4111-8111-111111111111']));

    expect(result).toEqual({ delivered: 1, suppressed: 0, failed: 0 });
    expect(deliverEmail).toHaveBeenCalledTimes(1);
  });
});
