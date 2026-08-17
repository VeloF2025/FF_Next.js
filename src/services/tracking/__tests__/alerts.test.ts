import { describe, it, expect, vi, afterEach } from 'vitest';
import { alertRecipientCount, alertRecipientIds, decideAlert, raiseTrackingAlert } from '../alerts';

const noon = new Date('2026-08-05T12:00:00+02:00');
const twoAm = new Date('2026-08-05T02:00:00+02:00');

describe('decideAlert', () => {
  it('alerts immediately on an auth failure with WhatsApp (working hours)', () => {
    const d = decideAlert({
      kind: 'auth', consecutiveFailures: 1, nowSast: noon, lastGapAlertAt: null,
    });
    // fleet.tracking_pull_failed is registered with whatsapp: true — see
    // src/modules/notifications/constants/index.ts
    expect(d?.event).toBe('fleet.tracking_pull_failed');
  });

  it('stays silent on the first two transient failures', () => {
    expect(decideAlert({
      kind: 'transient', consecutiveFailures: 1, nowSast: noon, lastGapAlertAt: null,
    })).toBeNull();
    expect(decideAlert({
      kind: 'transient', consecutiveFailures: 2, nowSast: noon, lastGapAlertAt: null,
    })).toBeNull();
  });

  it('alerts on the third consecutive transient failure, without WhatsApp', () => {
    const d = decideAlert({
      kind: 'transient', consecutiveFailures: 3, nowSast: noon, lastGapAlertAt: null,
    });
    // fleet.tracking_pull_degraded is registered with whatsapp: false
    expect(d?.event).toBe('fleet.tracking_pull_degraded');
  });

  it('raises a data gap immediately and never on WhatsApp', () => {
    const d = decideAlert({
      kind: 'gap', consecutiveFailures: 0, nowSast: noon, lastGapAlertAt: null,
    });
    // fleet.tracking_data_gap is registered with whatsapp: false
    expect(d?.event).toBe('fleet.tracking_data_gap');
  });

  it('downgrades an overnight auth failure to the no-WhatsApp event', () => {
    const d = decideAlert({
      kind: 'auth', consecutiveFailures: 1, nowSast: twoAm, lastGapAlertAt: null,
    });
    // No scheduler here: the next daytime tick (job polls every 2h) will see
    // the same still-broken auth and emit fleet.tracking_pull_failed then.
    expect(d?.event).toBe('fleet.tracking_pull_degraded');
  });

  it('does not downgrade an auth failure during working hours', () => {
    const d = decideAlert({
      kind: 'auth', consecutiveFailures: 1, nowSast: noon, lastGapAlertAt: null,
    });
    expect(d?.event).toBe('fleet.tracking_pull_failed');
  });
});

describe('gap re-alert is wall-clock, not tick-counted', () => {
  const base = new Date('2026-08-12T09:00:00Z');

  it('alerts on the first gap regardless of elapsed time', () => {
    const d = decideAlert({
      kind: 'gap', consecutiveFailures: 1, nowSast: base, lastGapAlertAt: null,
    });
    expect(d?.event).toBe('fleet.tracking_data_gap');
    expect(d?.stampGapAlert).toBe(true);
  });

  it('stays silent 23 hours after the last gap alert', () => {
    // consecutiveFailures: 48 is deliberate, not the brief's 50: 48 % 12 === 0,
    // so the retired tick-counting rule (gapTicks % GAP_REPEAT_TICKS === 0)
    // would ALSO have alerted here. That makes this test discriminate the two
    // implementations — with 50 (50 % 12 = 2) the old rule stays silent too,
    // so the assertion would pass against either mechanism and prove nothing.
    const d = decideAlert({
      kind: 'gap', consecutiveFailures: 48, nowSast: base,
      lastGapAlertAt: new Date(base.getTime() - 23 * 3600_000),
    });
    expect(d).toBeNull();
  });

  it('re-alerts once 24 hours have passed', () => {
    const d = decideAlert({
      kind: 'gap', consecutiveFailures: 50, nowSast: base,
      lastGapAlertAt: new Date(base.getTime() - 24 * 3600_000 - 1000),
    });
    expect(d?.event).toBe('fleet.tracking_data_gap');
  });

  it('does not tighten when the poll interval tightens', () => {
    // The whole point: at a 10-minute cadence a vehicle accumulates 144 gap
    // ticks a day. Under tick counting that alerted 12 times; it must not.
    const d = decideAlert({
      kind: 'gap', consecutiveFailures: 144, nowSast: base,
      lastGapAlertAt: new Date(base.getTime() - 3600_000),
    });
    expect(d).toBeNull();
  });
});

