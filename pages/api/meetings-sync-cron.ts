import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { syncFirefliesToNeon } from '@/services/fireflies/firefliesService';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Cron endpoint for automated meeting sync
 * Protected by CRON_SECRET environment variable
 *
 * Usage: curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://app.fibreflow.app/api/meetings-sync-cron
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check authorization
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    log.error('cronTask', { action: 'meetings-sync', error: 'CRON_SECRET not configured' });
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    log.error('cronTask', {
      action: 'meetings-sync',
      error: 'Unauthorized cron attempt',
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const apiKey = process.env.FIREFLIES_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'FIREFLIES_API_KEY not configured' });
    }

    log.debug('cronTask', { action: 'meetings-sync', step: 'start', timestamp: new Date().toISOString() });
    const count = await syncFirefliesToNeon(apiKey, sql);
    log.debug('cronTask', { action: 'meetings-sync', step: 'complete', syncedCount: count });

    return res.status(200).json({
      success: true,
      synced: count,
      timestamp: new Date().toISOString(),
      message: `Synced ${count} meetings from Fireflies`
    });
  } catch (error: any) {
    log.error('cronTask', { action: 'meetings-sync', error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
