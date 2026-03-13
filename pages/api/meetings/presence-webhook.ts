// Microsoft Graph presence change notification webhook
// Detects when users enter Teams calls and dispatches recording bots
import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { processPresenceChanges, type PresenceChange } from '@/lib/graph/presence';
import { dispatchRecordingBot } from '@/lib/recording-bot/dispatcher';

const LOGGER = 'PresenceWebhook';

interface GraphPresenceNotification {
  subscriptionId: string;
  clientState: string;
  changeType: string;
  resource: string;
  resourceData?: {
    id: string;
    availability: string;
    activity: string;
    '@odata.type': string;
  };
}

interface GraphNotificationPayload {
  value: GraphPresenceNotification[];
}

/**
 * POST /api/meetings/presence-webhook
 *
 * Receives presence change notifications from Microsoft Graph.
 * When a user enters a call, attempts to find the meeting URL and dispatch
 * a recording bot to join and record the meeting.
 *
 * Auth: Graph authenticates via clientState (GRAPH_WEBHOOK_SECRET).
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  // Graph subscription validation handshake
  const validationToken = req.query.validationToken as string | undefined;
  if (validationToken) {
    log.info('Presence webhook validation', { method: req.method }, LOGGER);
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(validationToken);
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const payload = req.body as GraphNotificationPayload | undefined;
  if (!payload?.value?.length) {
    res.status(202).end();
    return;
  }

  // Respond 202 immediately — Graph requires < 3s response
  res.status(202).end();

  const webhookSecret = process.env.GRAPH_WEBHOOK_SECRET;

  // Process asynchronously after response
  setImmediate(async () => {
    // Validate and extract presence changes
    const changes: PresenceChange[] = [];

    for (const notification of payload.value) {
      if (webhookSecret && notification.clientState !== webhookSecret) {
        log.warn('Presence notification failed clientState validation', {}, LOGGER);
        continue;
      }

      if (notification.resourceData) {
        changes.push({
          userId: notification.resourceData.id,
          availability: notification.resourceData.availability,
          activity: notification.resourceData.activity,
        });
      }
    }

    if (changes.length === 0) return;

    try {
      const result = await processPresenceChanges(changes, async (userId, joinUrl) => {
        log.info(
          'Dispatching recording bot for detected call',
          { userId: userId.substring(0, 8), joinUrl: joinUrl.substring(0, 60) },
          LOGGER
        );
        await dispatchRecordingBot(joinUrl, userId);
      });

      if (result.botsDispatched > 0 || result.callsDetected > 0) {
        log.info(
          'Presence batch processed',
          { ...result },
          LOGGER
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error('Presence processing failed', { error: msg }, LOGGER);
    }
  });
}
