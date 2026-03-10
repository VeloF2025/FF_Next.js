// 🟢 WORKING: Resolve Graph user IDs to display names, emails, and FibreFlow user IDs
import { graphFetch } from './auth';
import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import type { CallRecord } from './call-records';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const sql = neon(process.env.DATABASE_URL!);

/** A Graph user resolved to their profile and optional FibreFlow identity */
export interface ResolvedParticipant {
  graphUserId: string;
  displayName: string;
  email: string;
  /** Set when the email matches a row in the FibreFlow `users` table */
  fibreflowUserId?: number;
}

/** Raw profile data cached per Graph user ID within a sync run */
interface GraphUserProfile {
  displayName: string;
  email: string;
}

/**
 * Module-level cache for Graph /users lookups.
 * Scoped to the current Node.js process — avoids redundant API calls
 * when processing multiple call records in one sync run.
 */
const userCache = new Map<string, GraphUserProfile>();

/**
 * Collects all unique Graph user IDs referenced in a call record
 * (organizer, participants, session callers/callees) and resolves each
 * to their display name, email, and optional FibreFlow user ID.
 *
 * @param callRecord - A fully expanded CallRecord (include sessions/segments for full coverage)
 * @returns Array of resolved participants — deduplicated by Graph user ID
 */
export async function resolveParticipants(
  callRecord: CallRecord
): Promise<ResolvedParticipant[]> {
  const userIds = new Set<string>();

  // Collect from organizer
  if (callRecord.organizer?.user?.id) {
    userIds.add(callRecord.organizer.user.id);
  }

  // Collect from flat participants list
  if (callRecord.participants) {
    for (const p of callRecord.participants) {
      if (p.user?.id) userIds.add(p.user.id);
    }
  }

  // Collect from session-level caller/callee pairs
  if (callRecord.sessions) {
    for (const session of callRecord.sessions) {
      if (session.caller?.user?.id) userIds.add(session.caller.user.id);
      if (session.callee?.user?.id) userIds.add(session.callee.user.id);
    }
  }

  const resolved: ResolvedParticipant[] = [];

  for (const userId of userIds) {
    let userInfo = userCache.get(userId);

    if (!userInfo) {
      try {
        const response = await graphFetch(
          `${GRAPH_BASE}/users/${userId}?$select=displayName,mail,userPrincipalName`
        );

        if (response.ok) {
          const data = await response.json();
          userInfo = {
            displayName: (data.displayName as string) || '',
            // Teams users may have mail or userPrincipalName — prefer mail
            email: ((data.mail as string) || (data.userPrincipalName as string) || '').toLowerCase(),
          };
          userCache.set(userId, userInfo);
        } else {
          log.warn(
            'Failed to resolve Graph user',
            { userId, status: response.status },
            'SpeakerResolver'
          );
          userInfo = { displayName: '', email: '' };
        }
      } catch (error: unknown) {
        log.warn(
          'Error resolving Graph user',
          { userId, error: error instanceof Error ? error.message : String(error) },
          'SpeakerResolver'
        );
        userInfo = { displayName: '', email: '' };
      }
    }

    const ffUser =
      userInfo.email ? await matchToFibreflowUser(userInfo.email) : null;

    resolved.push({
      graphUserId: userId,
      displayName: userInfo.displayName,
      email: userInfo.email,
      fibreflowUserId: ffUser?.id,
    });
  }

  return resolved;
}

/**
 * Looks up a FibreFlow user by email address (case-insensitive).
 * Returns null if no match is found.
 *
 * @param email - Lowercased email from Graph user profile
 */
async function matchToFibreflowUser(
  email: string
): Promise<{ id: number; name: string } | null> {
  const rows = await sql`
    SELECT id, CONCAT(first_name, ' ', last_name) as full_name
    FROM users
    WHERE LOWER(email) = LOWER(${email})
    LIMIT 1
  `;

  return rows[0] ? { id: rows[0].id as number, name: rows[0].full_name as string } : null;
}
