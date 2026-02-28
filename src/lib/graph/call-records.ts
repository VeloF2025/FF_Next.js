// 🟢 WORKING: Microsoft Graph API call records — fetch and paginate callRecords
import { graphFetch } from './auth';
import { log } from '@/lib/logger';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** A participant endpoint (caller or callee) within a session or segment */
export interface CallEndpoint {
  user?: {
    id: string;
    displayName: string;
  };
}

/** A single segment within a call session */
export interface CallRecordSegment {
  startDateTime: string;
  endDateTime: string;
  caller: CallEndpoint;
  callee: CallEndpoint;
}

/** A session (one-to-one leg) within a call record */
export interface CallRecordSession {
  id: string;
  caller: CallEndpoint;
  callee: CallEndpoint;
  startDateTime: string;
  endDateTime: string;
  segments: CallRecordSegment[];
}

/** Top-level call record from Microsoft Graph callRecords API */
export interface CallRecord {
  id: string;
  type: string;
  startDateTime: string;
  endDateTime: string;
  joinWebUrl?: string;
  organizer?: CallEndpoint;
  participants?: CallEndpoint[];
  sessions?: CallRecordSession[];
}

/**
 * Fetches all call records created on or after the given date.
 * Follows @odata.nextLink pagination until all pages are consumed.
 *
 * @param since - Lower bound for startDateTime filter (inclusive)
 * @returns Flat array of CallRecord objects across all pages
 */
export async function fetchRecentCallRecords(since: Date): Promise<CallRecord[]> {
  const sinceISO = since.toISOString();
  // callRecords endpoint does not support $top or $orderby — only $filter
  let url = `${GRAPH_BASE}/communications/callRecords?$filter=startDateTime ge ${sinceISO}`;

  const records: CallRecord[] = [];

  while (url) {
    const response = await graphFetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      log.error(
        'Failed to fetch call records',
        { status: response.status, error: errorText },
        'GraphCallRecords'
      );
      throw new Error(`Failed to fetch call records: ${response.status}`);
    }

    const data = await response.json();
    records.push(...((data.value as CallRecord[]) || []));

    // Graph OData pagination — empty string stops the loop
    url = (data['@odata.nextLink'] as string) || '';
  }

  log.info('Fetched call records', { count: records.length, since: sinceISO }, 'GraphCallRecords');
  return records;
}

/**
 * Fetches a single call record by ID, expanding sessions and their segments.
 * Use this to get full participant and timing details for a specific call.
 *
 * @param id - Graph callRecord ID (UUID format)
 */
export async function fetchCallRecordById(id: string): Promise<CallRecord> {
  const url = `${GRAPH_BASE}/communications/callRecords/${id}?$expand=sessions($expand=segments)`;
  const response = await graphFetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch call record ${id}: ${response.status} ${errorText}`);
  }

  return response.json() as Promise<CallRecord>;
}
