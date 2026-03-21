/**
 * GET/PUT /api/communications/settings
 * GET: Returns merged notification preferences + global user communication settings.
 * PUT: Upserts per-event notification preferences AND global settings atomically.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import {
  DEFAULT_CHANNEL_PREFERENCES,
  EVENT_LABELS,
  EVENT_GROUPS,
  getRegisteredEventTypes,
} from '@/modules/notifications/constants';
import type { MergedPreference } from '@/modules/notifications/types';
import type {
  UserCommunicationSettings,
  CommunicationsSettingsResponse,
} from '@/modules/communications/types/settings.types';

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

/** GET: Return merged preferences + global settings */
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;
  try {
    const userId = authReq.user.id;

    // Fetch per-event notification preference overrides
    const overrides = await sql`
      SELECT event_type, channel_in_app, channel_email, channel_whatsapp
      FROM notification_preferences
      WHERE user_id = ${userId}::uuid
    `;

    const overrideMap = new Map(overrides.map(r => [r.event_type, r]));

    // Merge registered event types with user overrides
    const fallback = DEFAULT_CHANNEL_PREFERENCES._fallback ?? { in_app: true, email: false, whatsapp: false };
    const eventTypes = getRegisteredEventTypes();

    const preferences: MergedPreference[] = eventTypes.map(eventType => {
      const defaults = DEFAULT_CHANNEL_PREFERENCES[eventType] ?? fallback;
      const userOverride = overrideMap.get(eventType);
      return {
        event_type: eventType,
        label: EVENT_LABELS[eventType] ?? eventType,
        group: EVENT_GROUPS[eventType] ?? 'Other',
        channel_in_app: userOverride ? Boolean(userOverride.channel_in_app) : defaults.in_app,
        channel_email: userOverride ? Boolean(userOverride.channel_email) : defaults.email,
        channel_whatsapp: userOverride ? Boolean(userOverride.channel_whatsapp) : defaults.whatsapp,
        is_user_override: !!userOverride,
      };
    });

    // Fetch global settings (returns 0 or 1 rows)
    const [globalRow] = await sql`
      SELECT quiet_hours_enabled, quiet_hours_start, quiet_hours_end,
             digest_frequency, email_signature
      FROM user_communication_settings
      WHERE user_id = ${userId}::uuid
    `;

    const globalSettings: UserCommunicationSettings = {
      quiet_hours_enabled: globalRow ? Boolean(globalRow.quiet_hours_enabled) : false,
      quiet_hours_start: globalRow?.quiet_hours_start ?? '22:00',
      quiet_hours_end: globalRow?.quiet_hours_end ?? '07:00',
      digest_frequency: (globalRow?.digest_frequency as UserCommunicationSettings['digest_frequency']) ?? 'immediate',
      email_signature: globalRow?.email_signature ?? null,
    };

    const payload: CommunicationsSettingsResponse = { preferences, globalSettings };
    return apiResponse.success(res, payload);
  } catch (error) {
    log.error('communications-settings GET', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

/** PUT: Upsert per-event preferences + global settings */
async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;
  try {
    const userId = authReq.user.id;
    const { preferences, globalSettings } = req.body ?? {};

    // Validate preferences array when provided
    if (preferences !== undefined && !Array.isArray(preferences)) {
      return apiResponse.badRequest(
        res,
        'preferences must be an array of { event_type, channel_in_app, channel_email, channel_whatsapp }'
      );
    }

    // Validate globalSettings shape when provided
    if (globalSettings !== undefined && typeof globalSettings !== 'object') {
      return apiResponse.badRequest(res, 'globalSettings must be an object');
    }

    // Upsert per-event preferences
    let updatedCount = 0;
    if (Array.isArray(preferences)) {
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
        updatedCount++;
      }
    }

    // Upsert global communication settings
    if (globalSettings && typeof globalSettings === 'object') {
      const quietEnabled = !!globalSettings.quiet_hours_enabled;
      const quietStart: string = globalSettings.quiet_hours_start ?? '22:00';
      const quietEnd: string = globalSettings.quiet_hours_end ?? '07:00';
      const validFrequencies = ['immediate', 'hourly', 'daily'];
      const digestFreq: string = validFrequencies.includes(globalSettings.digest_frequency)
        ? globalSettings.digest_frequency
        : 'immediate';
      const emailSig: string | null = globalSettings.email_signature ?? null;

      await sql`
        INSERT INTO user_communication_settings (
          user_id, quiet_hours_enabled, quiet_hours_start, quiet_hours_end,
          digest_frequency, email_signature, updated_at
        ) VALUES (
          ${userId}::uuid, ${quietEnabled}, ${quietStart}, ${quietEnd},
          ${digestFreq}, ${emailSig}, NOW()
        )
        ON CONFLICT (user_id)
        DO UPDATE SET
          quiet_hours_enabled = ${quietEnabled},
          quiet_hours_start = ${quietStart},
          quiet_hours_end = ${quietEnd},
          digest_frequency = ${digestFreq},
          email_signature = ${emailSig},
          updated_at = NOW()
      `;
    }

    return apiResponse.success(res, { updated: updatedCount });
  } catch (error) {
    log.error('communications-settings PUT', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
