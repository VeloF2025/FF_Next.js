// 🟢 WORKING: Microsoft Graph API recording download — streams MP4 to local disk
import { graphFetch } from './auth';
import { log } from '@/lib/logger';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** Metadata record for a single recording attached to an online meeting */
export interface RecordingMeta {
  id: string;
  createdDateTime: string;
  contentCorrelationId?: string;
}

/** Result of a successful recording download */
export interface RecordingDownloadResult {
  /** Absolute path to the saved MP4 file */
  filePath: string;
  /** File size in bytes */
  sizeBytes: number;
}

/**
 * Lists all recording metadata records for the given online meeting.
 * Returns an empty array if no recordings exist or the request fails.
 *
 * @param organizerUserId - Graph user ID of the meeting organizer
 * @param onlineMeetingId - Graph onlineMeeting ID
 */
export async function listRecordings(
  organizerUserId: string,
  onlineMeetingId: string
): Promise<RecordingMeta[]> {
  const url = `${GRAPH_BASE}/users/${organizerUserId}/onlineMeetings/${onlineMeetingId}/recordings`;
  const response = await graphFetch(url);

  if (!response.ok) {
    log.warn(
      'No recordings found',
      { onlineMeetingId, status: response.status },
      'GraphRecordings'
    );
    return [];
  }

  const data = await response.json();
  return (data.value as RecordingMeta[]) || [];
}

/**
 * Downloads a Teams meeting recording to the local filesystem as an MP4.
 * Files are organised under `$MEETING_RECORDINGS_PATH/YYYY/MM/<dbMeetingId>.mp4`.
 * The directory tree is created automatically if it does not exist.
 *
 * @param organizerUserId - Graph user ID of the meeting organizer
 * @param meetingId - Graph onlineMeeting ID
 * @param recordingId - ID of the specific recording to download
 * @param dbMeetingId - Primary key from the local `meetings` table (used as filename)
 * @returns Resolved file path and file size in bytes
 */
export async function downloadRecordingToDisk(
  organizerUserId: string,
  meetingId: string,
  recordingId: string,
  dbMeetingId: number
): Promise<RecordingDownloadResult> {
  const basePath =
    process.env.MEETING_RECORDINGS_PATH || '/home/velo/meeting-recordings';

  const now = new Date();
  const year = now.getFullYear().toString();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const dir = path.join(basePath, year, month);

  // Ensure target directory exists before writing
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${dbMeetingId}.mp4`);

  const url = [
    `${GRAPH_BASE}/users/${organizerUserId}`,
    `/onlineMeetings/${meetingId}`,
    `/recordings/${recordingId}/content`,
  ].join('');

  const response = await graphFetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download recording: ${response.status}`);
  }

  // Stream to disk. `arrayBuffer()` held the ENTIRE recording in memory first
  // (~100 MB+ each): on 2026-08-05, 75 concurrent downloads stalled against a slow
  // Graph endpoint and exhausted production's 16 GB cgroup. Streaming keeps memory
  // proportional to one chunk regardless of recording length.
  //
  // Write to a .part file and rename, so a failed or interrupted download can never
  // leave a truncated .mp4 at the final path. (The previous code wrote straight to
  // filePath despite claiming to be atomic.)
  if (!response.body) {
    throw new Error('Failed to download recording: response had no body');
  }
  const partPath = `${filePath}.part`;
  try {
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      fs.createWriteStream(partPath),
    );
    fs.renameSync(partPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(partPath); } catch { /* nothing to clean up */ }
    throw err;
  }

  const sizeBytes = fs.statSync(filePath).size;
  log.info(
    'Recording downloaded',
    { filePath, sizeBytes, dbMeetingId },
    'GraphRecordings'
  );

  return { filePath, sizeBytes };
}
