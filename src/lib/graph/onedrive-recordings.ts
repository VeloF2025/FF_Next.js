// 🟢 WORKING: Scrape Teams meeting recordings from users' OneDrive /Recordings/ folders
import { graphFetch } from './auth';
import { log } from '@/lib/logger';
import { getInternalUsers } from './auto-recording';
import { processWithLLM } from '@/lib/llm/meeting-processor';
import * as fs from 'fs';
import * as path from 'path';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const LOGGER = 'OneDriveRecordings';

const RECORDINGS_BASE =
  process.env.MEETING_RECORDINGS_PATH || '/home/velo/meeting-recordings';

/** OneDrive driveItem representing a recording file */
interface DriveItem {
  id: string;
  name: string;
  size: number;
  createdDateTime: string;
  lastModifiedDateTime: string;
  createdBy?: {
    user?: { id?: string; displayName?: string; email?: string };
  };
  '@microsoft.graph.downloadUrl'?: string;
}

/** Result of a single scrape run */
export interface OneDriveScrapeResult {
  usersScanned: number;
  recordingsFound: number;
  newDownloads: number;
  alreadyProcessed: number;
  matched: number;
  created: number;
  enriched: number;
  failed: number;
  errors: string[];
}

/** Row returned by "SELECT id FROM meetings WHERE onedrive_item_id = ..." */
interface MeetingIdRow { id: number }

/** Row returned by "SELECT id, title, recording_path FROM meetings ..." */
interface MeetingMatchRow { id: number; title: string; recording_path: string | null }

/** Row returned by "INSERT INTO meetings ... RETURNING id" */
interface MeetingInsertRow { id: number }

/** Row returned by "SELECT processing_status FROM meetings WHERE id = ..." */
interface MeetingStatusRow { processing_status: string }

/**
 * Lists all .mp4 files in a user's OneDrive /Recordings/ folder.
 * Returns empty array if folder doesn't exist or access is denied.
 */
export async function listUserRecordings(userId: string): Promise<DriveItem[]> {
  // Step 1: Find the Recordings folder ID from root children.
  // The path-based API (root:/Recordings:/children) returns 400 on this tenant —
  // using the folder item ID directly is more reliable.
  const rootUrl = `${GRAPH_BASE}/users/${userId}/drive/root/children?$select=id,name,folder&$top=200`;
  const rootResp = await graphFetch(rootUrl);

  if (rootResp.status === 403) {
    log.warn('OneDrive access denied', { userId }, LOGGER);
    return [];
  }
  if (!rootResp.ok) {
    log.warn('OneDrive root listing failed', { userId, status: rootResp.status }, LOGGER);
    return [];
  }

  const rootData = await rootResp.json();
  const recordingsFolder = (rootData.value || []).find(
    (item: { name: string; folder?: object }) => item.name === 'Recordings' && item.folder
  ) as { id: string } | undefined;

  if (!recordingsFolder) return []; // No Recordings folder

  // Step 2: List the folder contents by item ID (avoids path-based 400 error).
  const url =
    `${GRAPH_BASE}/users/${userId}/drive/items/${recordingsFolder.id}/children` +
    `?$select=id,name,size,createdDateTime,lastModifiedDateTime,createdBy` +
    `&$top=200`;

  const response = await graphFetch(url);

  if (!response.ok) {
    log.warn('OneDrive Recordings folder listing failed', { userId, status: response.status }, LOGGER);
    return [];
  }

  const data = await response.json();
  const items = (data.value || []) as DriveItem[];

  // Only MP4 files with content — size=0 means Teams hasn't finished processing yet
  return items
    .filter((item) => item.name.toLowerCase().endsWith('.mp4') && item.size > 0)
    .sort((a, b) => b.createdDateTime.localeCompare(a.createdDateTime));
}

/**
 * Downloads a file from OneDrive to local disk.
 * Uses the @microsoft.graph.downloadUrl for direct download (no auth needed on that URL).
 * Falls back to /content endpoint if download URL is not present.
 */
export async function downloadDriveItem(
  userId: string,
  itemId: string,
  destPath: string
): Promise<number> {
  // Get the item with download URL
  const metaUrl = `${GRAPH_BASE}/users/${userId}/drive/items/${itemId}?$select=id,@microsoft.graph.downloadUrl`;
  const metaResp = await graphFetch(metaUrl);

  if (!metaResp.ok) {
    throw new Error(`Failed to get download URL: ${metaResp.status}`);
  }

  const meta = await metaResp.json();
  const downloadUrl =
    meta['@microsoft.graph.downloadUrl'] ||
    `${GRAPH_BASE}/users/${userId}/drive/items/${itemId}/content`;

  // Download — use direct URL if available (faster, no auth needed)
  const isDirectUrl = !!meta['@microsoft.graph.downloadUrl'];
  const response = isDirectUrl
    ? await fetch(downloadUrl)
    : await graphFetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(destPath, buffer);

  return buffer.length;
}

