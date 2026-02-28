// 🟢 WORKING: Microsoft Graph change notification webhook handler
// Graph requires a < 3s response — 202 is sent immediately, processing runs in background
import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { processMeetingFromCallRecord } from '@/lib/graph/meeting-processor';

export const config = {
  api: {
    bodyParser: true,
  },
};

const LOGGER = 'GraphWebhook';

/**
 * A single change notification from Microsoft Graph.
 * Graph posts a batch of these inside a `value` array.
 */
interface GraphNotification {
  subscriptionId: string;
  clientState: string;
  changeType: string;
  resource: string;
  resourceData?: {
    id: string;
    '@odata.type': string;
  };
}

interface GraphNotificationPayload {
  value: GraphNotification[];
}

/**
 * Webhook endpoint for Microsoft Graph callRecords change notifications.
 *
 * GET/POST with ?validationToken= — Graph validation handshake (returns token as text/plain)
 *   Note: Graph sends validation as POST, not GET — must check query param on both methods.
 * POST — Receives batched change notifications; responds 202 immediately
 *        and processes each call record in the background via setImmediate.
 *
 * Auth: Graph authenticates via clientState (GRAPH_WEBHOOK_SECRET), not user sessions.
 * No withAuth wrapper — Graph cannot authenticate as a FibreFlow user.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  // -------------------------------------------------------------------------
  // Subscription validation handshake (GET or POST with validationToken)
  // Microsoft Graph sends validation as POST with ?validationToken= in query
  // -------------------------------------------------------------------------
  const validationToken = req.query.validationToken as string | undefined;

  if (validationToken) {
    log.info(
      'Graph webhook validation request received',
      { method: req.method, tokenPrefix: validationToken.slice(0, 12) + '...' },
      LOGGER
    );

    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(validationToken);
    return;
  }

  if (req.method === 'GET') {
    res.status(400).json({ error: 'Missing validationToken' });
    return;
  }

  // -------------------------------------------------------------------------
  // POST — incoming change notifications
  // -------------------------------------------------------------------------
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const payload = req.body as GraphNotificationPayload | undefined;

  if (!payload?.value?.length) {
    // Empty payload is valid — Graph may send lifecycle notifications
    res.status(202).end();
    return;
  }

  // Respond 202 immediately — Graph requires a response within 3 seconds
  res.status(202).end();

  const webhookSecret = process.env.GRAPH_WEBHOOK_SECRET;

  // Process notifications asynchronously after response is sent
  setImmediate(async () => {
    for (const notification of payload.value) {
      // Validate clientState when GRAPH_WEBHOOK_SECRET is configured
      if (webhookSecret && notification.clientState !== webhookSecret) {
        log.warn(
          'Webhook notification failed clientState validation — ignoring',
          { subscriptionId: notification.subscriptionId },
          LOGGER
        );
        continue;
      }

      const callRecordId = notification.resourceData?.id;

      if (!callRecordId) {
        log.warn(
          'Webhook notification missing resourceData.id',
          { resource: notification.resource },
          LOGGER
        );
        continue;
      }

      try {
        log.info('Processing webhook notification', { callRecordId }, LOGGER);
        const meetingId = await processMeetingFromCallRecord(callRecordId);

        if (meetingId > 0) {
          log.info('Webhook meeting processed', { callRecordId, meetingId }, LOGGER);
        }
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log.error(
          'Webhook notification processing failed',
          { callRecordId, error: errorMsg },
          LOGGER
        );
      }
    }
  });
}
