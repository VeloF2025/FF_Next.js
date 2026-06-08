/**
 * Whisper Transcription Service
 *
 * Re-transcribes meeting recordings with Whisper. Teams transcription doesn't
 * support Afrikaans — Whisper does.
 *
 * Backend selection:
 *   - When WHISPER_REMOTE_URL is set, transcription is offloaded to an on-prem
 *     whisper.cpp server (the Mac Mini, large-v3 + VAD) — no OpenAI cost and the
 *     audio never leaves our network. This is the preferred path.
 *   - When WHISPER_REMOTE_URL is unset, it falls back to the OpenAI Whisper API
 *     (whisper-1). When the remote IS configured we never fall back to OpenAI on
 *     error — the failure surfaces instead, so a transient outage can't silently
 *     resurrect OpenAI spend.
 *
 * Pipeline:
 *   1. Extract audio from MP4 (ffmpeg → mono 16kHz MP3)
 *   2. Transcribe with language=af to preserve Afrikaans/code-switching
 *   3. Translate to English (Whisper translate task) for LLM processing
 *   4. Return both formatted transcripts
 *
 * // WORKING: af + en passes verified against the on-prem whisper.cpp server
 */

import { execSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '@/lib/logger';

const LOGGER = 'WhisperTranscriber';
const WHISPER_MAX_SIZE = 25 * 1024 * 1024; // 25MB API limit

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

interface WhisperResponse {
  text: string;
  language: string;
  duration: number;
  segments: WhisperSegment[];
}

export interface WhisperResult {
  /** English translation transcript used by LLM processing */
  englishTranscript: string;
  /** Original-language Afrikaans/code-switched transcript */
  afrikaansTranscript: string;
  /** Number of English segments */
  segmentCount: number;
  /** Duration in seconds */
  duration: number;
}

/**
 * Extract audio from MP4 as mono 16kHz MP3.
 */
function extractAudio(mp4Path: string, meetingId: number): string {
  const outPath = `/tmp/whisper-${meetingId}-audio.mp3`;

  try {
    execSync(
      `ffmpeg -i "${mp4Path}" -vn -ac 1 -ar 16000 -b:a 48k "${outPath}" -y 2>/dev/null`,
      { timeout: 120_000 },
    );
  } catch {
    throw new Error(`Failed to extract audio from ${mp4Path}`);
  }

  return outPath;
}

/**
 * Split audio into chunks under the Whisper size limit.
 */
function splitAudioIfNeeded(audioPath: string, meetingId: number): string[] {
  const stats = fs.statSync(audioPath);

  if (stats.size <= WHISPER_MAX_SIZE) {
    return [audioPath];
  }

  const durationStr = execSync(
    `ffprobe -i "${audioPath}" -show_entries format=duration -v quiet -of csv="p=0"`,
    { encoding: 'utf-8' },
  ).trim();
  const totalDuration = parseFloat(durationStr);
  const numChunks = Math.ceil(stats.size / (WHISPER_MAX_SIZE * 0.9));
  const chunkDuration = Math.floor(totalDuration / numChunks);

  const chunkDir = `/tmp/whisper-${meetingId}-chunks`;
  if (fs.existsSync(chunkDir)) {
    fs.rmSync(chunkDir, { recursive: true });
  }
  fs.mkdirSync(chunkDir, { recursive: true });

  execSync(
    `ffmpeg -i "${audioPath}" -f segment -segment_time ${chunkDuration} -c copy "${chunkDir}/chunk_%03d.mp3" -y 2>/dev/null`,
    { timeout: 120_000 },
  );

  return fs.readdirSync(chunkDir)
    .filter(f => f.endsWith('.mp3'))
    .sort()
    .map(f => path.join(chunkDir, f));
}

/** Default remote-whisper request timeout: 30 minutes. */
const DEFAULT_REMOTE_TIMEOUT_MS = 1_800_000;
/** Monotonic counter so concurrent conversions never collide on the temp WAV path. */
let wavSeq = 0;

/** On-prem whisper.cpp endpoint (e.g. http://100.117.249.72:8009). Empty → OpenAI. */
function remoteWhisperUrl(): string {
  return (process.env.WHISPER_REMOTE_URL ?? '').trim();
}

/** True when a valid http(s) on-prem whisper endpoint is configured. */
function remoteWhisperConfigured(): boolean {
  return /^https?:\/\//i.test(remoteWhisperUrl());
}

/**
 * Parse WHISPER_REMOTE_TIMEOUT_MS, falling back to the default for missing,
 * non-numeric, or non-positive values. Exported for testing — a bad value must
 * never become NaN (setTimeout(fn, NaN) fires immediately and aborts every call).
 */
export function resolveRemoteTimeoutMs(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REMOTE_TIMEOUT_MS;
}

/** Remove a temp file; ENOENT is expected, anything else is logged (never thrown). */
function safeUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('Failed to remove temp file', { filePath, err: (err as Error).message }, LOGGER);
    }
  }
}

