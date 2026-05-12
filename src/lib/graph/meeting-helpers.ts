// Helper functions extracted from meeting-processor.ts to keep files under 300 lines
import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import {
  fetchOnlineMeetingInfo,
  listTranscripts,
  downloadTranscriptContent,
  parseVttSpeakers,
  type OnlineMeetingInfo,
} from './transcripts';
import type { ResolvedParticipant } from './speaker-resolver';
import { listRecordings, downloadRecordingToDisk } from './recordings';
import {
  listUserRecordings,
  downloadDriveItem,
  parseRecordingFilename,
} from './onedrive-recordings';
import * as fs from 'fs';
import * as path from 'path';

const sql = neon(process.env.DATABASE_URL!);
const LOGGER = 'MeetingProcessor';

/** Transcripts larger than this are spilled to the meeting_transcripts table */
const TRANSCRIPT_INLINE_LIMIT = 500_000;

/** Internal tenant domains — configurable via INTERNAL_EMAIL_DOMAINS env var */
export const INTERNAL_DOMAINS = (
  process.env.INTERNAL_EMAIL_DOMAINS || 'velocityfibre.co.za,blitzfibre.com'
).split(',');

/**
 * Resolves the onlineMeeting resource by trying the organizer first,
 * then falling back to every other tenant participant. This handles
 * "Meet Now" calls where the meeting may live under a non-organizer user.
 */
export async function resolveOnlineMeeting(
  joinWebUrl: string,
  organizerParticipant: ResolvedParticipant | null,
  participants: ResolvedParticipant[]
): Promise<{ userId: string | null; meetingInfo: OnlineMeetingInfo | null }> {
  // Build ordered candidate list: organizer first, then other internal participants
  const candidateUserIds: string[] = [];

  if (organizerParticipant) {
    candidateUserIds.push(organizerParticipant.graphUserId);
  }

  for (const p of participants) {
    if (p.graphUserId && !candidateUserIds.includes(p.graphUserId)) {
      const domain = p.email?.split('@')[1]?.toLowerCase();
      if (domain && INTERNAL_DOMAINS.includes(domain)) {
        candidateUserIds.push(p.graphUserId);
      }
    }
  }

  for (const userId of candidateUserIds) {
    const meetingInfo = await fetchOnlineMeetingInfo(userId, joinWebUrl);
    if (meetingInfo?.id) {
      if (userId !== organizerParticipant?.graphUserId) {
        log.info(
          'onlineMeeting resolved via non-organizer participant',
          { userId: userId.substring(0, 8), candidates: candidateUserIds.length },
          LOGGER
        );
      }
      return { userId, meetingInfo };
    }
  }

  log.info(
    'Could not resolve onlineMeeting via any participant',
    { candidates: candidateUserIds.length, joinUrl: joinWebUrl.substring(0, 60) },
    LOGGER
  );
  return { userId: null, meetingInfo: null };
}

/**
 * Fetches the transcript for an online meeting and persists it.
 * Transcripts under TRANSCRIPT_INLINE_LIMIT are stored inline on the meetings row.
 * Larger transcripts are written to the meeting_transcripts table.
 */
export async function fetchAndStoreTranscript(
  meetingId: number,
  organizerUserId: string,
  onlineMeetingId: string
): Promise<void> {
  const transcripts = await listTranscripts(organizerUserId, onlineMeetingId);

  if (transcripts.length === 0) {
    log.info('No transcripts available', { meetingId, onlineMeetingId }, LOGGER);
    return;
  }

  // Take the most recent transcript (first in list from Graph)
  const vtt = await downloadTranscriptContent(
    organizerUserId,
    onlineMeetingId,
    transcripts[0]!.id
  );

  if (vtt.length <= TRANSCRIPT_INLINE_LIMIT) {
    await sql`UPDATE meetings SET raw_transcript = ${vtt}, updated_at = NOW() WHERE id = ${meetingId}`;
  } else {
    // Spill to meeting_transcripts; store first 50 speakers in speaker_map for quick lookup
    const speakerMap = JSON.stringify(parseVttSpeakers(vtt).slice(0, 50));
    await sql`
      INSERT INTO meeting_transcripts (meeting_id, format, content, speaker_map, created_at)
      VALUES (${meetingId}, 'vtt', ${vtt}, ${speakerMap}, NOW())
      ON CONFLICT (meeting_id) DO UPDATE SET
        content    = EXCLUDED.content,
        speaker_map = EXCLUDED.speaker_map
    `;
  }

  log.info('Transcript stored', { meetingId, size: vtt.length }, LOGGER);
}

/**
 * Downloads the first recording for an online meeting and persists the path + size.
 * Returns true if a recording was found and stored, false if none exist.
 */
