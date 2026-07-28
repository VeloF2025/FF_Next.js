/**
 * Failure alerting for the daily per-group non-activation report.
 *
 * Why this exists: on 2026-07-28 the WhatsApp bridge VPS was powered off across
 * the whole 06:00 window. The run built and uploaded every workbook, then lost
 * all seven sends. It logged each failure and returned normally, so the only
 * outward sign was a Cloudflare 524 in a cron log nobody reads — a full day of
 * reports to six groups vanished silently.
 *
 * Email is the PRIMARY channel precisely because it does not depend on the
 * WhatsApp bridge: a dead bridge is the failure this alert exists to report, so
 * alerting over that same bridge would go quiet exactly when it matters. The
 * WhatsApp infra group is a secondary channel, matching the db-health cron's
 * house pattern.
 *
 * @module lib/group-nonactivation/alert
 */
import { log } from '@/lib/logger';
import { createSmtpTransport } from '@/lib/smtpConfig';
import { sendWhatsAppGroup } from '@/modules/notifications/services/whatsappDelivery';

/** Same infra group the db-health cron alerts to. */
const WA_INFRA_GROUP_JID = process.env.WA_INFRA_GROUP_JID ?? '120363421664266245@g.us';

const OPS_TARGET = 'Unresolved PP ops worklist';

export interface SendFailure {
  /** Group name, or the ops worklist. */
  target: string;
  error: string;
}

/** The subset of a report run this module needs to judge success. */
export interface AlertRunOutcome {
  cohortDate: string;
  generatedDate: string;
  groups: { groupName: string; sent: boolean; error?: string }[];
  ops: { totalNotFound: number; sent: boolean; error?: string };
}

/**
 * With zero unresolved serials the service deliberately skips the ops send and
 * leaves `sent` false. That is a no-op, not a failure — counting it as one
 * would alert on every quiet day.
 */
function opsWasAttempted(outcome: AlertRunOutcome): boolean {
  return outcome.ops.totalNotFound > 0;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Every delivery target that failed, group sends and the ops worklist alike. */
export function collectFailures(outcome: AlertRunOutcome): SendFailure[] {
  const failures: SendFailure[] = [];

  for (const group of outcome.groups) {
    if (!group.sent) {
      failures.push({ target: group.groupName, error: group.error ?? 'unknown error' });
    }
  }

  if (opsWasAttempted(outcome) && !outcome.ops.sent) {
    failures.push({ target: OPS_TARGET, error: outcome.ops.error ?? 'unknown error' });
  }

  return failures;
}

/** Render the alert, or null when the run delivered everything it attempted. */
export function buildAlert(
  outcome: AlertRunOutcome,
  failures: SendFailure[],
): { subject: string; text: string } | null {
  if (failures.length === 0) return null;

  const attempted = outcome.groups.length + (opsWasAttempted(outcome) ? 1 : 0);
  const subject =
    `[FibreFlow] Non-activation report ${outcome.cohortDate}: ` +
    `${failures.length} of ${attempted} sends failed`;

  const text = [
    `The daily per-group non-activation report for ${outcome.cohortDate} ` +
      `(generated ${outcome.generatedDate}) did not fully deliver.`,
    '',
    `Failed (${failures.length} of ${attempted}):`,
    ...failures.map((f) => `  • ${f.target} — ${f.error}`),
    '',
    'The workbooks were built and uploaded successfully — only delivery failed,',
    'so a re-send costs nothing but a repeat of the same run:',
    '',
    '  curl -s -X POST http://localhost:3000/api/cron/group-nonactivation-report \\',
    '    -H "x-cron-secret: $CRON_SECRET" -H "Content-Type: application/json" \\',
    `    -d '{"cohort":"${outcome.cohortDate}","generated":"${outcome.generatedDate}"}'`,
    '',
    'Check the WhatsApp bridge first — a bridge outage fails every send at once.',
    '',
    '— Jarvis 🤖',
  ].join('\n');

  return { subject, text };
}

/** Strip CR/LF so a value can never inject extra mail headers. */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n\0]+/g, ' ').trim();
}

async function alertByEmail(subject: string, text: string): Promise<string | null> {
  const to = process.env.REPORT_ALERT_EMAIL_TO?.trim();
  if (!to) return 'email: REPORT_ALERT_EMAIL_TO not set';

  const transporter = createSmtpTransport();
  if (!transporter) return 'email: SMTP not configured';

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: sanitizeHeader(subject),
    text,
  });
  return null;
}

/**
 * Alert that a report run failed to deliver. Never throws and never rejects:
 * this runs inside the cron handler, and a failing alert must not turn a
 * partially-delivered run into a crashed one.
 */
export async function sendFailureAlert(outcome: AlertRunOutcome): Promise<void> {
  try {
    const failures = collectFailures(outcome);
    const alert = buildAlert(outcome, failures);
    if (!alert) return;

    const delivered: string[] = [];
    const problems: string[] = [];

    try {
      const skipped = await alertByEmail(alert.subject, alert.text);
      if (skipped) problems.push(skipped);
      else delivered.push('email');
    } catch (err) {
      problems.push(`email: ${messageOf(err)}`);
    }

    try {
      await sendWhatsAppGroup(WA_INFRA_GROUP_JID, `${alert.subject}\n\n${alert.text}`);
      delivered.push('whatsapp');
    } catch (err) {
      problems.push(`whatsapp: ${messageOf(err)}`);
    }

    if (delivered.length === 0) {
      log.error(
        'Non-activation send-failure alert could not be delivered on any channel',
        { failures: failures.length, problems },
        'GroupNonActivationReport',
      );
    } else {
      log.warn(
        'Non-activation report had send failures; alert dispatched',
        { failures: failures.length, delivered, problems },
        'GroupNonActivationReport',
      );
    }
  } catch (err) {
    // Backstop: alerting is best-effort and must never break the run.
    log.error(
      'Non-activation send-failure alert threw unexpectedly',
      { error: messageOf(err) },
      'GroupNonActivationReport',
    );
  }
}