/**
 * ffmpeg-convert an audio file to the 16 kHz mono PCM WAV the whisper.cpp
 * server expects. Returns the temp WAV path (caller must unlink). Uses
 * execFileSync (argument array, no shell) so a path with shell metacharacters
 * cannot inject commands. Cleans up the partial WAV if ffmpeg fails.
 */
function toWav16k(srcPath: string): string {
  const wavPath = `${srcPath}.${process.pid}.${wavSeq++}.16k.wav`;
  try {
    execFileSync(
      'ffmpeg',
      ['-y', '-i', srcPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath],
      { timeout: 120_000, stdio: 'ignore' },
    );
  } catch (err) {
    safeUnlink(wavPath);
    log.warn(
      'ffmpeg 16kHz WAV conversion failed',
      { srcPath, err: err instanceof Error ? err.message : String(err) },
      LOGGER,
    );
    throw new Error(`Failed to convert ${srcPath} to 16kHz WAV`);
  }
  return wavPath;
}

/**
 * Transcribe (or translate→English) a chunk via the on-prem whisper.cpp server.
 * Mirrors the OpenAI verbose_json response shape ({ text, duration, segments }),
 * so callers parse it identically. translate=true uses Whisper's built-in
 * translate task (any language → English), replacing OpenAI's translations
 * endpoint; otherwise language=af preserves the Afrikaans/code-switched original.
 */
async function whisperRemote(
  audioPath: string,
  opts: { translate: boolean },
): Promise<WhisperResponse> {
  const kind = opts.translate ? 'translation' : 'transcription';
  const url = `${remoteWhisperUrl().replace(/\/$/, '')}/inference`;
  const timeoutMs = resolveRemoteTimeoutMs(process.env.WHISPER_REMOTE_TIMEOUT_MS);
  const wavPath = toWav16k(audioPath);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const wavBuffer = fs.readFileSync(wavPath);
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });

    const formData = new FormData();
    formData.append('file', blob, path.basename(wavPath));
    formData.append('response_format', 'verbose_json');
    formData.append('temperature', '0.0');
    if (opts.translate) {
      formData.append('translate', 'true');
    } else {
      formData.append('language', 'af');
    }

    let response: Response;
    try {
      response = await fetch(url, { method: 'POST', body: formData, signal: controller.signal });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Remote whisper ${kind} timed out after ${timeoutMs}ms`);
      }
      throw err;
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Remote whisper ${kind} failed: ${response.status} ${errText}`);
    }

    const result = (await response.json()) as WhisperResponse;
    if (!result || !Array.isArray(result.segments)) {
      throw new Error(`Remote whisper ${kind} returned an unexpected shape (missing segments array)`);
    }
    return result;
  } finally {
    clearTimeout(timer);
    safeUnlink(wavPath);
  }
}

/**
 * Afrikaans transcription pass. Prefers the on-prem whisper.cpp server; falls
 * back to the OpenAI Whisper API only when no remote endpoint is configured.
 * This preserves the original Afrikaans/code-switched transcript instead of
 * relying on Teams VTT, which is poor for Afrikaans meetings.
 */
async function whisperTranscribeAfrikaans(audioPath: string): Promise<WhisperResponse> {
  if (remoteWhisperConfigured()) {
    return whisperRemote(audioPath, { translate: false });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const audioBuffer = fs.readFileSync(audioPath);
  const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });

  const formData = new FormData();
  formData.append('file', blob, path.basename(audioPath));
  formData.append('model', 'whisper-1');
  formData.append('language', 'af');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Whisper Afrikaans transcription failed: ${response.status} ${err}`);
  }

  return response.json() as Promise<WhisperResponse>;
}

/**
 * English translation pass (translates any language → English). Prefers the
 * on-prem whisper.cpp server; falls back to the OpenAI Whisper API only when no
 * remote endpoint is configured.
 */
async function whisperTranslate(audioPath: string): Promise<WhisperResponse> {
  if (remoteWhisperConfigured()) {
    return whisperRemote(audioPath, { translate: true });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const audioBuffer = fs.readFileSync(audioPath);
  const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });

  const formData = new FormData();
  formData.append('file', blob, path.basename(audioPath));
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  const response = await fetch('https://api.openai.com/v1/audio/translations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Whisper translation failed: ${response.status} ${err}`);
  }

  return response.json() as Promise<WhisperResponse>;
}

