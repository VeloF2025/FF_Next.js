/**
 * API Route: /api/activate/trigger-qfield-sync
 * Manually trigger QFieldCloud OES sync via VPS webhook
 * Method: POST
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withRole } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { force = false } = req.body;
    log.info('TriggerQFieldSync', 'Manual sync triggered', { force });

    const response = await fetch('http://100.96.203.105:8095/sync/oes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'manual', force, timestamp: new Date().toISOString(), source: 'fibreflow-app' }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Webhook returned ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    log.info('TriggerQFieldSync', 'Sync webhook response', result);

    // Non-blocking status check after 2s
    setTimeout(async () => {
      try {
        const s = await fetch('http://100.96.203.105:8095/sync/status');
        if (s.ok) log.info('TriggerQFieldSync', 'Sync status after trigger', await s.json());
      } catch (e) { log.warn('TriggerQFieldSync', 'Could not check sync status', e); }
    }, 2000);

    return apiResponse.success(res, {
      webhook_response: result,
      details: {
        webhook_url: 'http://100.96.203.105:8095/sync/oes',
        timestamp: new Date().toISOString(),
        expected_action: 'Sync OES data from database to QFieldCloud project',
      },
    }, 'QFieldCloud sync triggered successfully');
  } catch (error) {
    log.error('TriggerQFieldSync', 'Failed to trigger sync', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('admin')(handler));
