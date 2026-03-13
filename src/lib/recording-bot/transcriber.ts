// Transcription for bot-recorded meeting audio
// Delegates to the existing OpenAI Whisper transcriber (whisper-1 API)
import { transcribeWithWhisper } from '@/lib/llm/whisper-transcriber';
import { log } from '@/lib/logger';

const LOGGER = 'BotTranscriber';

/**
 * Transcribes a bot-recorded audio file using the existing Whisper pipeline.
 * The existing transcriber handles:
 *   - Audio extraction (ffmpeg → mono 16kHz MP3)
 *   - Chunking for files > 25MB
 *   - English translation (handles Afrikaans/English mix)
 *
 * @param audioPath - Path to the audio file (WAV, MP3, MP4, or WebM)
 * @param meetingId - Database meeting ID (for temp file naming)
 * @returns Transcript text, or null if transcription failed
 */
export async function transcribeAudio(
  audioPath: string,
  meetingId: number
): Promise<string | null> {
  try {
    log.info('Starting bot recording transcription', { audioPath, meetingId }, LOGGER);

    const result = await transcribeWithWhisper(audioPath, meetingId);

    if (!result.englishTranscript) {
      log.warn('Transcription returned empty', { audioPath, meetingId }, LOGGER);
      return null;
    }

    log.info(
      'Bot recording transcribed',
      { meetingId, segments: result.segmentCount, duration: result.duration },
      LOGGER
    );

    return result.englishTranscript;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Bot recording transcription failed', { audioPath, meetingId, error: msg }, LOGGER);
    return null;
  }
}
