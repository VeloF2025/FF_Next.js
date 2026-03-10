// 🟢 WORKING: Core orchestrator — processes a single Teams call record into a meeting row
import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { fetchCallRecordById } from './call-records';
import {
  fetchOnlineMeetingId,
  listTranscripts,
  downloadTranscriptContent,
  parseVttSpeakers,
} from './transcripts';
import { listRecordings, downloadRecordingToDisk } from './recordings';
import { resolveParticipants } from './speaker-resolver';
import { processWithLLM } from '@/lib/llm/meeting-processor';
import { transcribeWithWhisper } from '@/lib/llm/whisper-transcriber';

const sql = neon(process.env.DATABASE_URL!);

/** Transcripts larger than this are spilled to the meeting_transcripts table */
const TRANSCRIPT_INLINE_LIMIT = 500_000;

/** Minimum call duration to process (very short calls are noise) */
const MIN_DURATION_SECONDS = 60;

const LOGGER = 'MeetingProcessor';

/**
 * Processes a single Teams call record into a fully enriched meeting row.
 *
 * Execution order:
 *   1. Fetch the full call record (with sessions/segments expanded)
 *   2. Skip calls shorter than MIN_DURATION_SECONDS
 *   3. Resolve all participants via Graph /users
 *   4. Upsert the meeting row (idempotent on teams_call_record_id)
 *   5. Fetch transcript (inline or spill to meeting_transcripts)
 *   6. Download recording to disk
 *   7. Run LLM enrichment (summary, action items, topics)
 *   8. Mark status = 'completed'
 *
 * On any failure after the upsert, status is set to 'failed' with the
 * error message persisted in processing_error so ops can inspect.
 *
 * @param callRecordId - Graph callRecord ID (UUID)
 * @returns The database ID of the meeting row, or 0 if the call was skipped
 */
