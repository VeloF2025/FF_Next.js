// 🟢 WORKING: Enable auto-recording on upcoming Teams meetings via Graph API
// Requires: Calendars.Read + OnlineMeetings.ReadWrite.All application permissions
// Also requires Teams Application Access Policy (PowerShell)
import { graphFetch } from './auth';
import { log } from '@/lib/logger';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const LOGGER = 'AutoRecording';

// Only scan calendars for users in these email domains
const INTERNAL_DOMAINS = ['velocityfibre.co.za', 'blitzfibre.com'];

/** Calendar event from Graph calendarView API */
interface CalendarEvent {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isOnlineMeeting: boolean;
  isCancelled?: boolean;
  onlineMeeting?: { joinUrl: string };
  organizer?: { emailAddress: { address: string; name: string } };
}

/** Online meeting resource from Graph */
interface OnlineMeeting {
  id: string;
  subject: string;
  recordAutomatically: boolean;
}

/** Result of enabling auto-recording for a batch of meetings */
export interface AutoRecordingResult {
  usersChecked: number;
  meetingsFound: number;
  alreadyEnabled: number;
  newlyEnabled: number;
  failed: number;
  errors: string[];
  calendarAccessDenied?: boolean;
  meetingAccessDenied?: boolean;
}

/**
 * Fetches internal users in the tenant (VelocityFibre/BlitzFibre domains only).
 * Skips external/guest accounts (#EXT#) and service accounts.
 */
export async function getInternalUsers(): Promise<{ id: string; displayName: string; mail: string }[]> {
  const users: { id: string; displayName: string; mail: string }[] = [];
  let url = `${GRAPH_BASE}/users?$filter=accountEnabled eq true&$select=id,displayName,mail,userPrincipalName&$top=100`;

  while (url) {
    const response = await graphFetch(url);
    if (!response.ok) {
      const err = await response.text();
      log.error('Failed to fetch users', { status: response.status, error: err }, LOGGER);
      throw new Error(`Graph API /users failed: ${response.status} — ${err.slice(0, 200)}`);
    }

    const data = await response.json();
    const pageUsers = (data.value || [])
      .map((u: Record<string, string>) => ({
        id: u.id,
        displayName: u.displayName || '',
        mail: u.mail || u.userPrincipalName || '',
        upn: u.userPrincipalName || '',
      }))
      .filter((u: { mail: string; upn: string }) => {
        // Skip external/guest users
        if (u.upn.includes('#EXT#')) return false;
        // Only keep internal domain users
        const domain = u.mail.split('@')[1]?.toLowerCase();
        return domain && INTERNAL_DOMAINS.includes(domain);
      })
      .map((u: { id: string; displayName: string; mail: string }) => ({
        id: u.id,
        displayName: u.displayName,
        mail: u.mail,
      }));

    users.push(...pageUsers);
    url = data['@odata.nextLink'] || '';
  }

  return users;
}

/**
 * Fetches upcoming calendar events for a user within a time window.
 * Only returns Teams online meetings.
 *
 * @returns events array, or null if calendar access is denied (missing Calendars.Read)
 */
async function getUpcomingTeamsMeetings(
  userId: string,
  hoursAhead: number
): Promise<CalendarEvent[] | null> {
  const now = new Date();
  const end = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

  // Note: isOnlineMeeting does not support $filter — filter client-side
  const url = `${GRAPH_BASE}/users/${userId}/calendarView` +
    `?startDateTime=${now.toISOString()}` +
    `&endDateTime=${end.toISOString()}` +
    `&$select=id,subject,start,end,isOnlineMeeting,isCancelled,onlineMeeting,organizer` +
    `&$top=50`;

  const response = await graphFetch(url);
  if (!response.ok) {
    const err = await response.text();
    // 403 = Access Denied — missing Calendars.Read permission
    if (response.status === 403) return null;
    // 404 = Mailbox not found (shared/inactive mailbox) — skip user
    if (response.status === 404) return [];
    log.warn('Failed to fetch calendar', { userId, status: response.status, error: err }, LOGGER);
    return [];
  }

  const data = await response.json();
  // Client-side filter: only active Teams online meetings with a join URL
  return ((data.value || []) as CalendarEvent[]).filter(
    e => e.isOnlineMeeting && e.onlineMeeting?.joinUrl && !e.isCancelled
  );
}

/**
 * Resolves a join URL to an online meeting ID, then PATCHes it to enable
 * auto-recording.
 *
 * @returns 'enabled' | 'already' | 'failed' | 'access_denied'
 */
