/**
 * When a tracking pull failure is worth interrupting someone.
 *
 * The distinctions matter because this job runs twelve times a day, every day.
 * An auth failure will never fix itself and needs a human; a transient blip
 * usually resolves on the next tick and should not generate noise. A data gap —
 * the portal authenticating cleanly and returning nothing — is the dangerous
 * one, because it looks exactly like success.
 *
 * Pure function: no DB, no notification sending, so the policy is testable on
 * its own.
 */

import { notify as busNotify } from '@/modules/notifications/services/notificationBus';
import { log } from '@/lib/logger';
import type { ProviderKey } from './types';

export type AlertKind = 'auth' | 'transient' | 'gap' | 'evicted';

export interface AlertInput {
  kind: AlertKind;
  /**
   * How many consecutive unhealthy ticks this provider/account has had,
   * counted by `fleet_tracking_watermarks.consecutive_failures`.
   *
   * For `transient` it is the failure streak. For `gap` it is the streak of
   * consecutive gap ticks — the same column carries it, because a gap tick
   * deliberately does not reset the counter to 0 and a healthy tick does.
   * One column, one meaning: consecutive ticks that did not produce data.
   */
  consecutiveFailures: number;
  /** Current time expressed in SAST. South Africa has no DST. */
  nowSast: Date;
  /**
   * When this provider/account last had a gap alert raised, or null if never.
   * Read from fleet_tracking_watermarks.last_gap_alert_at. Null means "first
   * gap" and always alerts — failing loud on the first occurrence is the point.
   */
  lastGapAlertAt: Date | null;
  /**
   * How long this account has been continuously evicted, in ms; null or absent
   * when the failure is not an eviction. Below the escalation threshold this
   * stays silent on purpose.
   *
   * OPTIONAL deliberately: every non-evicted call site would otherwise have to
   * pass a meaningless null, and the tests written in Task 2 would stop
   * compiling the moment this field landed.
   */
  evictedSinceMs?: number | null;
  /**
   * When this provider/account last had a transient alert raised, or null if
   * never. Read from fleet_tracking_watermarks.last_transient_alert_at.
   *
   * OPTIONAL for the same reason evictedSinceMs is: every gap/auth/evicted
   * call site would otherwise have to pass a meaningless null, and every
   * other AlertInput literal in alerts.test.ts would stop compiling the
   * moment this field landed. Absent (undefined) and null both mean "no
   * prior transient alert" — always due, same as lastGapAlertAt's null.
   */
  lastTransientAlertAt?: Date | null;
}

export interface AlertDecision {
  event: 'fleet.tracking_pull_failed' | 'fleet.tracking_data_gap' | 'fleet.tracking_pull_degraded';
  /**
   * Whether the caller must write `now` to last_gap_alert_at. Only gap
   * decisions set this — the auth and transient paths have their own
   * bookkeeping in consecutive_failures and must not disturb the gap clock.
   */
  stampGapAlert?: boolean;
  /**
   * Whether the caller must write `now` to last_transient_alert_at. Only a
   * transient decision past TRANSIENT_REPEAT_AFTER_MS sets this — mirrors
   * stampGapAlert exactly, see its comment.
   */
  stampTransientAlert?: boolean;
}

/** Transient errors must repeat this many times before anyone is told. */
const TRANSIENT_THRESHOLD = 3;
/**
 * A sustained gap re-alerts at most once a day.
 *
 * This was GAP_REPEAT_TICKS = 12, counted in ticks and calibrated to a 2-hourly
 * job. Tick counting silently tightens as the cadence tightens: at a 10-minute
 * interval the same 12 ticks is one reminder every two hours, which the original
 * comment already identified as the failure mode — "the recipient learns to
 * ignore the channel". Wall-clock holds the promise the constant was making.
 */
const GAP_REPEAT_AFTER_MS = 24 * 3600_000;
/**
 * A sustained transient outage re-alerts at most once a day.
 *
 * Same wall-clock reasoning as GAP_REPEAT_AFTER_MS: TRANSIENT_THRESHOLD
 * counts consecutive failures correctly at any cadence, but nothing
 * suppressed REPEATS once the streak passed it, so alert volume scaled with
 * tick count as the poll interval tightened — the same coupling
 * GAP_REPEAT_AFTER_MS was added to remove, just missed on this branch.
 *
 * Kept as its OWN constant rather than reusing GAP_REPEAT_AFTER_MS: gap and
 * transient are different failure classes that happen to share a cadence
 * today, and nothing says they must stay in lockstep — a flakier upstream
 * that warrants more frequent reminders should be able to retune this
 * without also retuning gap re-alerts.
 */