/**
 * Build readable transcript text from Whisper segments.
 */
function buildTranscriptText(segments: WhisperSegment[]): string {
  return segments.map(s => {
    const min = Math.floor(s.start / 60);
    const sec = Math.floor(s.start % 60);
    const ts = `${min}:${String(sec).padStart(2, '0')}`;
    return `(${ts}) ${s.text.trim()}`;
  }).join('\n');
}

/**
 * Transcribe a meeting recording using OpenAI Whisper.
 *
 * Extracts audio from the MP4, sends to Whisper for Afrikaans transcription
 * and English translation, and returns both formatted transcripts. Handles files larger than 25MB
 * by splitting into chunks.
 *
 * @param recordingPath - Absolute path to the MP4 recording
 * @param meetingId     - Database meeting ID (used for temp file naming)
 * @param options.withAfrikaans - When false, skip the Afrikaans transcription
 *   pass and only run the translation pass. Halves OpenAI cost+latency for
 *   callers that discard the Afrikaans transcript (e.g. the bot recorder).
 *   Defaults to true for backwards compatibility with the Teams ingestion
 *   path that needs both languages.
 * @returns WhisperResult with English transcript (and Afrikaans if requested)
 */
interface TranscribeOptions {
  withAfrikaans?: boolean;
}

export async function transcribeWithWhisper(
  recordingPath: string,
  meetingId: number,
  options: TranscribeOptions = {},
): Promise<WhisperResult> {
  const withAfrikaans = options.withAfrikaans !== false;
  log.info('Starting Whisper transcription', { meetingId, recordingPath, withAfrikaans }, LOGGER);

  // 1. Extract audio
  const audioPath = extractAudio(recordingPath, meetingId);
  const audioSize = fs.statSync(audioPath).size;
  log.info('Audio extracted', { meetingId, sizeMB: (audioSize / 1024 / 1024).toFixed(1) }, LOGGER);

  // 2. Split if needed
  const chunks = splitAudioIfNeeded(audioPath, meetingId);
  if (chunks.length > 1) {
    log.info('Audio split into chunks', { meetingId, chunks: chunks.length }, LOGGER);
  }

  // 3. Transcribe each chunk as Afrikaans/code-switched original and translate to English
  const allAfrikaansSegments: WhisperSegment[] = [];
  const allEnglishSegments: WhisperSegment[] = [];
  let timeOffset = 0;
  let totalDuration = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    // Only run the Afrikaans pass when the caller asked for it. Both
    // endpoints process the same audio chunk, so when both run they should
    // return the same `duration`; we use whichever is available.
    const afResult = withAfrikaans ? await whisperTranscribeAfrikaans(chunk) : null;
    const enResult = await whisperTranslate(chunk);

    if (afResult) {
      const afSegments = afResult.segments.map(s => ({
        ...s,
        start: s.start + timeOffset,
        end: s.end + timeOffset,
      }));
      allAfrikaansSegments.push(...afSegments);
    }

    const enSegments = enResult.segments.map(s => ({
      ...s,
      start: s.start + timeOffset,
      end: s.end + timeOffset,
    }));
    allEnglishSegments.push(...enSegments);

    const chunkDuration = afResult?.duration ?? enResult.duration;
    timeOffset += chunkDuration;
    totalDuration += chunkDuration;
  }

  // 4. Build transcript text
  const afrikaansTranscript = buildTranscriptText(allAfrikaansSegments);
  const englishTranscript = buildTranscriptText(allEnglishSegments);

  // 5. Cleanup temp files
  try {
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    const chunkDir = `/tmp/whisper-${meetingId}-chunks`;
    if (fs.existsSync(chunkDir)) fs.rmSync(chunkDir, { recursive: true });
  } catch {
    // Non-critical cleanup failure
  }

  log.info(
    'Whisper transcription complete',
    { meetingId, afrikaansSegments: allAfrikaansSegments.length, englishSegments: allEnglishSegments.length, chars: englishTranscript.length },
    LOGGER,
  );

  return {
    englishTranscript,
    afrikaansTranscript,
    segmentCount: allEnglishSegments.length,
    duration: totalDuration,
  };
}
