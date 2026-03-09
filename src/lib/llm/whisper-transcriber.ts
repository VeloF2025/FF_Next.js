/**
 * Whisper Transcription Service
 *
 * Re-transcribes meeting recordings using OpenAI Whisper API.
 * Teams transcription doesn't support Afrikaans — Whisper does.
 *
 * Pipeline:
 *   1. Extract audio from MP4 (ffmpeg → mono 16kHz MP3)
 *   2. Translate to English via Whisper translations endpoint
 *   3. Return formatted transcript text
 *
 * // WORKING: tested on 24 Teams meetings with Afrikaans content
 */

import { execSync } from 'child_process';
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
  /** English translation transcript */
  englishTranscript: string;
  /** Number of segments */
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

/**
 * Call Whisper API translation endpoint (translates any language → English).
 */
async function whisperTranslate(audioPath: string): Promise<WhisperResponse> {
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
 * Extracts audio from the MP4, sends to Whisper for English translation,
 * and returns the formatted transcript. Handles files larger than 25MB
 * by splitting into chunks.
 *
 * @param recordingPath - Absolute path to the MP4 recording
 * @param meetingId     - Database meeting ID (used for temp file naming)
 * @returns WhisperResult with English transcript
 */
export async function transcribeWithWhisper(
  recordingPath: string,
  meetingId: number,
): Promise<WhisperResult> {
  log.info('Starting Whisper transcription', { meetingId, recordingPath }, LOGGER);

  // 1. Extract audio
  const audioPath = extractAudio(recordingPath, meetingId);
  const audioSize = fs.statSync(audioPath).size;
  log.info('Audio extracted', { meetingId, sizeMB: (audioSize / 1024 / 1024).toFixed(1) }, LOGGER);

  // 2. Split if needed
  const chunks = splitAudioIfNeeded(audioPath, meetingId);
  if (chunks.length > 1) {
    log.info('Audio split into chunks', { meetingId, chunks: chunks.length }, LOGGER);
  }

  // 3. Translate each chunk to English
  const allSegments: WhisperSegment[] = [];
  let timeOffset = 0;
  let totalDuration = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const result = await whisperTranslate(chunk);

    const segments = result.segments.map(s => ({
      ...s,
      start: s.start + timeOffset,
      end: s.end + timeOffset,
    }));
    allSegments.push(...segments);

    timeOffset += result.duration;
    totalDuration += result.duration;
  }

  // 4. Build transcript text
  const englishTranscript = buildTranscriptText(allSegments);

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
    { meetingId, segments: allSegments.length, chars: englishTranscript.length },
    LOGGER,
  );

  return {
    englishTranscript,
    segmentCount: allSegments.length,
    duration: totalDuration,
  };
}