async function enableAutoRecordForMeeting(
  organizerUserId: string,
  joinUrl: string,
  subject: string
): Promise<'enabled' | 'already' | 'failed' | 'access_denied'> {
  // encodeURIComponent the $filter value (NOT the $filter key — $ must stay literal)
  // Join URLs contain %3a etc. that corrupt query strings if embedded raw
  const filterValue = encodeURIComponent(`JoinWebUrl eq '${joinUrl}'`);
  const findUrl = `${GRAPH_BASE}/users/${organizerUserId}/onlineMeetings?$filter=${filterValue}`;

  const findResp = await graphFetch(findUrl);
  if (findResp.status === 403) {
    log.warn('OnlineMeetings access denied — application access policy required', { subject }, LOGGER);
    return 'access_denied';
  }
  if (!findResp.ok) {
    const err = await findResp.text();
    log.warn('Cannot find online meeting', { subject, status: findResp.status, error: err.slice(0, 200) }, LOGGER);
    return 'failed';
  }

  const data = await findResp.json();
  const meetings = (data.value || []) as OnlineMeeting[];
  if (meetings.length === 0) {
    log.warn('Online meeting not found for join URL', { subject }, LOGGER);
    return 'failed';
  }

  return await patchMeeting(organizerUserId, meetings[0]!, subject);
}

async function patchMeeting(
  organizerUserId: string,
  meeting: OnlineMeeting,
  subject: string
): Promise<'enabled' | 'already' | 'access_denied'> {
  if (meeting.recordAutomatically) {
    return 'already';
  }

  const patchUrl = `${GRAPH_BASE}/users/${organizerUserId}/onlineMeetings/${meeting.id}`;
  const patchResp = await graphFetch(patchUrl, {
    method: 'PATCH',
    body: JSON.stringify({ recordAutomatically: true }),
  });

  if (patchResp.status === 403) {
    log.warn('PATCH denied — application access policy required', { subject, meetingId: meeting.id }, LOGGER);
    return 'access_denied';
  }

  if (!patchResp.ok) {
    const err = await patchResp.text();
    log.error('Failed to PATCH meeting', { subject, meetingId: meeting.id, error: err }, LOGGER);
    return 'already'; // Don't count as failed — unknown permission issue
  }

  log.info('Auto-recording enabled', { subject, meetingId: meeting.id }, LOGGER);
  return 'enabled';
}

/**
 * Main entry point: scans internal users' calendars for upcoming Teams meetings
 * and enables auto-recording on each one.
 *
 * @param hoursAhead - How far ahead to look for meetings (default: 24)
 */
export async function enableAutoRecordingForUpcomingMeetings(
  hoursAhead = 24
): Promise<AutoRecordingResult> {
  const result: AutoRecordingResult = {
    usersChecked: 0,
    meetingsFound: 0,
    alreadyEnabled: 0,
    newlyEnabled: 0,
    failed: 0,
    errors: [],
  };

  const users = await getInternalUsers();
  result.usersChecked = users.length;

  log.info('Auto-recording scan started', { users: users.length, hoursAhead }, LOGGER);

  // Fast-fail: check calendar access on first user
  if (users.length > 0) {
    const testEvents = await getUpcomingTeamsMeetings(users[0]!.id, hoursAhead);
    if (testEvents === null) {
      result.calendarAccessDenied = true;
      result.errors.push(
        'Calendar access denied (403). Add Calendars.Read application permission ' +
        'in Azure AD → API permissions → Grant admin consent.'
      );
      log.error('Calendar access denied — Calendars.Read permission missing', {}, LOGGER);
      return result;
    }
  }

  // Track meetings: seenUrls for counting, processedUrls for organizer-processed
  const seenUrls = new Set<string>();
  const processedUrls = new Set<string>();

  for (const user of users) {
    try {
      const events = await getUpcomingTeamsMeetings(user.id, hoursAhead);
      if (events === null) continue; // Skip users with no calendar access

      for (const event of events) {
        const joinUrl = event.onlineMeeting?.joinUrl;
        if (!joinUrl) continue;

        // Count each unique meeting once
        if (!seenUrls.has(joinUrl)) {
          seenUrls.add(joinUrl);
          result.meetingsFound++;
        }

        // Skip if already processed by the organizer
        if (processedUrls.has(joinUrl)) continue;

        // Only the organizer can modify meeting settings
        const isOrganizer = event.organizer?.emailAddress?.address?.toLowerCase() === user.mail?.toLowerCase();
        if (!isOrganizer) continue;

        processedUrls.add(joinUrl);

        try {
          const status = await enableAutoRecordForMeeting(user.id, joinUrl, event.subject);
          if (status === 'enabled') result.newlyEnabled++;
          else if (status === 'already') result.alreadyEnabled++;
          else if (status === 'access_denied') {
            result.meetingAccessDenied = true;
            result.failed++;
            result.errors.push(
              `${event.subject}: OnlineMeetings access denied. ` +
              'Create a Teams Application Access Policy via PowerShell.'
            );
            break;
          } else {
            result.failed++;
          }
        } catch (error: unknown) {
          result.failed++;
          const msg = error instanceof Error ? error.message : String(error);
          result.errors.push(`${event.subject}: ${msg}`);
        }
      }

      if (result.meetingAccessDenied) break;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      log.warn('Failed to scan user calendar', { user: user.mail, error: msg }, LOGGER);
    }
  }

  log.info('Auto-recording scan complete', result, LOGGER);
  return result;
}
