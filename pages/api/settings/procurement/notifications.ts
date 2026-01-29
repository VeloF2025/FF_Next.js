/**
 * Procurement Notifications Settings API
 *
 * GET: Returns all notification preferences
 * PUT: Updates notification settings
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleGet(res);
  }

  if (req.method === 'PUT') {
    return handlePut(req, res);
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PUT']);
}

async function handleGet(res: NextApiResponse) {
  try {
    const notifications = await sql`
      SELECT id, event_type, label, description, enabled, channels, recipients
      FROM procurement_notifications
      ORDER BY event_type
    `;

    const result = notifications.map((n: Record<string, unknown>) => ({
      id: n.id,
      eventType: n.event_type,
      label: n.label,
      description: n.description,
      enabled: n.enabled,
      channels: n.channels,
      recipients: n.recipients,
    }));

    return apiResponse.success(res, { notifications: result });
  } catch (error) {
    log.error('Failed to fetch procurement notifications', { error });
    return apiResponse.databaseError(res, error, 'Failed to fetch notifications');
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { notifications } = req.body;

    if (!notifications || !Array.isArray(notifications)) {
      return apiResponse.badRequest(res, 'notifications array is required');
    }

    for (const notif of notifications) {
      if (!notif.id) continue;

      await sql`
        UPDATE procurement_notifications
        SET
          enabled = COALESCE(${notif.enabled ?? null}, enabled),
          channels = COALESCE(${notif.channels ? JSON.stringify(notif.channels) : null}::jsonb, channels),
          recipients = COALESCE(${notif.recipients ? JSON.stringify(notif.recipients) : null}::jsonb, recipients),
          updated_at = NOW()
        WHERE id = ${notif.id}
      `;
    }

    log.info('Procurement notifications updated', { count: notifications.length });
    return apiResponse.success(res, { message: 'Notifications updated successfully' });
  } catch (error) {
    log.error('Failed to update procurement notifications', { error });
    return apiResponse.databaseError(res, error, 'Failed to update notifications');
  }
}

export default withAuth(withErrorHandler(handler));
