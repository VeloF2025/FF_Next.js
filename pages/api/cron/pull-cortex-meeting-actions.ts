// Cron endpoint — pull vetted meeting action items from Cortex Scribe.
//
// Cortex turns APPROVED meeting proposed-actions into a governed, pull-only outbox feed
// once a meeting is sealed (human publish or auto-seal after a review grace). This cron
// pulls that feed and lands each sealed meeting's action items into cortex_meeting_actions,
// mapped to our own meetings row via source_id (= teams_call_record_id). Read-only landing
// for now; a review UI consumes this table in a later phase.
//
// Auth: CRON_SECRET bearer token (same as the transcript-pull cron).
//   curl -X POST http://localhost:3000/api/cron/pull-cortex-meeting-actions \
//        -H "Authorization: Bearer $CRON_SECRET"

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { neon } from '@/lib/db-neon';
import { apiResponse } from '@/lib/apiResponse';
import { syncCortexMeetingActions } from '@/lib/cortex/pullMeetingActions';

const LOGGER = 'PullCortexMeetingActions';
const sql = neon(process.env.DATABASE_URL!);

const BRIDGE_URL = process.env.CORTEX_BRIDGE_URL ?? 'http://localhost:7403';
const API_KEY = process.env.CORTEX_API_KEY ?? '';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method!, ['POST']);
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET is not configured', {}, LOGGER);
    apiResponse.internalError(res, new Error('Server misconfiguration'));
    return;
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    log.warn('Unauthorized cron attempt', { ip: req.headers['x-forwarded-for'] ?? req.socket.remoteAddress }, LOGGER);
    apiResponse.unauthorized(res);
    return;
  }
  if (!API_KEY) {
    log.error('CORTEX_API_KEY is not configured', {}, LOGGER);
    apiResponse.internalError(res, new Error('Cortex not configured'));
    return;
  }

  log.info('Pull-cortex-meeting-actions triggered', {}, LOGGER);
  res.status(202).json({ message: 'Pulling sealed meeting actions from Cortex' });

  // Kill-switch: CORTEX_DELIVERY_ENABLED=false halts NEW task creation/acks immediately
  // (records still land). Default ON so tenant-wide auto-delivery runs unless explicitly off.
  const deliveryEnabled = process.env.CORTEX_DELIVERY_ENABLED !== 'false';

  setImmediate(async () => {
    try {
      const result = await syncCortexMeetingActions(sql, BRIDGE_URL, API_KEY, { deliveryEnabled });
      log.info('Pull-cortex-meeting-actions complete', { deliveryEnabled, ...result }, LOGGER);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error('Pull-cortex-meeting-actions failed', { error: msg }, LOGGER);
    }
  });
}

export default handler;
