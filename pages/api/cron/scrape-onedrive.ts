// 🟢 WORKING: Cron endpoint — scrapes Teams recordings from users' OneDrive /Recordings/ folders
import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { scrapeOneDriveRecordings } from '@/lib/graph/onedrive-recordings';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const LOGGER = 'OneDriveCron';

/**
 * POST /api/cron/scrape-onedrive
 *
 * Scans all internal users' OneDrive /Recordings/ folders for Teams meeting
 * recordings that haven't been captured by the regular pipeline (e.g. "Meet Now"
 * calls where someone manually clicked Record).
 *
 * Downloads recordings to local disk, matches to existing meetings or creates
 * new entries, and runs LLM enrichment.
 *
 * Auth: CRON_SECRET bearer token.
 * Schedule: every 30 minutes via system cron.
 *
 * Query params:
 *   ?lookbackDays=30  — how far back to check (default: 30)
 *   ?limit=50         — max recordings to process per run (default: 50)
 *
 * curl example:
 *   curl -X POST https://app.fibreflow.app/api/cron/scrape-onedrive \
 *        -H "Authorization: Bearer $CRON_SECRET"
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET is not configured', {}, LOGGER);
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    log.warn(
      'Unauthorized cron attempt',
      { ip: req.headers['x-forwarded-for'] ?? req.socket.remoteAddress },
      LOGGER
    );
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const lookbackDays = parseInt(req.query.lookbackDays as string) || 30;
    const limit = parseInt(req.query.limit as string) || 50;

    log.info('OneDrive scrape cron triggered', { lookbackDays, limit }, LOGGER);

    const result = await scrapeOneDriveRecordings(sql, { lookbackDays, limit });

    log.info('OneDrive scrape cron complete', result, LOGGER);

    res.status(200).json({ success: true, ...result });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('OneDrive scrape cron failed', { error: errorMsg }, LOGGER);
    res.status(500).json({ success: false, error: errorMsg });
  }
}