export async function processMeetingFromCallRecord(callRecordId: string): Promise<number> {
  // 1. Fetch full call record with sessions expanded
  const callRecord = await fetchCallRecordById(callRecordId);

  // 2. Skip calls shorter than minimum duration
  const startMs = new Date(callRecord.startDateTime).getTime();
  const endMs = new Date(callRecord.endDateTime).getTime();
  const durationSeconds = Math.floor((endMs - startMs) / 1000);

  if (durationSeconds < MIN_DURATION_SECONDS) {
    log.info(
      'Skipping short call',
      { callRecordId, durationSeconds, minRequired: MIN_DURATION_SECONDS },
      LOGGER
    );
    return 0;
  }

  // 3. Resolve participants (deduped by Graph user ID)
  const participants = await resolveParticipants(callRecord);

  const participantsJson = JSON.stringify(
    participants.map(p => ({
      name: p.displayName,
      email: p.email,
      displayName: p.displayName,
    }))
  );

  // Identify organizer from the call record organizer field
  const organizer = callRecord.organizer?.user;
  const organizerParticipant = organizer?.id
    ? participants.find(p => p.graphUserId === organizer.id) ?? null
    : null;

  // 4. Upsert meeting row — idempotent on teams_call_record_id
  const title = `Teams Meeting - ${new Date(callRecord.startDateTime).toLocaleDateString('en-ZA')}`;
  const durationMinutes = Math.floor(durationSeconds / 60);

  const rows = await sql`
    INSERT INTO meetings (
      title,
      meeting_date,
      duration,
      participants,
      source,
      teams_call_record_id,
      teams_meeting_id,
      organizer_email,
      organizer_name,
      join_url,
      processing_status,
      created_at,
      updated_at
    ) VALUES (
      ${title},
      ${callRecord.startDateTime},
      ${durationMinutes},
      ${participantsJson},
      'teams',
      ${callRecordId},
      ${callRecord.joinWebUrl ?? null},
      ${organizerParticipant?.email ?? null},
      ${organizerParticipant?.displayName ?? organizer?.displayName ?? null},
      ${callRecord.joinWebUrl ?? null},
      'fetching',
      NOW(),
      NOW()
    )
    ON CONFLICT (teams_call_record_id) DO UPDATE SET
      title              = EXCLUDED.title,
      duration           = EXCLUDED.duration,
      participants       = EXCLUDED.participants,
      organizer_email    = EXCLUDED.organizer_email,
      organizer_name     = EXCLUDED.organizer_name,
      processing_status  = 'fetching',
      processing_error   = NULL,
      updated_at         = NOW()
    RETURNING id
  `;

  const meetingId = rows[0]!.id as number;
  log.info('Meeting upserted', { meetingId, callRecordId, durationMinutes }, LOGGER);

  try {
    // 5. Fetch transcript and recording (requires joinWebUrl + a resolved organizer)
    let recordingPath: string | null = null;

    if (callRecord.joinWebUrl && organizerParticipant) {
      const onlineMeetingId = await fetchOnlineMeetingId(
        organizerParticipant.graphUserId,
        callRecord.joinWebUrl
      );

      if (onlineMeetingId) {
        await fetchAndStoreTranscript(
          meetingId,
          organizerParticipant.graphUserId,
          onlineMeetingId
        );

        recordingPath = await fetchAndStoreRecording(
          meetingId,
          organizerParticipant.graphUserId,
          onlineMeetingId
        );
      }
    }

    // 6. Whisper re-transcription (if recording available)
    // Teams VTT doesn't support Afrikaans — Whisper produces proper English translations
    if (recordingPath && process.env.OPENAI_API_KEY) {
      try {
        await sql`UPDATE meetings SET processing_status = 'transcribing', updated_at = NOW() WHERE id = ${meetingId}`;
        const whisperResult = await transcribeWithWhisper(recordingPath, meetingId);

        if (whisperResult.englishTranscript.length > 50) {
          await sql`
            UPDATE meetings
            SET raw_transcript    = ${whisperResult.englishTranscript},
                transcript_source = 'whisper',
                updated_at        = NOW()
            WHERE id = ${meetingId}
          `;
          log.info('Whisper transcript stored', { meetingId, chars: whisperResult.englishTranscript.length }, LOGGER);
        }
      } catch (whisperErr: unknown) {
        const msg = whisperErr instanceof Error ? whisperErr.message : String(whisperErr);
        log.warn('Whisper transcription failed, falling back to VTT', { meetingId, error: msg }, LOGGER);
      }
    }

    // 7. LLM enrichment
    await sql`UPDATE meetings SET processing_status = 'processing', updated_at = NOW() WHERE id = ${meetingId}`;
    await processWithLLM(meetingId);

    // 8. Mark complete
    await sql`
      UPDATE meetings
      SET processing_status = 'completed',
          processed_at      = NOW(),
          updated_at        = NOW()
      WHERE id = ${meetingId}
    `;

    log.info('Meeting processing complete', { meetingId }, LOGGER);
    return meetingId;
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('Meeting processing failed', { meetingId, error: errorMsg }, LOGGER);

    await sql`
      UPDATE meetings
      SET processing_status = 'failed',
          processing_error  = ${errorMsg},
          updated_at        = NOW()
      WHERE id = ${meetingId}
    `;

    throw error;
  }
}

/**
 * Fetches the transcript for an online meeting and persists it.
 * Transcripts under TRANSCRIPT_INLINE_LIMIT are stored inline on the meetings row.
 * Larger transcripts are written to the meeting_transcripts table.
 */
async function fetchAndStoreTranscript(
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
 * Returns the file path if successful, null otherwise.
 */
async function fetchAndStoreRecording(
  meetingId: number,
  organizerUserId: string,
  onlineMeetingId: string
): Promise<string | null> {
  const recordings = await listRecordings(organizerUserId, onlineMeetingId);

  if (recordings.length === 0) {
    log.info('No recordings available', { meetingId, onlineMeetingId }, LOGGER);
    return null;
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
  return filePath;
}
