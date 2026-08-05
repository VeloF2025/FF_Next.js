import { describe, it, expect, vi } from 'vitest';
import { decideAlert, raiseTrackingAlert } from '../alerts';

const noon = new Date('2026-08-05T12:00:00+02:00');
const twoAm = new Date('2026-08-05T02:00:00+02:00');

describe('decideAlert', () => {
  it('alerts immediately on an auth failure', () => {
    const d = decideAlert({ kind: 'auth', consecutiveFailures: 1, nowSast: noon });
    expect(d?.event).toBe('fleet.tracking_pull_failed');
    expect(d?.channels.email).toBe(true);
    expect(d?.channels.whatsapp).toBe(true);
  });

  it('stays silent on the first two transient failures', () => {
    expect(decideAlert({ kind: 'transient', consecutiveFailures: 1, nowSast: noon })).toBeNull();
    expect(decideAlert({ kind: 'transient', consecutiveFailures: 2, nowSast: noon })).toBeNull();
  });

  it('alerts on the third consecutive transient failure, without WhatsApp', () => {
    const d = decideAlert({ kind: 'transient', consecutiveFailures: 3, nowSast: noon });
    expect(d?.channels.email).toBe(true);
    expect(d?.channels.whatsapp).toBe(false);
  });

  it('raises a data gap immediately and never on WhatsApp', () => {
    const d = decideAlert({ kind: 'gap', consecutiveFailures: 0, nowSast: noon });
    expect(d?.event).toBe('fleet.tracking_data_gap');
    expect(d?.channels.whatsapp).toBe(false);
  });

  it('defers an overnight WhatsApp to 07:00 but sends email immediately', () => {
    const d = decideAlert({ kind: 'auth', consecutiveFailures: 1, nowSast: twoAm });
    expect(d?.channels.email).toBe(true);
    expect(d?.deferWhatsappUntil?.toISOString()).toBe(
      new Date('2026-08-05T07:00:00+02:00').toISOString()
    );
  });

  it('does not defer WhatsApp during working hours', () => {
    expect(decideAlert({ kind: 'auth', consecutiveFailures: 1, nowSast: noon })?.deferWhatsappUntil)
      .toBeNull();
  });
});

describe('raiseTrackingAlert', () => {
  const base = {
    provider: 'netstar' as const,
    accountRef: 'europcar',
    detail: 'HTTP 401',
    nowSast: new Date('2026-08-05T12:00:00+02:00'),
  };

  it('does not notify when the policy says stay silent', async () => {
    const notify = vi.fn();
    await raiseTrackingAlert(
      { ...base, kind: 'transient', consecutiveFailures: 1 },
      { notify, recipients: async () => ['u1'] }
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies the configured recipients on an auth failure', async () => {
    const notify = vi.fn();
    await raiseTrackingAlert(
      { ...base, kind: 'auth', consecutiveFailures: 1 },
      { notify, recipients: async () => ['u1', 'u2'] }
    );
    expect(notify).toHaveBeenCalledTimes(1);
    const payload = notify.mock.calls[0][0];
    expect(payload.event_type).toBe('fleet.tracking_pull_failed');
    expect(payload.recipient_user_ids).toEqual(['u1', 'u2']);
    expect(payload.source_module).toBe('fleet');
    expect(payload.title).toContain('netstar');
  });

  it('does not throw when no recipients are configured', async () => {
    const notify = vi.fn();
    await expect(raiseTrackingAlert(
      { ...base, kind: 'auth', consecutiveFailures: 1 },
      { notify, recipients: async () => [] }
    )).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it('never lets a notification failure break the poll', async () => {
    const notify = vi.fn(async () => { throw new Error('smtp down'); });
    await expect(raiseTrackingAlert(
      { ...base, kind: 'auth', consecutiveFailures: 1 },
      { notify, recipients: async () => ['u1'] }
    )).resolves.toBeUndefined();
  });
});
