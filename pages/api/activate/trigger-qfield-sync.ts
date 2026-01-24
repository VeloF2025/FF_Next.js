/**
 * API Route: /api/activate/trigger-qfield-sync
 *
 * Manually trigger QFieldCloud OES sync via VPS webhook
 * Method: POST
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { force = false } = req.body;

    log.info('TriggerQFieldSync', 'Manual sync triggered', { force });

    // Call the VPS webhook service
    const syncPayload = {
      trigger: 'manual',
      force: force,
      timestamp: new Date().toISOString(),
      source: 'fibreflow-app'
    };

    const response = await fetch('http://100.96.203.105:8095/sync/oes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(syncPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Webhook returned ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    log.info('TriggerQFieldSync', 'Sync webhook response', result);

    // Check sync status after a short delay
    setTimeout(async () => {
      try {
        const statusResponse = await fetch('http://100.96.203.105:8095/sync/status');
        if (statusResponse.ok) {
          const status = await statusResponse.json();
          log.info('TriggerQFieldSync', 'Sync status after trigger', status);
        }
      } catch (error) {
        log.warn('TriggerQFieldSync', 'Could not check sync status', error);
      }
    }, 2000);

    return res.status(200).json({
      success: true,
      message: 'QFieldCloud sync triggered successfully',
      webhook_response: result,
      details: {
        webhook_url: 'http://100.96.203.105:8095/sync/oes',
        timestamp: new Date().toISOString(),
        expected_action: 'Sync OES data from database to QFieldCloud project'
      }
    });

  } catch (error) {
    log.error('TriggerQFieldSync', 'Failed to trigger sync', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to trigger QFieldCloud sync',
      details: {
        webhook_url: 'http://100.96.203.105:8095/sync/oes',
        possible_issues: [
          'VPS sync service may be down',
          'Network connectivity issues',
          'QFieldCloud API credentials may be invalid'
        ]
      }
    });
  }
}
export default withAuth(withRole('admin')(handler));
