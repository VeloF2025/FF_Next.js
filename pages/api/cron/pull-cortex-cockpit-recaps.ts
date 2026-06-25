// Cron endpoint — pull cockpit-native meetings from Cortex Scribe.
//
// Un-recorded ad-hoc Teams meetings where a human logged action items live in the Cortex
// side panel have no FibreFlow meeting row (no callRecord, no transcript). Cortex serves
// them on a dedicated, per-tenant (Velocity-only) feed; this cron find-or-creates a
// `source='cockpit'` meeting row (reconciling with a recorded row when one exists) + its
// action items, then acks Cortex so the meeting leaves the feed.
//
// Auth: CRON_SECRET bearer token (same as the other Cortex pull crons).
//   curl -X POST http://localhost:3000/api/cron/pull-cortex-cockpit-recaps \
//        -H "Authorization: Bearer $CRON_SECRET"

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { neon } from '@/lib/db-neon';
import { apiResponse } from '@/lib/apiResponse';
import { syncCortexCockpitRecaps } from '@/lib/cortex/pullCockpitRecaps';

const LOGGER = 'PullCortexCockpitRecaps';
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

  log.info('Pull-cortex-cockpit-recaps triggered', {}, LOGGER);
  res.status(202).json({ message: 'Pulling cockpit-native meetings from Cortex' });

  // Kill-switch: CORTEX_DELIVERY_ENABLED=false halts NEW task creation/acks immediately
  // (meeting rows still land). Default ON. Shares the flag with the recorded-actions cron.
  const deliveryEnabled = process.env.CORTEX_DELIVERY_ENABLED !== 'false';

  setImmediate(async () => {
    try {
      const result = await syncCortexCockpitRecaps(sql, BRIDGE_URL, API_KEY, { deliveryEnabled });
      log.info('Pull-cortex-cockpit-recaps complete', { deliveryEnabled, ...result }, LOGGER);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error('Pull-cortex-cockpit-recaps failed', { error: msg }, LOGGER);
    }
  });
}

export default handler;