export async function fetchAndStoreRecording(
  meetingId: number,
  organizerUserId: string,
  onlineMeetingId: string
): Promise<boolean> {
  const recordings = await listRecordings(organizerUserId, onlineMeetingId);

  if (recordings.length === 0) {
    log.info('No recordings available', { meetingId, onlineMeetingId }, LOGGER);
    return false;
  }

  const { filePath, sizeBytes } = await downloadRecordingToDisk(
    organizerUserId,
    onlineMeetingId,
    recordings[0]!.id,
    meetingId
  );

  await sql`
    UPDATE meetings
    SET recording_path        = ${filePath},
        recording_size_bytes  = ${sizeBytes},
        updated_at            = NOW()
    WHERE id = ${meetingId}
  `;

  log.info('Recording stored', { meetingId, filePath, sizeBytes }, LOGGER);
  return true;
}

const RECORDINGS_BASE =
  process.env.MEETING_RECORDINGS_PATH || '/home/velo/meeting-recordings';

// Match window: recording createdDateTime (UTC) vs meeting startDateTime (UTC).
// Teams creates the OneDrive file when recording STARTS, not when it ends.
// 2h covers the longest expected meeting; extra buffer for late webhook delivery.
const ONEDRIVE_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Fallback: searches the organizer's OneDrive /Recordings/ folder for a recording
 * that matches the meeting start time. Used when resolveOnlineMeeting fails and the
 * Graph onlineMeetings API can't find the meeting resource.
 *
 * Only the organizer's OneDrive is searched — recordings from personal/ad-hoc meetings
 * are always saved there. Searching all participants' OneDrive would cause recordings
 * to be incorrectly claimed by meetings where the participant was the organizer of a
 * different concurrent recording.
 *
 * @returns true if a recording was found and attached, false otherwise
 */
export async function findAndStoreOneDriveRecording(
  meetingId: number,
  meetingDate: string,
  organizerParticipant: ResolvedParticipant | null,
  _participants: ResolvedParticipant[]
): Promise<boolean> {
  const meetingMs = new Date(meetingDate).getTime();

  // Only search the organizer's OneDrive. Searching all participants causes recordings
  // to be incorrectly claimed by other meetings (the organizer is the only one whose
  // OneDrive will contain a recording of THIS meeting).
  if (!organizerParticipant?.graphUserId) {
    log.info('No organizer for OneDrive fallback', { meetingId }, LOGGER);
    return false;
  }

  const organizerUserId = organizerParticipant.graphUserId;

  log.info(
    'Attempting OneDrive recording fallback',
    { meetingId, organizerUserId: organizerUserId.substring(0, 8) },
    LOGGER
  );

  try {
      const recordings = await listUserRecordings(organizerUserId);
      if (recordings.length === 0) {
        log.info('No OneDrive recordings for organizer', { meetingId }, LOGGER);
        return false;
      }

      for (const item of recordings) {
        // Use createdDateTime (UTC) for matching — filename timestamps are in the organizer's
        // local timezone (SAST = UTC+2) and would introduce a 2h offset if parsed as UTC.
        const itemMs = new Date(item.createdDateTime).getTime();

        if (Math.abs(itemMs - meetingMs) > ONEDRIVE_MATCH_WINDOW_MS) continue;

        // Check if this OneDrive item is already attached to another meeting
        const existing = await sql`
          SELECT id FROM meetings WHERE onedrive_item_id = ${item.id}
        `;
        if (existing.length > 0) continue;

        // Match found — download and attach
        const recDate = new Date(meetingDate);
        const year = recDate.getFullYear().toString();
        const month = String(recDate.getMonth() + 1).padStart(2, '0');
        const filePath = path.join(RECORDINGS_BASE, year, month, `${meetingId}.mp4`);

        const parsed = parseRecordingFilename(item.name);

        if (!fs.existsSync(filePath)) {
          const sizeBytes = await downloadDriveItem(organizerUserId, item.id, filePath);
          await sql`
            UPDATE meetings
            SET recording_path = ${filePath},
                recording_size_bytes = ${sizeBytes},
                onedrive_item_id = ${item.id},
                updated_at = NOW()
            WHERE id = ${meetingId}
          `;
          log.info('OneDrive recording attached', {
            meetingId, filePath, sizeMB: (sizeBytes / 1024 / 1024).toFixed(1),
            source: item.name,
          }, LOGGER);
        } else {
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

        // Update title from filename if still generic
        if (parsed.title) {
          await sql`
            UPDATE meetings
            SET title = ${parsed.title}, updated_at = NOW()
            WHERE id = ${meetingId} AND title LIKE 'Teams Meeting -%'
          `;
        }

        return true;
      }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('OneDrive fallback failed for organizer', { organizerUserId: organizerUserId.substring(0, 8), error: msg }, LOGGER);
  }

  log.info('No matching OneDrive recording found', { meetingId }, LOGGER);
  return false;
}
