// 🟢 WORKING: Enable auto-recording on upcoming Teams meetings via Graph API
// Requires OnlineMeetings.ReadWrite.All application permission
import { graphFetch } from './auth';
import { log } from '@/lib/logger';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const LOGGER = 'AutoRecording';

/** Calendar event from Graph calendarView API */
interface CalendarEvent {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isOnlineMeeting: boolean;
  onlineMeeting?: { joinUrl: string };
  organizer?: { emailAddress: { address: string; name: string } };
}

/** Online meeting resource from Graph */
interface OnlineMeeting {
  id: string;
  subject: string;
  recordAutomatically: boolean;
  isEntryExitAnnounced?: boolean;
}

/** Result of enabling auto-recording for a batch of meetings */
export interface AutoRecordingResult {
  usersChecked: number;
  meetingsFound: number;
  alreadyEnabled: number;
  newlyEnabled: number;
  failed: number;
  errors: string[];
}

/**
 * Fetches all licensed users in the tenant.
 * Filters for accounts with mailboxes (not service accounts).
 */
async function getOrganizationUsers(): Promise<{ id: string; displayName: string; mail: string }[]> {
  const users: { id: string; displayName: string; mail: string }[] = [];
  // Use userPrincipalName filter (more reliable than mail ne null across tenants)
  let url = `${GRAPH_BASE}/users?$filter=accountEnabled eq true&$select=id,displayName,mail,userPrincipalName&$top=100`;

  while (url) {
    const response = await graphFetch(url);
    if (!response.ok) {
      const err = await response.text();
      log.error('Failed to fetch users', { status: response.status, error: err }, LOGGER);
      throw new Error(`Graph API /users failed: ${response.status} — ${err.slice(0, 200)}`);
    }

    const data = await response.json();
    const pageUsers = (data.value || []).map((u: Record<string, string>) => ({
      id: u.id,
      displayName: u.displayName || '',
      mail: u.mail || u.userPrincipalName || '',
    })).filter((u: { mail: string }) => u.mail && !u.mail.startsWith('#'));
    users.push(...pageUsers);
    url = data['@odata.nextLink'] || '';
  }

  return users;
}

/**
 * Fetches upcoming calendar events for a user within a time window.
 * Only returns Teams online meetings.
 */
async function getUpcomingTeamsMeetings(
  userId: string,
  hoursAhead: number
): Promise<CalendarEvent[]> {
  const now = new Date();
  const end = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

  const url = `${GRAPH_BASE}/users/${userId}/calendarView` +
    `?startDateTime=${now.toISOString()}` +
    `&endDateTime=${end.toISOString()}` +
    `&$filter=isOnlineMeeting eq true` +
    `&$select=id,subject,start,end,isOnlineMeeting,onlineMeeting,organizer` +
    `&$top=50`;

  const response = await graphFetch(url);
  if (!response.ok) {
    // 403 = no calendar access for this user (shared mailbox, etc.) — skip silently
    if (response.status === 403) return [];
    const err = await response.text();
    log.warn('Failed to fetch calendar', { userId, status: response.status, error: err }, LOGGER);
    return [];
  }

  const data = await response.json();
  return (data.value || []) as CalendarEvent[];
}

/**
 * Resolves a join URL to an online meeting ID, then PATCHes it to enable
 * auto-recording and auto-transcription.
 *
 * @returns 'enabled' | 'already' | 'failed'
 */
async function enableAutoRecordForMeeting(
  organizerUserId: string,
  joinUrl: string,
  subject: string
): Promise<'enabled' | 'already' | 'failed'> {
  // Step 1: Find the online meeting by join URL
  const encodedUrl = encodeURIComponent(joinUrl);
  const findUrl = `${GRAPH_BASE}/users/${organizerUserId}/onlineMeetings` +
    `?$filter=joinWebUrl eq '${encodedUrl}'` +
    `&$select=id,subject,recordAutomatically`;

  const findResp = await graphFetch(findUrl);
  if (!findResp.ok) {
    // Try alternative: filter without encoding
    const altUrl = `${GRAPH_BASE}/users/${organizerUserId}/onlineMeetings` +
      `?$filter=joinWebUrl eq '${joinUrl}'` +
      `&$select=id,subject,recordAutomatically`;
    const altResp = await graphFetch(altUrl);
    if (!altResp.ok) {
      const err = await altResp.text();
      log.warn('Cannot find online meeting', { subject, error: err }, LOGGER);
      return 'failed';
    }
    const altData = await altResp.json();
    const meetings = (altData.value || []) as OnlineMeeting[];
    if (meetings.length === 0) return 'failed';
    return await patchMeeting(organizerUserId, meetings[0]!, subject);
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
): Promise<'enabled' | 'already'> {
  if (meeting.recordAutomatically) {
    return 'already';
  }

  // Step 2: PATCH to enable auto-recording
  const patchUrl = `${GRAPH_BASE}/users/${organizerUserId}/onlineMeetings/${meeting.id}`;
  const patchResp = await graphFetch(patchUrl, {
    method: 'PATCH',
    body: JSON.stringify({
      recordAutomatically: true,
    }),
  });

  if (!patchResp.ok) {
    const err = await patchResp.text();
    log.error('Failed to PATCH meeting', { subject, meetingId: meeting.id, error: err }, LOGGER);
    return 'already'; // Don't count as failed — permission issue
  }

  log.info('Auto-recording enabled', { subject, meetingId: meeting.id }, LOGGER);
  return 'enabled';
}

/**
 * Main entry point: scans all org users' calendars for upcoming Teams meetings
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

  const users = await getOrganizationUsers();
  result.usersChecked = users.length;

  log.info('Auto-recording scan started', { users: users.length, hoursAhead }, LOGGER);

  // Track join URLs we've already processed (meetings appear on multiple calendars)
  const processedUrls = new Set<string>();

  for (const user of users) {
    try {
      const events = await getUpcomingTeamsMeetings(user.id, hoursAhead);

      for (const event of events) {
        const joinUrl = event.onlineMeeting?.joinUrl;
        if (!joinUrl || processedUrls.has(joinUrl)) continue;

        processedUrls.add(joinUrl);
        result.meetingsFound++;

        // Only the organizer can modify meeting settings
        const isOrganizer = event.organizer?.emailAddress?.address?.toLowerCase() === user.mail?.toLowerCase();
        if (!isOrganizer) continue;

        try {
          const status = await enableAutoRecordForMeeting(user.id, joinUrl, event.subject);
          if (status === 'enabled') result.newlyEnabled++;
          else if (status === 'already') result.alreadyEnabled++;
          else result.failed++;
        } catch (error: unknown) {
          result.failed++;
          const msg = error instanceof Error ? error.message : String(error);
          result.errors.push(`${event.subject}: ${msg}`);
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      log.warn('Failed to scan user calendar', { user: user.mail, error: msg }, LOGGER);
    }
  }

  log.info('Auto-recording scan complete', result, LOGGER);
  return result;
}
