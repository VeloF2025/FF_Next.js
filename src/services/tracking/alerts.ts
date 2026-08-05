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

export type AlertKind = 'auth' | 'transient' | 'gap';

export interface AlertInput {
  kind: AlertKind;
  consecutiveFailures: number;
  /** Current time expressed in SAST. South Africa has no DST. */
  nowSast: Date;
}

export interface AlertDecision {
  event: 'fleet.tracking_pull_failed' | 'fleet.tracking_data_gap';
  channels: { in_app: boolean; email: boolean; whatsapp: boolean };
  /** Non-null when WhatsApp is warranted but should wait until working hours. */
  deferWhatsappUntil: Date | null;
}

/** Transient errors must repeat this many times before anyone is told. */
const TRANSIENT_THRESHOLD = 3;
const QUIET_UNTIL_HOUR = 7;
const QUIET_FROM_HOUR = 20;
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

function sastHour(d: Date): number {
  return new Date(d.getTime() + SAST_OFFSET_MS).getUTCHours();
}

/** 07:00 SAST on the next calendar day that has not passed it yet. */
function nextSevenAm(d: Date): Date {
  const sast = new Date(d.getTime() + SAST_OFFSET_MS);
  const target = new Date(sast);
  target.setUTCHours(QUIET_UNTIL_HOUR, 0, 0, 0);
  if (target <= sast) target.setUTCDate(target.getUTCDate() + 1);
  return new Date(target.getTime() - SAST_OFFSET_MS);
}

export function decideAlert(input: AlertInput): AlertDecision | null {
  if (input.kind === 'gap') {
    return {
      event: 'fleet.tracking_data_gap',
      channels: { in_app: true, email: true, whatsapp: false },
      deferWhatsappUntil: null,
    };
  }

  if (input.kind === 'transient') {
    if (input.consecutiveFailures < TRANSIENT_THRESHOLD) return null;
    return {
      event: 'fleet.tracking_pull_failed',
      channels: { in_app: true, email: true, whatsapp: false },
      deferWhatsappUntil: null,
    };
  }

  // Auth failure: will not self-heal, so WhatsApp is warranted — but a 02:00
  // failure cannot be acted on until morning, so the message waits.
  const hour = sastHour(input.nowSast);
  const overnight = hour < QUIET_UNTIL_HOUR || hour >= QUIET_FROM_HOUR;
  return {
    event: 'fleet.tracking_pull_failed',
    channels: { in_app: true, email: true, whatsapp: true },
    deferWhatsappUntil: overnight ? nextSevenAm(input.nowSast) : null,
  };
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
async function configuredRecipients(): Promise<string[]> {
  return (process.env.FLEET_ALERT_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function raiseTrackingAlert(
  input: RaiseAlertInput,
  deps: RaiseAlertDeps = { notify: busNotify, recipients: configuredRecipients }
): Promise<void> {
  const decision = decideAlert(input);
  if (!decision) return;

  const recipients = await deps.recipients();
  if (recipients.length === 0) {
    log.warn('[tracking-alerts] alert raised but no recipients configured', {
      event: decision.event, provider: input.provider,
      hint: 'set FLEET_ALERT_USER_IDS',
    });
    return;
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
        deferWhatsappUntil: decision.deferWhatsappUntil?.toISOString() ?? null,
      },
    });
  } catch (err) {
    // A broken mail server must never take the ingestion run down with it —
    // the positions are the point, the alert is the courtesy.
    log.error('[tracking-alerts] failed to dispatch alert', {
      event: decision.event, provider: input.provider,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
