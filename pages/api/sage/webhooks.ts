/**
 * Sage Webhook Handler
 *
 * POST - Receive webhook notifications from Sage
 *
 * Handles events like:
 * - Supplier invoice created/updated
 * - Supplier payment created
 * - Supplier updated
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';

const logger = createLogger({ module: 'api:sage:webhooks' });

interface SageWebhookPayload {
  event_type: string;
  resource_type: string;
  resource_id: string;
  company_id: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, ['POST']);
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    const payload = req.body as SageWebhookPayload;

    logger.info('Sage webhook received', {
      eventType: payload.event_type,
      resourceType: payload.resource_type,
      resourceId: payload.resource_id,
    });

    // Log the webhook to sync history
    await sql`
      INSERT INTO sage_sync_history (
        operation_type,
        direction,
        entity_type,
        entity_id,
        status,
        details
      ) VALUES (
        'webhook',
        'inbound',
        ${payload.resource_type || 'unknown'},
        ${payload.resource_id || null},
        'received',
        ${JSON.stringify(payload)}
      )
    `;

    // Queue for processing based on event type
    const eventType = payload.event_type?.toLowerCase() || '';
    const resourceType = payload.resource_type?.toLowerCase() || '';

    if (resourceType === 'supplier_invoice' || eventType.includes('invoice')) {
      // Queue invoice sync
      await sql`
        INSERT INTO sage_sync_queue (
          entity_type,
          entity_id,
          operation,
          priority,
          payload
        ) VALUES (
          'supplier_invoice',
          ${payload.resource_id},
          'pull',
          1,
          ${JSON.stringify(payload)}
        )
        ON CONFLICT (entity_type, entity_id, operation)
        WHERE status = 'pending'
        DO UPDATE SET
          payload = ${JSON.stringify(payload)},
          updated_at = NOW()
      `;

      logger.info('Queued invoice sync from webhook', { invoiceId: payload.resource_id });
    }

    if (resourceType === 'supplier_payment' || eventType.includes('payment')) {
      // Queue payment sync
      await sql`
        INSERT INTO sage_sync_queue (
          entity_type,
          entity_id,
          operation,
          priority,
          payload
        ) VALUES (
          'supplier_payment',
          ${payload.resource_id},
          'pull',
          1,
          ${JSON.stringify(payload)}
        )
        ON CONFLICT (entity_type, entity_id, operation)
        WHERE status = 'pending'
        DO UPDATE SET
          payload = ${JSON.stringify(payload)},
          updated_at = NOW()
      `;

      logger.info('Queued payment sync from webhook', { paymentId: payload.resource_id });
    }

    if (resourceType === 'supplier' || eventType.includes('supplier')) {
      // Queue supplier sync
      await sql`
        INSERT INTO sage_sync_queue (
          entity_type,
          entity_id,
          operation,
          priority,
          payload
        ) VALUES (
          'supplier',
          ${payload.resource_id},
          'pull',
          2,
          ${JSON.stringify(payload)}
        )
        ON CONFLICT (entity_type, entity_id, operation)
        WHERE status = 'pending'
        DO UPDATE SET
          payload = ${JSON.stringify(payload)},
          updated_at = NOW()
      `;

      logger.info('Queued supplier sync from webhook', { supplierId: payload.resource_id });
    }

    // Acknowledge receipt
    return apiResponse.success(res, {
      received: true,
      event_type: payload.event_type,
      resource_id: payload.resource_id,
    });
  } catch (error) {
    logger.error('Sage webhook processing error', { error });

    // Still return 200 to prevent Sage from retrying
    // Log the error for investigation
    try {
      await sql`
        INSERT INTO sage_sync_history (
          operation_type,
          direction,
          status,
          error_message,
          details
        ) VALUES (
          'webhook',
          'inbound',
          'failed',
          ${error instanceof Error ? error.message : 'Unknown error'},
          ${JSON.stringify({ body: req.body, error: String(error) })}
        )
      `;
    } catch (logError) {
      logger.error('Failed to log webhook error', { error: logError });
    }

    return apiResponse.success(res, { received: true, error: 'Processing failed' });
  }
}

export default withAuth(handler);
