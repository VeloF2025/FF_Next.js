// Presence monitoring via Microsoft Graph API
// Detects when users enter/leave Teams calls for automatic recording bot dispatch
//
// Requires: Presence.Read.All application permission in Azure AD
import { graphFetch } from './auth';
import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { getInternalUsers } from './auto-recording';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const sql = neon(process.env.DATABASE_URL!);
const LOGGER = 'PresenceMonitor';

/** Presence subscription max lifetime is 60 minutes */
const PRESENCE_SUB_LIFETIME_MINUTES = 60;

/** Max users per presence subscription (Graph limit: 650) */
const MAX_USERS_PER_SUBSCRIPTION = 650;

/** Graph presence statuses that indicate a user is in a call */
const IN_CALL_ACTIVITIES = ['InACall', 'InAConferenceCall'];

export interface PresenceChange {
  userId: string;
  availability: string;
  activity: string;
}

/**
 * Creates a Graph webhook subscription for presence changes of all internal users.
 * Presence subscriptions have a max lifetime of 60 minutes — must renew frequently.
 *
 * @param notificationUrl - Public HTTPS URL for presence webhook
 */
export async function createPresenceSubscription(
  notificationUrl: string
): Promise<{ subscriptionId: string; expiresAt: string; userCount: number }> {
  const clientState = process.env.GRAPH_WEBHOOK_SECRET;
  if (!clientState) {
    throw new Error('GRAPH_WEBHOOK_SECRET required');
  }

  // Fetch all internal users to monitor
  const users = await getInternalUsers();
  const userIds = users.slice(0, MAX_USERS_PER_SUBSCRIPTION).map(u => `'${u.id}'`);

  if (userIds.length === 0) {
    throw new Error('No internal users found to monitor');
  }

  const expiresAt = new Date(Date.now() + PRESENCE_SUB_LIFETIME_MINUTES * 60 * 1000);

  const body = {
    changeType: 'updated',
    notificationUrl,
    resource: `/communications/presences?$filter=id in (${userIds.join(',')})`,
    expirationDateTime: expiresAt.toISOString(),
    clientState,
  };

  const response = await graphFetch(`${GRAPH_BASE}/subscriptions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create presence subscription: ${response.status} ${errorText}`);
  }

  const sub = await response.json();

  // Track in graph_subscriptions table
  await sql`
    INSERT INTO graph_subscriptions
      (subscription_id, resource, change_type, notification_url, expires_at, client_state, status)
    VALUES
      (${sub.id}, ${'presence'}, ${'updated'}, ${notificationUrl},
       ${expiresAt.toISOString()}, ${clientState}, 'active')
  `;

  log.info(
    'Presence subscription created',
    { subscriptionId: sub.id, users: userIds.length, expiresAt: expiresAt.toISOString() },
    LOGGER
  );

  return { subscriptionId: sub.id, expiresAt: expiresAt.toISOString(), userCount: userIds.length };
}

/**
 * Queries the current presence status for a specific user.
 * Useful for verifying call status after a webhook notification.
 */
export async function getPresence(userId: string): Promise<PresenceChange | null> {
  const response = await graphFetch(`${GRAPH_BASE}/communications/presences/${userId}`);

  if (!response.ok) {
    log.warn('Failed to fetch presence', { userId, status: response.status }, LOGGER);
    return null;
  }

  const data = await response.json();
  return {
    userId,
    availability: data.availability as string,
    activity: data.activity as string,
  };
}

/**
 * Tries to find an active online meeting for a user who is currently in a call.
 * For "Meet Now" calls, the meeting is created at call start — query by recent creation time.
 *
 * @returns The join URL if found, null otherwise
 */
export async function findActiveMeetingUrl(userId: string): Promise<string | null> {
  // Look for meetings created in the last 5 minutes (Meet Now meetings are very recent)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const url = `${GRAPH_BASE}/users/${userId}/onlineMeetings` +
    `?$orderby=createdDateTime desc&$top=5&$select=id,joinWebUrl,subject,createdDateTime`;

  const response = await graphFetch(url);

  if (!response.ok) {
    log.warn('Failed to query online meetings', { userId, status: response.status }, LOGGER);
    return null;
  }

  const data = await response.json();
  const meetings = (data.value || []) as Array<{
    id: string;
    joinWebUrl: string;
    subject: string;
    createdDateTime: string;
  }>;

  // Find the most recently created meeting — likely the active one
  for (const meeting of meetings) {
    if (meeting.joinWebUrl && meeting.createdDateTime >= fiveMinAgo) {
      log.info(
        'Found active meeting',
        { userId, meetingId: meeting.id, subject: meeting.subject },
        LOGGER
      );
      return meeting.joinWebUrl;
    }
  }

  return null;
}

/**
 * Process a batch of presence change notifications.
 * Detects users entering calls and triggers recording bot dispatch.
 *
 * @param changes - Parsed presence changes from webhook
 * @param onCallDetected - Callback when a user enters a call (for bot dispatch)
 */
export async function processPresenceChanges(
  changes: PresenceChange[],
  onCallDetected: (userId: string, joinUrl: string) => Promise<void>
): Promise<{ processed: number; callsDetected: number; botsDispatched: number }> {
  let processed = 0;
  let callsDetected = 0;
  let botsDispatched = 0;

  for (const change of changes) {
    processed++;
    const isInCall = IN_CALL_ACTIVITIES.includes(change.activity);

    // Update presence monitor table
    if (isInCall) {
      await sql`
        INSERT INTO presence_monitor (user_id, last_status, in_call_since, bot_dispatched, updated_at)
        VALUES (${change.userId}, ${change.activity}, NOW(), FALSE, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          last_status = EXCLUDED.last_status,
          in_call_since = CASE
            WHEN presence_monitor.last_status NOT IN ('InACall', 'InAConferenceCall')
            THEN NOW()
            ELSE presence_monitor.in_call_since
          END,
          updated_at = NOW()
      `;

      // Check if we already dispatched a bot for this call
      const existing = await sql`
        SELECT bot_dispatched, in_call_since
        FROM presence_monitor
        WHERE user_id = ${change.userId}
      `;

      if (existing[0] && !existing[0].bot_dispatched) {
        callsDetected++;

        // Try to find the meeting URL
        const joinUrl = await findActiveMeetingUrl(change.userId);
        if (joinUrl) {
          // Check if we already have a bot recording this meeting
          const existingBot = await sql`
            SELECT id FROM bot_recordings
            WHERE join_url = ${joinUrl}
              AND status IN ('dispatched', 'joining', 'recording')
          `;

          if (existingBot.length === 0) {
            try {
              await onCallDetected(change.userId, joinUrl);
              botsDispatched++;
              await sql`
                UPDATE presence_monitor
                SET bot_dispatched = TRUE, updated_at = NOW()
                WHERE user_id = ${change.userId}
              `;
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              log.error('Bot dispatch failed', { userId: change.userId, error: msg }, LOGGER);
            }
          }
        } else {
          log.info(
            'No meeting URL found for in-call user (likely 1:1 peer call)',
            { userId: change.userId, activity: change.activity },
            LOGGER
          );
        }
      }
    } else {
      // User left the call — reset monitoring state
      await sql`
        UPDATE presence_monitor
        SET last_status = ${change.activity},
            in_call_since = NULL,
            bot_dispatched = FALSE,
            updated_at = NOW()
        WHERE user_id = ${change.userId}
      `;
    }
  }

  return { processed, callsDetected, botsDispatched };
}
