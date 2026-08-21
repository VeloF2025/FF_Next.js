/**
 * Alert dispatch for the vLLM health probe.
 *
 * Email is the PRIMARY channel: field verification runs on the same WhatsApp
 * path as the WA bridge alerts, so a WhatsApp-only alert path can go quiet
 * around exactly the incidents worth knowing about (e.g. bridge and VLM down
 * together). The WhatsApp infra group is secondary and best-effort.
 *
 * @module lib/vlm-health/alert
 */
import { log } from '@/lib/logger';
import { createSmtpTransport } from '@/lib/smtpConfig';
import { sendWhatsAppGroup } from '@/modules/notifications/services/whatsappDelivery';
import { sanitizeHeader } from './monitor';

/** Same infra group the WA bridge health cron and db-health cron use. */
const WA_INFRA_GROUP_JID = process.env.WA_INFRA_GROUP_JID ?? '120363421664266245@g.us';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Where infra alerts go. Falls back to REPORT_ALERT_EMAIL_TO so this works
 * with the address already configured in production rather than silently
 * sending nowhere until someone sets a new var.
 */
function alertRecipient(): string | undefined {
  const configured = process.env.INFRA_ALERT_EMAIL_TO?.trim() || process.env.REPORT_ALERT_EMAIL_TO?.trim();
  return configured || undefined;
}

/**
 * Cap how long a channel may block. This runs on a 5-minute cron against a
 * long-lived server; an SMTP connection that hangs would otherwise stall the
 * invocation and can overlap the next tick.
 *
 * This only stops the CALLER from waiting — it does not cancel `work` itself,
 * which keeps running in the background after "timing out". That is fine
 * here: both callers discard the result on timeout and neither send has a
 * side effect worth aborting.
 */
async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const SEND_TIMEOUT_MS = 20_000;

async function alertByEmail(subject: string, text: string): Promise<string | null> {
  const to = alertRecipient();
  if (!to) return 'email: INFRA_ALERT_EMAIL_TO / REPORT_ALERT_EMAIL_TO not set';

  const transporter = createSmtpTransport();
  if (!transporter) return 'email: SMTP not configured';

  await withTimeout(
    Promise.resolve(
      transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject: sanitizeHeader(subject),
        text,
      }),
    ),
    SEND_TIMEOUT_MS,
    'smtp send',
  );
  return null;
}

/**
 * Dispatch an alert on every channel. Never throws: this runs inside a cron
 * handler and a failing alert must not turn a detected outage into a 500 that
 * hides the outage itself.
 *
 * Returns the channels that accepted the message, so the caller can log when
 * nothing got through.
 */
export async function dispatchVlmAlert(
  subject: string,
  text: string,
): Promise<{ delivered: string[]; problems: string[] }> {
  const delivered: string[] = [];
  const problems: string[] = [];

  try {
    const skipped = await alertByEmail(subject, text);
    if (skipped) problems.push(skipped);
    else delivered.push('email');
  } catch (err) {
    problems.push(`email: ${messageOf(err)}`);
  }

  try {
    await withTimeout(
      Promise.resolve(sendWhatsAppGroup(WA_INFRA_GROUP_JID, `${subject}\n\n${text}`)),
      SEND_TIMEOUT_MS,
      'whatsapp send',
    );
    delivered.push('whatsapp');
  } catch (err) {
    problems.push(`whatsapp: ${messageOf(err)}`);
  }

  if (delivered.length === 0) {
    log.error('VLM health alert could not be delivered on any channel',
      { subject, problems }, 'VlmHealth');
  } else {
    log.warn('VLM health alert dispatched',
      { subject, delivered, problems }, 'VlmHealth');
  }

  return { delivered, problems };
}
