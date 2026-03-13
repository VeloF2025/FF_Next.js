// Callback endpoint for recording bot — receives completed recording metadata
// The bot POSTs here when it finishes recording a meeting
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { transcribeAudio } from '@/lib/recording-bot/transcriber';
import { processWithLLM } from '@/lib/llm/meeting-processor';

const sql = neon(process.env.DATABASE_URL!);
const LOGGER = 'RecordingBotCallback';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

interface CallbackPayload {
  recording_id: number;
  status: 'completed' | 'failed';
  audio_path?: string;
  audio_size?: number;
  duration_sec?: number;
  error?: string;
}

/**
 * POST /api/recording-bot/callback
 *
 * Called by the recording bot Docker container when recording is complete.
 * Triggers Whisper transcription and LLM enrichment pipeline.
 *
 * Auth: CRON_SECRET bearer token (shared with bot via env).
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (!cronSecret || !authHeader || authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = req.body as CallbackPayload;
  if (!body?.recording_id) {
    res.status(400).json({ error: 'Missing recording_id' });
    return;
  }

  log.info('Recording bot callback received', { recordingId: body.recording_id, status: body.status }, LOGGER);

  // Update bot_recordings row
  if (body.status === 'failed') {
    await sql`
      UPDATE bot_recordings
      SET status = 'failed', error = ${body.error ?? 'Unknown error'}, completed_at = NOW()
      WHERE id = ${body.recording_id}
    `;
    res.status(200).json({ success: true });
    return;
  }

  // Recording completed — update metadata
  await sql`
    UPDATE bot_recordings
    SET status = 'uploading',
        audio_path = ${body.audio_path ?? null},
        audio_size = ${body.audio_size ?? null},
        duration_sec = ${body.duration_sec ?? null},
        completed_at = NOW()
    WHERE id = ${body.recording_id}
  `;

  // Respond immediately, process in background
  res.status(202).json({ success: true, message: 'Processing queued' });

  // Background: transcribe + enrich
  setImmediate(async () => {
    try {
      const recording = await sql`
        SELECT id, join_url, audio_path, duration_sec, triggered_by, meeting_id
        FROM bot_recordings WHERE id = ${body.recording_id}
      `;
      const rec = recording[0];
      if (!rec || !rec.audio_path) return;

      // Create or get meeting row first (need meetingId for Whisper temp files)
      let meetingId = rec.meeting_id as number | null;

      if (!meetingId) {
        // Create a new meeting row for this bot recording
        const title = `Teams Meeting (Bot) - ${new Date().toLocaleDateString('en-ZA')}`;
        const durationMinutes = Math.floor((rec.duration_sec as number || 0) / 60);

        const meetingRows = await sql`
          INSERT INTO meetings (
            title, meeting_date, duration, source, join_url,
            processing_status, created_at, updated_at
          ) VALUES (
            ${title}, NOW(), ${durationMinutes}, 'bot-recording', ${rec.join_url as string},
            'fetching', NOW(), NOW()
          )
          RETURNING id
        `;
        meetingId = meetingRows[0]!.id as number;

        await sql`
          UPDATE bot_recordings SET meeting_id = ${meetingId} WHERE id = ${body.recording_id}
        `;
      }

      // Transcribe with existing OpenAI Whisper pipeline
      const transcript = await transcribeAudio(rec.audio_path as string, meetingId);

      if (!transcript) {
        await sql`
          UPDATE bot_recordings SET status = 'failed', error = 'Transcription returned empty' WHERE id = ${body.recording_id}
        `;
        await sql`
          UPDATE meetings SET processing_status = 'failed', processing_error = 'Transcription empty' WHERE id = ${meetingId}
        `;
        return;
      }

      // Store transcript on meeting row
      await sql`
        UPDATE meetings
        SET raw_transcript = ${transcript}, processing_status = 'processing', updated_at = NOW()
        WHERE id = ${meetingId}
      `;

      // Run LLM enrichment (summary, action items, topics)
      await processWithLLM(meetingId);

      await sql`
        UPDATE bot_recordings SET status = 'completed' WHERE id = ${body.recording_id}
      `;

      log.info('Bot recording fully processed', { recordingId: body.recording_id, meetingId }, LOGGER);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('Bot recording processing failed', { recordingId: body.recording_id, error: msg }, LOGGER);
      await sql`
        UPDATE bot_recordings SET status = 'failed', error = ${msg} WHERE id = ${body.recording_id}
      `;
    }
  });
}
