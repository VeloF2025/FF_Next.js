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
 */
export async function fetchAndStoreRecording(
  meetingId: number,
  organizerUserId: string,
  onlineMeetingId: string
): Promise<void> {
  const recordings = await listRecordings(organizerUserId, onlineMeetingId);

  if (recordings.length === 0) {
    log.info('No recordings available', { meetingId, onlineMeetingId }, LOGGER);
    return;
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
}