/**
 * Parse a Teams recording filename to extract title and approximate date.
 * Format: "Meeting Title-YYYYMMDD_HHMMSS-Meeting Recording.mp4"
 * Also handles: "Meeting Title (YYYY-MM-DD HH_MM_SS).mp4"
 */
export function parseRecordingFilename(name: string): { title: string; date: Date | null } {
  // Pattern 1: "Title-20260313_100000-Meeting Recording.mp4"
  const m1 = name.match(/^(.+?)-(\d{8})_(\d{6})-Meeting Recording\.mp4$/i);
  if (m1) {
    const title = m1[1]!.trim();
    const ds = m1[2]!;
    const ts = m1[3]!;
    const date = new Date(
      `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}T${ts.slice(0, 2)}:${ts.slice(2, 4)}:${ts.slice(4, 6)}Z`
    );
    return { title, date: isNaN(date.getTime()) ? null : date };
  }

  // Pattern 2: fallback — just use filename without extension
  const title = name.replace(/\.mp4$/i, '').replace(/-Meeting Recording$/i, '').trim();
  return { title, date: null };
}

/**
 * Main entry point: scans all internal users' OneDrive Recordings folders,
 * downloads new recordings, matches to existing meetings or creates new ones,
 * and triggers LLM enrichment.
 */
