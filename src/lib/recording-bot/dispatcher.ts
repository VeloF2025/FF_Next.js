// Recording bot dispatcher — launches Docker containers to join Teams meetings
// Uses screenappai/meeting-bot (or compatible) Docker image
import { execFile } from 'child_process';
import { promisify } from 'util';
import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';

const execFileAsync = promisify(execFile);
const sql = neon(process.env.DATABASE_URL!);
const LOGGER = 'RecordingBot';

// Configuration from environment
const BOT_IMAGE = process.env.RECORDING_BOT_IMAGE || 'ghcr.io/screenappai/meeting-bot:latest';
const BOT_NETWORK = process.env.RECORDING_BOT_NETWORK || 'bridge';
const RECORDINGS_PATH = process.env.BOT_RECORDINGS_PATH || '/home/velo/bot-recordings';
const CALLBACK_URL = process.env.RECORDING_BOT_CALLBACK_URL || 'https://app.fibreflow.app/api/recording-bot/callback';
const BOT_DISPLAY_NAME = process.env.RECORDING_BOT_NAME || 'VF Recorder';

/** Maximum concurrent recording bots */
const MAX_CONCURRENT_BOTS = 5;

/** Timeout for a single recording session (3 hours) */
const RECORDING_TIMEOUT_MS = 3 * 60 * 60 * 1000;

export interface DispatchResult {
  botRecordingId: number;
  containerId: string;
}

/**
 * Dispatches a Docker recording bot to join a Teams meeting and record it.
 *
 * The bot:
 *   1. Launches Chromium in headless mode with virtual display + audio
 *   2. Navigates to the Teams web client and joins via the meeting URL
 *   3. Records system audio via PulseAudio + ffmpeg
 *   4. When the meeting ends (or timeout), stops recording
 *   5. POSTs the recording to our callback endpoint
 *
 * @param joinUrl - Teams meeting join URL
 * @param triggeredBy - Graph user ID that triggered detection
 */
export async function dispatchRecordingBot(
  joinUrl: string,
  triggeredBy: string
): Promise<DispatchResult> {
  // Check concurrent bot limit
  const activeCount = await sql`
    SELECT COUNT(*) as cnt FROM bot_recordings
    WHERE status IN ('dispatched', 'joining', 'recording')
  `;

  if (Number(activeCount[0]?.cnt ?? 0) >= MAX_CONCURRENT_BOTS) {
    throw new Error(`Max concurrent bots reached (${MAX_CONCURRENT_BOTS})`);
  }

  // Create tracking row
  const rows = await sql`
    INSERT INTO bot_recordings (join_url, status, triggered_by, dispatched_at)
    VALUES (${joinUrl}, 'dispatched', ${triggeredBy}, NOW())
    RETURNING id
  `;
  const botRecordingId = rows[0]!.id as number;

  try {
    // Launch Docker container
    const containerName = `ff-recorder-${botRecordingId}`;
    const outputDir = `${RECORDINGS_PATH}/${botRecordingId}`;

    const { stdout } = await execFileAsync('docker', [
      'run', '-d',
      '--name', containerName,
      '--network', BOT_NETWORK,
      // Resource limits
      '--memory', '2g',
      '--cpus', '1.5',
      // Shared memory for Chromium
      '--shm-size', '1g',
      // Mount recordings output
      '-v', `${outputDir}:/output`,
      // Environment
      '-e', `MEETING_URL=${joinUrl}`,
      '-e', `BOT_NAME=${BOT_DISPLAY_NAME}`,
      '-e', `CALLBACK_URL=${CALLBACK_URL}`,
      '-e', `RECORDING_ID=${botRecordingId}`,
      '-e', `MAX_DURATION_MS=${RECORDING_TIMEOUT_MS}`,
      // Auto-remove on exit
      '--rm',
      // Image
      BOT_IMAGE,
    ]);

    const containerId = stdout.trim();

    await sql`
      UPDATE bot_recordings
      SET container_id = ${containerId}, status = 'joining', updated_at = NOW()
      WHERE id = ${botRecordingId}
    `;

    log.info(
      'Recording bot dispatched',
      { botRecordingId, containerId: containerId.substring(0, 12), joinUrl: joinUrl.substring(0, 60) },
      LOGGER
    );

    // Schedule timeout cleanup
    setTimeout(() => cleanupTimedOutBot(botRecordingId, containerName), RECORDING_TIMEOUT_MS);

    return { botRecordingId, containerId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await sql`
      UPDATE bot_recordings
      SET status = 'failed', error = ${msg}, completed_at = NOW()
      WHERE id = ${botRecordingId}
    `;
    throw err;
  }
}

/**
 * Stops and removes a recording bot container that has exceeded the timeout.
 */
async function cleanupTimedOutBot(botRecordingId: number, containerName: string): Promise<void> {
  try {
    // Check if still running
    const row = await sql`
      SELECT status FROM bot_recordings WHERE id = ${botRecordingId}
    `;

    if (!row[0] || !['dispatched', 'joining', 'recording'].includes(row[0].status as string)) {
      return; // Already completed or failed
    }

    log.warn('Recording bot timed out', { botRecordingId, containerName }, LOGGER);

    // Stop container (gives 10s grace period)
    await execFileAsync('docker', ['stop', '-t', '10', containerName]).catch(() => {
      // Container may have already exited
    });

    await sql`
      UPDATE bot_recordings
      SET status = 'timeout', error = 'Recording exceeded maximum duration', completed_at = NOW()
      WHERE id = ${botRecordingId}
    `;
  } catch (err: unknown) {
    log.error(
      'Timeout cleanup failed',
      { botRecordingId, error: err instanceof Error ? err.message : String(err) },
      LOGGER
    );
  }
}

/**
 * Returns status of all active recording bots.
 */
export async function getActiveBots(): Promise<Array<{
  id: number;
  joinUrl: string;
  status: string;
  dispatchedAt: string;
}>> {
  const rows = await sql`
    SELECT id, join_url, status, dispatched_at
    FROM bot_recordings
    WHERE status IN ('dispatched', 'joining', 'recording')
    ORDER BY dispatched_at DESC
  `;

  return rows.map(r => ({
    id: r.id as number,
    joinUrl: r.join_url as string,
    status: r.status as string,
    dispatchedAt: r.dispatched_at as string,
  }));
}
