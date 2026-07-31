/**
 * Health classification and alert rendering for the unified WhatsApp bridge.
 *
 * Why this exists: on 2026-07-30 WhatsApp logged the bridge number out at 11:15
 * SAST. Nobody was told. The outage ran 80 minutes and was only noticed because
 * a human went looking. Three separate guards had been switched off the previous
 * day during a number swap, and the one monitor still running (the velo
 * ingestion watchdog) polls a different bridge entirely.
 *
 * This probe runs OFF the VPS, on velo, precisely so it still fires when the VPS
 * itself is unreachable — the 2026-07-28 failure mode, where the box was powered
 * off across the whole 06:00 window and every send was lost silently.
 *
 * Email is the PRIMARY channel for the same reason it is in the non-activation
 * report's alert: a dead bridge is the failure being reported, so alerting over
 * that same bridge goes quiet exactly when it matters.
 *
 * @module lib/wa-bridge-health/monitor
 */

/**
 * The bridge's /health payload.
 *
 * TRAP: `status` is the literal string "ok" even when the device is logged out
 * and every send is failing. It reports "the HTTP server is answering", nothing
 * more. Never branch on it — `connected`, `session_valid` and `needs_auth` are
 * the fields that carry the real state.
 */
export interface BridgeHealthPayload {
  connected?: boolean;
  session_valid?: boolean;
  needs_auth?: boolean;
  phone_number?: string;
  device_jid?: string;
  pairing_state?: string;
}

export type BridgeVerdict = 'healthy' | 'disconnected' | 'logged_out' | 'unreachable';

export interface BridgeStatus {
  verdict: BridgeVerdict;
  /** Human-readable reason, used in the alert body. */
  detail: string;
  phone: string;
  /** True when a restart cannot fix this and a human with the handset is needed. */
  needsHuman: boolean;
}

/** Verdicts that warrant waking someone up. */
const ALERTING_VERDICTS: readonly BridgeVerdict[] = ['unreachable', 'logged_out', 'disconnected'];

export function isAlerting(verdict: BridgeVerdict): boolean {
  return ALERTING_VERDICTS.includes(verdict);
}

/**
 * Classify a probe result.
 *
 * `payload` is null when the probe could not reach the bridge at all — a dead
 * VPS, a dropped Tailscale route, or a hung process. That is deliberately a
 * distinct verdict from "the bridge answered and told us it is unhealthy",
 * because the remedies differ completely.
 */
export function classifyBridgeHealth(payload: BridgeHealthPayload | null): BridgeStatus {
  if (!payload) {
    return {
      verdict: 'unreachable',
      detail: 'The bridge health endpoint did not respond. The VPS may be down or unreachable.',
      phone: 'unknown',
      needsHuman: true,
    };
  }

  const phone = payload.phone_number?.trim() || 'unknown';

  // Checked before `connected`, because a logged-out bridge still reports
  // connected:true while it sits on the pairing screen.
  if (payload.session_valid !== true || payload.needs_auth === true) {
    return {
      verdict: 'logged_out',
      detail:
        'WhatsApp has logged the device out. A restart CANNOT fix this — it only ' +
        'burns pairing-code requests into WhatsApp rate limiting. Someone holding ' +
        'the handset must enter a fresh pairing code.',
      phone,
      needsHuman: true,
    };
  }

  if (payload.connected !== true) {
    return {
      verdict: 'disconnected',
      detail:
        'The device is still paired but the socket is down. The VPS healthcheck ' +
        'should reconnect it within 5 minutes; escalate only if this persists.',
      phone,
      needsHuman: false,
    };
  }

  return { verdict: 'healthy', detail: 'Bridge is connected and paired.', phone, needsHuman: false };
}

/** Strip CR/LF so a value can never inject extra mail headers. */
export function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n\0]+/g, ' ').trim();
}

const REMEDY: Record<Exclude<BridgeVerdict, 'healthy'>, string[]> = {
  logged_out: [
    'Re-pair the bridge (needs the physical handset):',
    '',
    '  ssh root@72.61.197.178',
    '  systemctl restart whatsapp-bridge',
    '  tail -f /opt/whatsapp-bridge/bridge.log | grep --line-buffered "PAIRING CODE"',
    '',
    'Then on the handset: WhatsApp -> Settings -> Linked Devices -> Link a Device',
    '-> "Link with phone number instead" -> enter the code.',
    '',
    'Do NOT leave it looping unattended: it re-requests a code every 5 minutes and',
    'walks the account into 429 rate-overlimit, which is what burned three codes',
    'on 2026-07-29.',
  ],
  unreachable: [
    'Check the VPS itself first — this fires when the box is unreachable, not just',
    'when the bridge is unhealthy:',
    '',
    '  ping -c3 72.61.197.178',
    '  ssh root@72.61.197.178 systemctl status whatsapp-bridge',
  ],
  disconnected: [
    'Usually self-heals. The VPS healthcheck restarts a paired-but-disconnected',
    'bridge within 5 minutes:',
    '',
    '  ssh root@72.61.197.178 tail -20 /var/log/wa-healthcheck.log',
  ],
};

/**
 * Render the alert for a status, or null when there is nothing to say.
 *
 * `recovered` renders the all-clear instead, so whoever got paged learns the
 * outage ended without having to go and check.
 */
export function buildBridgeAlert(
  status: BridgeStatus,
  opts: { recovered?: boolean; downtimeMs?: number } = {},
): { subject: string; text: string } | null {
  if (opts.recovered) {
    const forMins = opts.downtimeMs ? ` after ${Math.round(opts.downtimeMs / 60000)} min` : '';
    return {
      subject: `[FibreFlow] WhatsApp bridge RECOVERED${forMins}`,
      text: [
        `The WhatsApp bridge is connected and paired again${forMins}.`,
        `Number: ${status.phone}`,
        '',
        'No action needed.',
        '',
        '— Jarvis 🤖',
      ].join('\n'),
    };
  }

  if (status.verdict === 'healthy') return null;

  const urgency = status.needsHuman ? 'ACTION NEEDED' : 'degraded';

  return {
    subject: `[FibreFlow] WhatsApp bridge ${status.verdict.toUpperCase()} — ${urgency}`,
    text: [
      `The WhatsApp bridge is ${status.verdict.replace('_', ' ')}.`,
      `Number: ${status.phone}`,
      '',
      status.detail,
      '',
      'While it is down, DR submissions and photos from every monitored group are',
      'being dropped — they are not queued and will not arrive late.',
      '',
      ...REMEDY[status.verdict],
      '',
      '— Jarvis 🤖',
    ].join('\n'),
  };
}