export async function scrapeOneDriveRecordings(
  sql: ReturnType<typeof import('@neondatabase/serverless').neon>,
  options: { lookbackDays?: number; limit?: number } = {}
): Promise<OneDriveScrapeResult> {
  const { lookbackDays = 30, limit = 50 } = options;
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const result: OneDriveScrapeResult = {
    usersScanned: 0,
    recordingsFound: 0,
    newDownloads: 0,
    alreadyProcessed: 0,
    matched: 0,
    created: 0,
    enriched: 0,
    failed: 0,
    errors: [],
  };

  const users = await getInternalUsers();
  result.usersScanned = users.length;
  log.info('OneDrive scrape started', { users: users.length, lookbackDays, limit }, LOGGER);

  let totalProcessed = 0;

  for (const user of users) {
    if (totalProcessed >= limit) break;

    try {
      const recordings = await listUserRecordings(user.id);
      if (recordings.length === 0) continue;

      log.info('User recordings found', { user: user.mail, count: recordings.length }, LOGGER);

      for (const item of recordings) {
        if (totalProcessed >= limit) break;

        // Skip old recordings
        const itemDate = new Date(item.createdDateTime);
        if (itemDate < cutoff) continue;

        result.recordingsFound++;

        // Check if already scraped
        const existing = await sql`
          SELECT id FROM meetings WHERE onedrive_item_id = ${item.id}
        ` as MeetingIdRow[];
        if (existing.length > 0) {
          result.alreadyProcessed++;
          continue;
        }

        try {
          const parsed = parseRecordingFilename(item.name);
          const recordingDate = parsed.date || itemDate;

          // Match window: recording start time (createdDateTime/filename, UTC) vs meeting start (UTC).
          // 2h absorbs skew between a meeting's scheduled start and when recording began — including
          // the itemDate fallback used when the filename carries no timestamp. (Previously 4h — a
          // stale workaround for a since-fixed SAST/UTC parsing bug; that width let a recording match
          // a meeting hours away. The ownership filter below, not the window, is the real guard.)
          const windowMs = 2 * 60 * 60 * 1000;
          const dateStart = new Date(recordingDate.getTime() - windowMs).toISOString();
          const dateEnd = new Date(recordingDate.getTime() + windowMs).toISOString();

          // Only attach to a meeting the recording's OneDrive owner actually took part in
          // (organizer or listed participant). Teams saves a recording to the recorder's OneDrive,
          // so the owner is always in the meeting. Without this guard the scraper attached a
          // recording to whichever recording-less teams row happened to be closest in time —
          // even an unrelated concurrent meeting owned by someone else. Incident 2026-07-02: a
          // board-meeting recording in Lew's OneDrive was stolen by a different organizer's meeting
          // because the real meeting row had not been created by the webhook yet.
          // Match the participant email EXACTLY against each JSONB array element — a substring LIKE
          // over participants::text would false-match a longer address (e.g. owner "a@x" inside
          // "za@x") and an empty owner would collapse to LIKE '%%' (match everything).
          const owner = (user.mail || '').toLowerCase();
          if (!owner) continue; // defensive: internal users always have mail; skip if somehow absent rather than run an unowned match
          const matchRows = await sql`
            SELECT id, title, recording_path
            FROM meetings
            WHERE source = 'teams'
              AND meeting_date >= ${dateStart}
              AND meeting_date <= ${dateEnd}
              AND recording_path IS NULL
              AND onedrive_item_id IS NULL
              AND (
                lower(organizer_email) = ${owner}
                OR (
                  jsonb_typeof(participants) = 'array'
                  AND EXISTS (
                    SELECT 1 FROM jsonb_array_elements(participants) AS p
                    WHERE lower(p->>'email') = ${owner}
                  )
                )
              )
            ORDER BY ABS(EXTRACT(EPOCH FROM (meeting_date - ${recordingDate.toISOString()}::timestamptz)))
            LIMIT 1
          ` as MeetingMatchRow[];

          let meetingId: number;

          if (matchRows.length > 0) {
            // Match to existing meeting
            meetingId = matchRows[0]!.id;
            result.matched++;
            log.info('Matched to existing meeting', {
              meetingId,
              title: matchRows[0]!.title,
              recording: item.name,
            }, LOGGER);
          } else {
            // Create new meeting entry
            const title = parsed.title || `Teams Recording - ${recordingDate.toLocaleDateString('en-ZA')}`;
            const newRows = await sql`
              INSERT INTO meetings (
                title, meeting_date, source, onedrive_item_id,
                organizer_email, organizer_name,
                processing_status, created_at, updated_at
              ) VALUES (
                ${title}, ${recordingDate.toISOString()}, 'teams', ${item.id},
                ${user.mail}, ${user.displayName},
                'fetching', NOW(), NOW()
              )
              RETURNING id
            ` as MeetingInsertRow[];
            meetingId = newRows[0]!.id;
            result.created++;
            log.info('Created meeting from OneDrive recording', {
              meetingId, title, recording: item.name,
            }, LOGGER);
          }

          // Download recording to disk
          const year = recordingDate.getFullYear().toString();
          const month = String(recordingDate.getMonth() + 1).padStart(2, '0');
          const filePath = path.join(RECORDINGS_BASE, year, month, `${meetingId}.mp4`);

          if (!fs.existsSync(filePath)) {
            const sizeBytes = await downloadDriveItem(user.id, item.id, filePath);
            await sql`
              UPDATE meetings
              SET recording_path = ${filePath},
                  recording_size_bytes = ${sizeBytes},
                  onedrive_item_id = ${item.id},
                  updated_at = NOW()
              WHERE id = ${meetingId}
            `;
            result.newDownloads++;
            log.info('Recording downloaded', {
              meetingId, filePath, sizeMB: (sizeBytes / 1024 / 1024).toFixed(1),
            }, LOGGER);
          } else {
            // File already on disk, just update the tracking
            const stats = fs.statSync(filePath);
            await sql`
              UPDATE meetings
              SET recording_path = ${filePath},
                  recording_size_bytes = ${stats.size},
                  onedrive_item_id = ${item.id},
                  updated_at = NOW()
              WHERE id = ${meetingId}
            `;
          }

          // Run LLM enrichment if not already done
          const meetingRow = await sql`
            SELECT processing_status FROM meetings WHERE id = ${meetingId}
          ` as MeetingStatusRow[];
          if (meetingRow[0]?.processing_status !== 'completed') {
            try {
              await sql`UPDATE meetings SET processing_status = 'processing', updated_at = NOW() WHERE id = ${meetingId}`;
              await processWithLLM(meetingId);
              await sql`UPDATE meetings SET processing_status = 'completed', processed_at = NOW(), updated_at = NOW() WHERE id = ${meetingId}`;
              result.enriched++;
            } catch (llmErr: unknown) {
              const msg = llmErr instanceof Error ? llmErr.message : String(llmErr);
              log.warn('LLM enrichment failed', { meetingId, error: msg }, LOGGER);
              await sql`UPDATE meetings SET processing_status = 'failed', processing_error = ${msg}, updated_at = NOW() WHERE id = ${meetingId}`;
            }
          }

          totalProcessed++;
        } catch (itemErr: unknown) {
          result.failed++;
          const msg = itemErr instanceof Error ? itemErr.message : String(itemErr);
          result.errors.push(`${item.name}: ${msg}`);
          log.error('Failed to process recording', { item: item.name, error: msg }, LOGGER);
        }
      }
    } catch (userErr: unknown) {
      const msg = userErr instanceof Error ? userErr.message : String(userErr);
      log.warn('Failed to scan user OneDrive', { user: user.mail, error: msg }, LOGGER);
    }
  }

  log.info('OneDrive scrape complete', { data: result }, LOGGER);

  return result;
}
