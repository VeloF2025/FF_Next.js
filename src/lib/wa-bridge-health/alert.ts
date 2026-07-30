/**
 * Alert dispatch for the WhatsApp bridge health probe.
 *
 * Email is the PRIMARY channel, for the same reason it is in the non-activation
 * report's alert: a dead bridge is the failure being reported, so alerting over
 * that same bridge goes quiet exactly when it matters. The WhatsApp infra group
 * is secondary and is expected to fail during a real outage — that is fine, it
 * is guarded independently and email still lands.
 *
 * @module lib/wa-bridge-health/alert
 */
import { log } from '@/lib/logger';
import { createSmtpTransport } from '@/lib/smtpConfig';
import { sendWhatsAppGroup } from '@/modules/notifications/services/whatsappDelivery';
import { sanitizeHeader } from './monitor';

/** Same infra group the db-health cron and the non-activation alert use. */
const WA_INFRA_GROUP_JID = process.env.WA_INFRA_GROUP_JID ?? '120363421664266245@g.us';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Where infra alerts go. Falls back to REPORT_ALERT_EMAIL_TO so this works with
 * the address already configured in production rather than silently sending
 * nowhere until someone sets a new var.
 */
function alertRecipient(): string | undefined {
  return (process.env.INFRA_ALERT_EMAIL_TO ?? process.env.REPORT_ALERT_EMAIL_TO)?.trim() || undefined;
}

async function alertByEmail(subject: string, text: string): Promise<string | null> {
  const to = alertRecipient();
  if (!to) return 'email: INFRA_ALERT_EMAIL_TO / REPORT_ALERT_EMAIL_TO not set';

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
 * Dispatch an alert on every channel. Never throws: this runs inside a cron
 * handler and a failing alert must not turn a detected outage into a 500 that
 * hides the outage itself.
 *
 * Returns the channels that accepted the message, so the caller can log when
 * nothing got through.
 */
export async function dispatchBridgeAlert(
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
    await sendWhatsAppGroup(WA_INFRA_GROUP_JID, `${subject}\n\n${text}`);
    delivered.push('whatsapp');
  } catch (err) {
    // Expected during a genuine bridge outage — the bridge is what we send over.
    problems.push(`whatsapp: ${messageOf(err)}`);
  }

  if (delivered.length === 0) {
    log.error('WA bridge health alert could not be delivered on any channel',
      { subject, problems }, 'WaBridgeHealth');
  } else {
    log.warn('WA bridge health alert dispatched',
      { subject, delivered, problems }, 'WaBridgeHealth');
  }

  return { delivered, problems };
}