const TRANSIENT_REPEAT_AFTER_MS = 24 * 3600_000;
/**
 * Eviction is only newsworthy once it stops looking like a human at a keyboard.
 * Thirty minutes is longer than a portal session someone opens to check one
 * vehicle, and short enough that a genuinely dead password is not hidden for a
 * working day.
 */
const EVICTION_ESCALATE_AFTER_MS = 30 * 60_000;
const QUIET_UNTIL_HOUR = 7;
const QUIET_FROM_HOUR = 20;
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

function sastHour(d: Date): number {
  return new Date(d.getTime() + SAST_OFFSET_MS).getUTCHours();
}

/**
 * Decide which event to raise, if any.
 *
 * The notification bus (`notify()`) resolves delivery channels itself, from
 * `DEFAULT_CHANNEL_PREFERENCES[event_type]` — it has no per-call channel
 * override. So the channel policy (WhatsApp yes/no, immediate vs deferred)
 * has to be encoded in WHICH event type we choose, not in a field on the
 * decision: `fleet.tracking_pull_failed` is registered with whatsapp: true,
 * `fleet.tracking_pull_degraded` and `fleet.tracking_data_gap` with
 * whatsapp: false.
 *
 * Overnight auth failures deliberately do NOT schedule a delayed WhatsApp.
 * There is no scheduler here to fire one. Instead: an auth failure does not
 * self-heal, and this job polls every 2 hours, so if it's still broken at
 * the next daytime tick, that tick's `nowSast` will fall inside working
 * hours and emit `fleet.tracking_pull_failed` (whatsapp: true) then. The
 * "deferral" falls out of the polling cadence for free — no timer needed —
 * at the cost of coarser granularity: up to one tick (~2h) after 07:00
 * rather than exactly at 07:00.
 *
 * `evicted` is silent below EVICTION_ESCALATE_AFTER_MS — a human in the portal
 * is not an incident — then falls through to the same working-hours channel
 * policy as `auth`, because sustained eviction and a dead credential present
 * identically and both need the same human.
 */
export function decideAlert(input: AlertInput): AlertDecision | null {
  if (input.kind === 'gap') {
    // Alert on the FIRST gap — that one is news and must never be delayed —
    // then go quiet while it stays broken, surfacing again once per
    // GAP_REPEAT_AFTER_MS. null means the provider/account has never had a
    // gap alert; treat that as a first occurrence and alert, because failing
    // loud is the whole point of this alert.
    const last = input.lastGapAlertAt;
    const due = last === null || input.nowSast.getTime() - last.getTime() >= GAP_REPEAT_AFTER_MS;
    if (!due) return null;
    return { event: 'fleet.tracking_data_gap', stampGapAlert: true };
  }

  if (input.kind === 'transient') {
    if (input.consecutiveFailures < TRANSIENT_THRESHOLD) return null;
    // Alert on the first tick past the threshold, then go quiet while the
    // outage continues, surfacing again once per TRANSIENT_REPEAT_AFTER_MS —
    // same rule as the gap branch above. undefined/null both mean "never
    // alerted"; treat that as due, matching lastGapAlertAt's null handling.
    const last = input.lastTransientAlertAt ?? null;
    const due = last === null || input.nowSast.getTime() - last.getTime() >= TRANSIENT_REPEAT_AFTER_MS;
    if (!due) return null;
    return { event: 'fleet.tracking_pull_degraded', stampTransientAlert: true };
  }

  if (input.kind === 'evicted') {
    // Normalize the OPTIONAL field to null first: `undefined` (never set) and
    // `null` (not currently evicted) both mean "not sustained" the same way.
    const evictedSinceMs = input.evictedSinceMs ?? null;
    const sustained = evictedSinceMs !== null && evictedSinceMs >= EVICTION_ESCALATE_AFTER_MS;
    if (!sustained) return null;
    // Sustained eviction is indistinguishable from a dead credential, so from
    // here it takes the auth path's working-hours channel policy exactly.
  }

  // Auth failure: will not self-heal, so WhatsApp is warranted during
  // working hours. Overnight, downgrade to the no-WhatsApp event — see the
  // polling-cadence comment above for why no scheduler is needed.
  const hour = sastHour(input.nowSast);
  const workingHours = hour >= QUIET_UNTIL_HOUR && hour < QUIET_FROM_HOUR;
  return { event: workingHours ? 'fleet.tracking_pull_failed' : 'fleet.tracking_pull_degraded' };
}

