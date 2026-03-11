/**
 * GET/PUT /api/notifications/preferences
 * GET: Returns user preferences merged with system defaults.
 * PUT: Upserts user notification preferences.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import {
  DEFAULT_CHANNEL_PREFERENCES,
  EVENT_LABELS,
  EVENT_GROUPS,
  getRegisteredEventTypes,
} from '@/modules/notifications/constants';
import type { MergedPreference } from '@/modules/notifications/types';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  }
  if (req.method === 'PUT') {
    return handlePut(req, res);
  }
  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PUT']);
}

/** GET: Return all event types with user overrides merged in */
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;

  try {
    const userId = authReq.user.id;

    // Fetch user overrides
    const overrides = await sql`
      SELECT event_type, channel_in_app, channel_email, channel_whatsapp
      FROM notification_preferences
      WHERE user_id = ${userId}::uuid
    `;

    const overrideMap = new Map(
      overrides.map(r => [r.event_type, r])
    );

    // Merge with system defaults
    const eventTypes = getRegisteredEventTypes();
    const fallback = DEFAULT_CHANNEL_PREFERENCES._fallback || { in_app: true, email: false, whatsapp: false };

    const merged: MergedPreference[] = eventTypes.map(eventType => {
      const defaults = DEFAULT_CHANNEL_PREFERENCES[eventType] || fallback;
      const userOverride = overrideMap.get(eventType);

      return {
        event_type: eventType,
        label: EVENT_LABELS[eventType] || eventType,
        group: EVENT_GROUPS[eventType] || 'Other',
        channel_in_app: userOverride ? userOverride.channel_in_app : defaults.in_app,
        channel_email: userOverride ? userOverride.channel_email : defaults.email,
        channel_whatsapp: userOverride ? userOverride.channel_whatsapp : defaults.whatsapp,
        is_user_override: !!userOverride,
      };
    });

    return apiResponse.success(res, merged);
  } catch (error) {
    log.error('PreferencesApi', 'Internal error', { error });
    return apiResponse.internalError(res, error);
  }
}

/** PUT: Upsert user preferences */
async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;

  try {
    const userId = authReq.user.id;
    const { preferences } = req.body || {};

    if (!Array.isArray(preferences)) {
      return apiResponse.badRequest(res, 'preferences must be an array of { event_type, channel_in_app, channel_email, channel_whatsapp }');
    }

    for (const pref of preferences) {
      if (!pref.event_type || typeof pref.event_type !== 'string') {
        continue;
      }

      await sql`
        INSERT INTO notification_preferences (
          user_id, event_type, channel_in_app, channel_email, channel_whatsapp, updated_at
        ) VALUES (
          ${userId}::uuid, ${pref.event_type},
          ${!!pref.channel_in_app}, ${!!pref.channel_email}, ${!!pref.channel_whatsapp},
          NOW()
        )
        ON CONFLICT (user_id, event_type)
        DO UPDATE SET
          channel_in_app = ${!!pref.channel_in_app},
          channel_email = ${!!pref.channel_email},
          channel_whatsapp = ${!!pref.channel_whatsapp},
          updated_at = NOW()
      `;
    }

    return apiResponse.success(res, { updated: preferences.length });
  } catch (error) {
    log.error('PreferencesApi', 'Operation failed', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