describe('transient re-alert is wall-clock, not tick-counted', () => {
  const base = new Date('2026-08-12T09:00:00Z');

  it('alerts on the first failure to cross the threshold, with no prior transient alert', () => {
    const d = decideAlert({
      kind: 'transient', consecutiveFailures: 3, nowSast: base, lastGapAlertAt: null,
      lastTransientAlertAt: null,
    });
    expect(d?.event).toBe('fleet.tracking_pull_degraded');
    expect(d?.stampTransientAlert).toBe(true);
  });

  it('stays silent 23 hours after the last transient alert, however high the streak', () => {
    // consecutiveFailures: 48 is deliberately high — proves silence comes
    // from the wall clock, not from the streak resetting or shrinking.
    const d = decideAlert({
      kind: 'transient', consecutiveFailures: 48, nowSast: base, lastGapAlertAt: null,
      lastTransientAlertAt: new Date(base.getTime() - 23 * 3600_000),
    });
    expect(d).toBeNull();
  });

  it('re-alerts once 24 hours have passed', () => {
    const d = decideAlert({
      kind: 'transient', consecutiveFailures: 50, nowSast: base, lastGapAlertAt: null,
      lastTransientAlertAt: new Date(base.getTime() - 24 * 3600_000 - 1000),
    });
    expect(d?.event).toBe('fleet.tracking_pull_degraded');
    expect(d?.stampTransientAlert).toBe(true);
  });

  /**
   * The test that matters for this task.
   *
   * The defect: TRANSIENT_THRESHOLD gates the FIRST alert but nothing gated
   * repeats, so alert volume scaled with tick count — a 2h cadence made a 6h
   * outage 3 ticks / 1 alert, but tightening to 10 minutes (this branch's own
   * change) made the SAME 6h outage 36 ticks / 34 alerts with the old code.
   *
   * Replays 36 ticks 10 minutes apart — the exact bookkeeping pollProvider
   * performs (advance lastTransientAlertAt only when a decision fires) — and
   * asserts the total stays at 1, matching the untightened baseline exactly.
   */
  it('does not scale alert count with tick count when the poll cadence tightens', () => {
    let lastTransientAlertAt: Date | null = null;
    let alertCount = 0;
    for (let tick = 1; tick <= 36; tick++) {
      const now = new Date(base.getTime() + tick * 10 * 60_000);
      const decision = decideAlert({
        kind: 'transient', consecutiveFailures: tick, nowSast: now,
        lastGapAlertAt: null, lastTransientAlertAt,
      });
      if (decision) {
        alertCount++;
        if (decision.stampTransientAlert) lastTransientAlertAt = now;
      }
    }
    expect(alertCount).toBe(1);
  });
});