export interface RaiseAlertInput extends AlertInput {
  provider: ProviderKey;
  accountRef: string;
  detail: string;
}

export interface RaiseAlertDeps {
  notify: (payload: {
    event_type: string;
    title: string;
    body: string;
    source_module: string;
    source_id?: string;
    recipient_user_ids: string[];
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  recipients: () => Promise<string[]>;
}

/**
 * Who hears about fleet tracking failures.
 *
 * Configured by id rather than resolved from a role: the fleet manager's
 * staff.position currently reads "Staff", so a role lookup would find nobody —
 * and an alerting system that silently addresses no one is worse than none.
 * An env var keeps it changeable without a deploy touching code.
 */
/**
 * Ids are UUIDs downstream (`${userId}::uuid` in notificationBus). A typo in
 * the env var would otherwise surface once per recipient per alert as a caught
 * cast error, which reads as "the mail server is flaky" rather than "this list
 * is wrong". Dropping malformed entries here, loudly, keeps the good ones.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function alertRecipientIds(): string[] {
  const raw = (process.env.FLEET_ALERT_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = raw.filter((id) => UUID_RE.test(id));
  if (valid.length !== raw.length) {
    log.error('[tracking-alerts] FLEET_ALERT_USER_IDS contains entries that are not UUIDs', {
      rejected: raw.filter((id) => !UUID_RE.test(id)),
    });
  }
  return valid;
}

/** How many recipients an alert would reach right now. 0 means "nobody". */
export function alertRecipientCount(): number {
  return alertRecipientIds().length;
}

async function configuredRecipients(): Promise<string[]> {
  return alertRecipientIds();
}

export interface RaiseAlertOutcome {
  /** What `decideAlert` computed for this input, or null if it said stay silent. */
  decision: AlertDecision | null;
  /**
   * Whether the notification actually reached `deps.notify` and it resolved —
   * false whenever the policy said silent, no recipients were configured, or
   * `notify` itself threw. Callers that gate side effects on "the alert went
   * out" (e.g. stamping last_gap_alert_at) must check this, not just
   * `decision`: a truthy decision only means the POLICY said to alert, not
   * that anyone was actually told.
   */
  delivered: boolean;
}

export async function raiseTrackingAlert(
  input: RaiseAlertInput,
  deps: RaiseAlertDeps = { notify: busNotify, recipients: configuredRecipients }
): Promise<RaiseAlertOutcome> {
  const decision = decideAlert(input);
  if (!decision) return { decision: null, delivered: false };

  const recipients = await deps.recipients();
  if (recipients.length === 0) {
    log.warn('[tracking-alerts] alert raised but no recipients configured', {
      event: decision.event, provider: input.provider,
      hint: 'set FLEET_ALERT_USER_IDS',
    });
    return { decision, delivered: false };
  }

  const title =
    decision.event === 'fleet.tracking_data_gap'
      ? `No tracking data from ${input.provider}`
      : `Tracking pull failed: ${input.provider}`;

  try {
    await deps.notify({
      event_type: decision.event,
      title,
      body: `${input.provider}/${input.accountRef}: ${input.detail}`,
      source_module: 'fleet',
      source_id: `${input.provider}:${input.accountRef}`,
      recipient_user_ids: recipients,
      metadata: {
        provider: input.provider,
        accountRef: input.accountRef,
        consecutiveFailures: input.consecutiveFailures,
      },
    });
    return { decision, delivered: true };
  } catch (err) {
    // A broken mail server must never take the ingestion run down with it —
    // the positions are the point, the alert is the courtesy.
    log.error('[tracking-alerts] failed to dispatch alert', {
      event: decision.event, provider: input.provider,
      error: err instanceof Error ? err.message : String(err),
    });
    return { decision, delivered: false };
  }
}
