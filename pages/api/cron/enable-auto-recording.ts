// 🟢 WORKING: Cron — enables auto-recording on upcoming Teams meetings
// Scans org calendars for the next 24h and PATCHes meetings to record automatically
// Schedule: every 30 minutes via system cron
import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { enableAutoRecordingForUpcomingMeetings } from '@/lib/graph/auto-recording';
import { apiResponse } from '@/lib/apiResponse';

const LOGGER = 'AutoRecordCron';

/**
 * POST /api/cron/enable-auto-recording
 *
 * Scans all org users' upcoming Teams meetings (next 24h) and enables
 * auto-recording via Graph API PATCH.
 *
 * Auth: CRON_SECRET bearer token.
 * Schedule: every 30 minutes via system cron.
 *
 * curl example:
 *   curl -X POST https://app.fibreflow.app/api/cron/enable-auto-recording \
 *        -H "Authorization: Bearer $CRON_SECRET"
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method!, ['GET']);
    return;
  }

  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    log.error('CRON_SECRET is not configured', {}, LOGGER);
    apiResponse.internalError(res, new Error('Server misconfiguration'));
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    log.warn(
      'Unauthorized cron attempt',
      { ip: req.headers['x-forwarded-for'] ?? req.socket.remoteAddress },
      LOGGER
    );
    apiResponse.unauthorized(res);
    return;
  }

  try {
    const hoursAhead = typeof req.body?.hours === 'number' ? req.body.hours : 24;
    const result = await enableAutoRecordingForUpcomingMeetings(hoursAhead);

    log.info('Auto-recording cron complete', result, LOGGER);

    res.status(200).json({ success: true, ...result });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('Auto-recording cron failed', { error: errorMsg }, LOGGER);
    res.status(500).json({ success: false, error: errorMsg });
  }
}
