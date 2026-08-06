import { describe, it, expect, vi, afterEach } from 'vitest';
import { alertRecipientCount, alertRecipientIds, decideAlert, raiseTrackingAlert } from '../alerts';

const noon = new Date('2026-08-05T12:00:00+02:00');
const twoAm = new Date('2026-08-05T02:00:00+02:00');

describe('decideAlert', () => {
  it('alerts immediately on an auth failure with WhatsApp (working hours)', () => {
    const d = decideAlert({ kind: 'auth', consecutiveFailures: 1, nowSast: noon });
    // fleet.tracking_pull_failed is registered with whatsapp: true — see
    // src/modules/notifications/constants/index.ts
    expect(d?.event).toBe('fleet.tracking_pull_failed');
  });

  it('stays silent on the first two transient failures', () => {
    expect(decideAlert({ kind: 'transient', consecutiveFailures: 1, nowSast: noon })).toBeNull();
    expect(decideAlert({ kind: 'transient', consecutiveFailures: 2, nowSast: noon })).toBeNull();
  });

  it('alerts on the third consecutive transient failure, without WhatsApp', () => {
    const d = decideAlert({ kind: 'transient', consecutiveFailures: 3, nowSast: noon });
    // fleet.tracking_pull_degraded is registered with whatsapp: false
    expect(d?.event).toBe('fleet.tracking_pull_degraded');
  });

  it('raises a data gap immediately and never on WhatsApp', () => {
    const d = decideAlert({ kind: 'gap', consecutiveFailures: 0, nowSast: noon });
    // fleet.tracking_data_gap is registered with whatsapp: false
    expect(d?.event).toBe('fleet.tracking_data_gap');
  });

  describe('a sustained gap must not alert twelve times a day', () => {
    const gap = (n: number) =>
      decideAlert({ kind: 'gap', consecutiveFailures: n, nowSast: noon });

    it('alerts on the first gap tick', () => {
      expect(gap(1)?.event).toBe('fleet.tracking_data_gap');
    });

    it('stays silent on the second through eleventh consecutive gap ticks', () => {
      for (let n = 2; n <= 11; n++) {
        expect(gap(n), `gap tick ${n} should be suppressed`).toBeNull();
      }
    });

    it('re-alerts on the twelfth tick — roughly daily at a 2-hourly cadence', () => {
      expect(gap(12)?.event).toBe('fleet.tracking_data_gap');
    });

    it('keeps the reminder to once per twelve ticks while the outage persists', () => {
      for (let n = 13; n <= 23; n++) {
        expect(gap(n), `gap tick ${n} should be suppressed`).toBeNull();
      }
      expect(gap(24)?.event).toBe('fleet.tracking_data_gap');
    });
  });

  it('downgrades an overnight auth failure to the no-WhatsApp event', () => {
    const d = decideAlert({ kind: 'auth', consecutiveFailures: 1, nowSast: twoAm });
    // No scheduler here: the next daytime tick (job polls every 2h) will see
    // the same still-broken auth and emit fleet.tracking_pull_failed then.
    expect(d?.event).toBe('fleet.tracking_pull_degraded');
  });

  it('does not downgrade an auth failure during working hours', () => {
    const d = decideAlert({ kind: 'auth', consecutiveFailures: 1, nowSast: noon });
    expect(d?.event).toBe('fleet.tracking_pull_failed');
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

/**
 * The WhatsApp window's edges.
 *
 * Only noon and 02:00 were covered, so flipping either comparison — `>=` to
 * `>`, `<` to `<=` — or off-by-one'ing either constant would still pass every
 * test while silently shifting on-call paging by an hour.
 */
describe('decideAlert — quiet-hours boundaries', () => {
  const at = (hhmm: string) => new Date(`2026-08-05T${hhmm}+02:00`);
  const eventAt = (hhmm: string) =>
    decideAlert({ kind: 'auth', consecutiveFailures: 1, nowSast: at(hhmm) })?.event;

  it('06:59 is still quiet', () => {
    expect(eventAt('06:59:59')).toBe('fleet.tracking_pull_degraded');
  });

  it('07:00 is the first WhatsApp minute', () => {
    expect(eventAt('07:00:00')).toBe('fleet.tracking_pull_failed');
  });

  it('19:59 is the last WhatsApp minute', () => {
    expect(eventAt('19:59:59')).toBe('fleet.tracking_pull_failed');
  });

  it('20:00 is quiet again', () => {
    expect(eventAt('20:00:00')).toBe('fleet.tracking_pull_degraded');
  });
});

describe('alertRecipientIds', () => {
  const ORIGINAL = process.env.FLEET_ALERT_USER_IDS;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.FLEET_ALERT_USER_IDS;
    else process.env.FLEET_ALERT_USER_IDS = ORIGINAL;
  });

  it('reads a comma-separated list, trimming whitespace', () => {
    process.env.FLEET_ALERT_USER_IDS =
      ' 80970f18-eaf6-484b-9eca-eb6bb072df9d , 11111111-2222-3333-4444-555555555555 ';
    expect(alertRecipientIds()).toEqual([
      '80970f18-eaf6-484b-9eca-eb6bb072df9d',
      '11111111-2222-3333-4444-555555555555',
    ]);
    expect(alertRecipientCount()).toBe(2);
  });

  // notificationBus casts each id with `${userId}::uuid` inside a parameterized
  // query, so a typo surfaces once per recipient per alert as a caught cast
  // error — which reads as "the mail server is flaky", not "this list is wrong".
  it('drops entries that are not UUIDs and keeps the good ones', () => {
    process.env.FLEET_ALERT_USER_IDS = 'not-a-uuid,80970f18-eaf6-484b-9eca-eb6bb072df9d';
    expect(alertRecipientIds()).toEqual(['80970f18-eaf6-484b-9eca-eb6bb072df9d']);
  });

  it('reports zero when unset, which is what makes an unconfigured alert path visible', () => {
    delete process.env.FLEET_ALERT_USER_IDS;
    expect(alertRecipientCount()).toBe(0);
  });
});