describe('raiseTrackingAlert', () => {
  const base = {
    provider: 'netstar' as const,
    accountRef: 'europcar',
    detail: 'HTTP 401',
    nowSast: new Date('2026-08-05T12:00:00+02:00'),
    lastGapAlertAt: null,
  };

  it('never sends a non-UUID source_id — the column is uuid, so a composite key kills the insert', async () => {
    // Regression guard. This used to pass `${provider}:${accountRef}` — e.g.
    // "netstar:europcar" — into user_notifications.source_id, which is a UUID
    // column. Every fleet tracking alert died at the insert with
    //   invalid input syntax for type uuid: "cartrack:urent"
    // and NOT ONE reached a human between 2026-08-08 and 2026-08-17. It was
    // invisible because NotificationBus logs the per-user failure and resolves
    // rather than rethrowing, so raiseTrackingAlert still reported delivered.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const payloads: Record<string, unknown>[] = [];
    const notify = vi.fn(async (p: Record<string, unknown>) => {
      payloads.push(p);
      return { delivered: 1, failed: 0 };
    });

    for (const kind of ['auth', 'gap', 'transient'] as const) {
      await raiseTrackingAlert(
        { ...base, kind, consecutiveFailures: 5 },
        { notify, recipients: async () => ['u1'] }
      );
    }

    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) {
      if (p.source_id !== undefined && p.source_id !== null) {
        expect(String(p.source_id)).toMatch(UUID);
      }
    }
  });

  it('does not notify when the policy says stay silent, and reports nothing delivered', async () => {
    const notify = vi.fn();
    const result = await raiseTrackingAlert(
      { ...base, kind: 'transient', consecutiveFailures: 1 },
      { notify, recipients: async () => ['u1'] }
    );
    expect(notify).not.toHaveBeenCalled();
    expect(result).toEqual({ decision: null, delivered: false });
  });

  it('notifies the configured recipients on an auth failure, and reports delivered: true', async () => {
    const notify = vi.fn(async () => ({ delivered: 2, failed: 0 }));
    const result = await raiseTrackingAlert(
      { ...base, kind: 'auth', consecutiveFailures: 1 },
      { notify, recipients: async () => ['u1', 'u2'] }
    );
    expect(notify).toHaveBeenCalledTimes(1);
    const payload = notify.mock.calls[0][0];
    expect(payload.event_type).toBe('fleet.tracking_pull_failed');
    expect(payload.recipient_user_ids).toEqual(['u1', 'u2']);
    expect(payload.source_module).toBe('fleet');
    expect(payload.title).toContain('netstar');
    expect(result).toEqual({ decision: { event: 'fleet.tracking_pull_failed' }, delivered: true });
  });

  it('does not throw when no recipients are configured, and reports delivered: false', async () => {
    const notify = vi.fn();
    const result = await raiseTrackingAlert(
      { ...base, kind: 'auth', consecutiveFailures: 1 },
      { notify, recipients: async () => [] }
    );
    expect(notify).not.toHaveBeenCalled();
    // The decision (and thus the event that WOULD have fired) is still
    // reported — only delivery failed — so a caller like the gap stamp can
    // tell "nobody was there to hear it" apart from "the policy said no".
    expect(result).toEqual({ decision: { event: 'fleet.tracking_pull_failed' }, delivered: false });
  });

  it('never lets a notification failure break the poll, and reports delivered: false', async () => {
    const notify = vi.fn(async () => { throw new Error('smtp down'); });
    const result = await raiseTrackingAlert(
      { ...base, kind: 'auth', consecutiveFailures: 1 },
      { notify, recipients: async () => ['u1'] }
    );
    expect(result).toEqual({ decision: { event: 'fleet.tracking_pull_failed' }, delivered: false });
  });

  it('reports delivered: false when notify() resolves but reached nobody', async () => {
    // The nine-day outage in one line. notify() catches per-recipient failures
    // and resolves regardless, so "the promise resolved" never meant "somebody
    // was told" — and this call site read it as exactly that. With the counters
    // it can tell the difference, and pollProvider's `if (delivered && ...)`
    // gate then leaves last_gap_alert_at unstamped, so the next tick alerts
    // again instead of serving a 24h silence for an outage nobody heard about.
    const notify = vi.fn(async () => ({ delivered: 0, failed: 1 }));
    const result = await raiseTrackingAlert(
      { ...base, kind: 'gap', consecutiveFailures: 1 },
      { notify, recipients: async () => ['u1'] }
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(result.decision).toEqual({ event: 'fleet.tracking_data_gap', stampGapAlert: true });
    expect(result.delivered).toBe(false);
  });

  it('reports delivered: true when at least one recipient of several got through', async () => {
    // Partial delivery is still delivery: somebody was told, so the cooldown
    // is legitimate. Only "nobody at all" must keep the alert live.
    const notify = vi.fn(async () => ({ delivered: 1, failed: 3 }));
    const result = await raiseTrackingAlert(
      { ...base, kind: 'gap', consecutiveFailures: 1 },
      { notify, recipients: async () => ['u1', 'u2', 'u3', 'u4'] }
    );
    expect(result.delivered).toBe(true);
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
    decideAlert({
      kind: 'auth', consecutiveFailures: 1, nowSast: at(hhmm), lastGapAlertAt: null,
    })?.event;

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

describe('evicted kind', () => {
  const noon = new Date('2026-08-12T10:00:00Z'); // 12:00 SAST, working hours

  it('does not alert on a fresh eviction — a human using their portal is not an incident', () => {
    expect(decideAlert({
      kind: 'evicted', consecutiveFailures: 1, nowSast: noon,
      lastGapAlertAt: null, evictedSinceMs: 5 * 60_000,
    })).toBeNull();
  });

  it('escalates to auth-grade once eviction is sustained past 30 minutes', () => {
    // A dead password can present identically, so it must not hide here forever.
    expect(decideAlert({
      kind: 'evicted', consecutiveFailures: 4, nowSast: noon,
      lastGapAlertAt: null, evictedSinceMs: 31 * 60_000,
    })?.event).toBe('fleet.tracking_pull_failed');
  });

  it('sustained eviction overnight uses the no-WhatsApp event', () => {
    const night = new Date('2026-08-12T20:00:00Z'); // 22:00 SAST
    expect(decideAlert({
      kind: 'evicted', consecutiveFailures: 4, nowSast: night,
      lastGapAlertAt: null, evictedSinceMs: 31 * 60_000,
    })?.event).toBe('fleet.tracking_pull_degraded');
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
