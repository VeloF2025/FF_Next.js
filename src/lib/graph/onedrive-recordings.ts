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
  const url =
    `${GRAPH_BASE}/users/${userId}/drive/root:/Recordings:/children` +
    `?$select=id,name,size,createdDateTime,lastModifiedDateTime,createdBy` +
    `&$top=200&$orderby=createdDateTime desc`;

  const response = await graphFetch(url);

  if (response.status === 404) return []; // No Recordings folder
  if (response.status === 403) {
    log.warn('OneDrive access denied', { userId }, LOGGER);
    return [];
  }
  if (!response.ok) {
    log.warn('OneDrive listing failed', { userId, status: response.status }, LOGGER);
    return [];
  }

  const data = await response.json();
  const items = (data.value || []) as DriveItem[];

  // Only MP4 files (Teams recordings)
  return items.filter(
    (item) => item.name.toLowerCase().endsWith('.mp4') && item.size > 0
  );
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

          // Try to match to existing meeting by date (± 2 hours) that lacks a recording
          const windowMs = 2 * 60 * 60 * 1000;
          const dateStart = new Date(recordingDate.getTime() - windowMs).toISOString();
          const dateEnd = new Date(recordingDate.getTime() + windowMs).toISOString();

          const matchRows = await sql`
            SELECT id, title, recording_path
            FROM meetings
            WHERE source = 'teams'
              AND meeting_date >= ${dateStart}
              AND meeting_date <= ${dateEnd}
              AND recording_path IS NULL
              AND onedrive_item_id IS NULL
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
