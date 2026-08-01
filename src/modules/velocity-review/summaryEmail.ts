import { createLogger } from '@/lib/logger';
import { createSmtpTransport } from '@/lib/smtpConfig';
import { setVelocityReviewSummaryStatus, type VelocityReviewSummaryStatus } from './runRepository';
import { buildRunSummary, type VelocityReviewSummary } from './summary';
import type { VelocityReviewRunResult } from './processor';

const logger = createLogger('velocity-review:summary');

function recipients(): string[] {
  return (process.env.VELOCITY_REVIEW_SUMMARY_TO ?? '')
    .split(',')
    .map((recipient) => recipient.trim())
    .filter(Boolean);
}

export async function sendVelocityReviewSummary(summary: VelocityReviewSummary): Promise<boolean> {
  const to = recipients();
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || to.length === 0) {
    logger.error('Velocity review summary configuration is incomplete', { status: 'not_sent' });
    return false;
  }
  try {
    const transport = createSmtpTransport();
    if (!transport) return false;
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: summary.subject,
      text: summary.text,
      html: summary.html,
    });
    return true;
  } catch {
    logger.error('Velocity review summary email failed', { status: 'failed' });
    return false;
  }
}

interface RunSummaryDependencies {
  send(summary: VelocityReviewSummary): Promise<boolean>;
  setStatus(
    targetDates: readonly string[],
    status: Extract<VelocityReviewSummaryStatus, 'sent' | 'failed'>,
  ): Promise<void>;
}

export async function sendVelocityReviewRunSummary(
  result: VelocityReviewRunResult,
  supplied: RunSummaryDependencies = {
    send: sendVelocityReviewSummary,
    setStatus: setVelocityReviewSummaryStatus,
  },
): Promise<boolean> {
  const sent = await supplied.send(buildRunSummary(result));
  const targetDates = [...new Set(result.dates.map((item) => item.targetDate))];
  await supplied.setStatus(targetDates, sent ? 'sent' : 'failed');
  return sent;
}
