/**
 * POST /api/cron/group-nonactivation-report
 *
 * Protected cron endpoint — builds and sends the per-group non-activation + PP
 * report to each WhatsApp group, plus the consolidated "Unresolved Pre-Provision"
 * worklist to the reconciliation hub.
 *
 * Authentication: x-cron-secret: {CRON_SECRET}
 *
 * Scheduled every morning at 06:00 SAST by a Velocity cron:
 *   curl -s -X POST https://app.fibreflow.app/api/cron/group-nonactivation-report \
 *     -H "x-cron-secret: $CRON_SECRET"
 *
 * Optional body:
 *   { "dryRun": true }                 build + upload but skip every WhatsApp send
 *   { "cohort": "YYYY-MM-DD" }         override the cohort (yesterday) date
 *   { "generated": "YYYY-MM-DD" }      override the generation (today) date
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { runGroupNonActivationReport } from '@/services/groupNonActivationReport';
import { addDaysIso } from '@/lib/group-nonactivation/format';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sastToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET not configured', {}, 'group-nonactivation-report');
    return apiResponse.internalError(res, new Error('Server misconfiguration'));
  }
  if (req.headers['x-cron-secret'] !== cronSecret) {
    log.warn(
      'Unauthorised group non-activation report attempt',
      { ip: String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '') },
      'group-nonactivation-report',
    );
    return apiResponse.unauthorized(res, 'Invalid or missing x-cron-secret header');
  }

  const dryRun = req.body?.dryRun === true;
  const generatedDate =
    typeof req.body?.generated === 'string' && DATE_RE.test(req.body.generated)
      ? (req.body.generated as string)
      : sastToday();
  const cohortDate =
    typeof req.body?.cohort === 'string' && DATE_RE.test(req.body.cohort)
      ? (req.body.cohort as string)
      : addDaysIso(generatedDate, -1);

  log.info('Group non-activation report triggered', { dryRun, cohortDate, generatedDate }, 'group-nonactivation-report');

  try {
    const result = await runGroupNonActivationReport({ cohortDate, generatedDate, dryRun });
    return apiResponse.success(res, result, dryRun ? 'Reports generated (dry run)' : 'Reports sent');
  } catch (error: unknown) {
    log.error(
      'Group non-activation report failed',
      { error: error instanceof Error ? error.message : String(error) },
      'group-nonactivation-report',
    );
    return apiResponse.internalError(res, error, 'Group non-activation report failed');
  }
}
