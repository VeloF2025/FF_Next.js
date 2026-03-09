#!/usr/bin/env node
/**
 * Re-transcribe Meetings with OpenAI Whisper
 *
 * Teams transcription doesn't support Afrikaans — it produces gibberish
 * when meetings are conducted in Afrikaans or mixed Afrikaans/English.
 * This script re-transcribes from the MP4 recording using Whisper,
 * which properly handles Afrikaans and code-switching.
 *
 * Pipeline:
 *   1. Extract audio from MP4 (ffmpeg → mono 16kHz MP3, ~16MB for 46min)
 *   2. Transcribe with Whisper API (language=af for Afrikaans)
 *   3. Translate to English with Whisper translation endpoint
 *   4. Store both transcripts in database
 *   5. Re-run LLM processing on the English translation
 *
 * Usage:
 *   npx tsx scripts/retranscribe-whisper.ts [--meeting-id N] [--all] [--dry-run] [--skip-llm]
 *
 * Options:
 *   --meeting-id N   Process a single meeting
 *   --all            Process all meetings with recordings
 *   --dry-run        Show what would be processed
 *   --skip-llm       Skip LLM reprocessing after transcription
 *   --limit N        Max meetings to process (default: 10)
 */

import { neon } from '@neondatabase/serverless';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { processWithLLM } from '../src/lib/llm/meeting-processor';

const DATABASE_URL = process.env.DATABASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!OPENAI_API_KEY) { console.error('OPENAI_API_KEY not set'); process.exit(1); }

const sql = neon(DATABASE_URL);
const WHISPER_MAX_SIZE = 25 * 1024 * 1024; // 25MB Whisper API limit

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipLLM = args.includes('--skip-llm');
const processAll = args.includes('--all');
const meetingIdIdx = args.indexOf('--meeting-id');
const meetingId = meetingIdIdx >= 0 ? parseInt(args[meetingIdIdx + 1] || '0', 10) : 0;
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] || '10', 10) : 10;

interface MeetingRow {
  id: number;
  title: string;
  recording_path: string;
  recording_size_bytes: number;
}

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

/**
 * Extract audio from MP4 as mono 16kHz MP3.
 * Returns path to the extracted audio file.
 */
function extractAudio(mp4Path: string, meetingId: number): string {
  const outPath = `/tmp/meeting-${meetingId}-audio.mp3`;

  execSync(
    `ffmpeg -i "${mp4Path}" -vn -ac 1 -ar 16000 -b:a 48k "${outPath}" -y 2>/dev/null`,
    { timeout: 120_000 },
  );

  return outPath;
}

/**
 * Split an audio file into chunks under the Whisper size limit.
 * Uses ffmpeg segment splitting by duration.
 */
function splitAudioIfNeeded(audioPath: string, meetingId: number): string[] {
  const stats = fs.statSync(audioPath);

  if (stats.size <= WHISPER_MAX_SIZE) {
    return [audioPath];
  }

  // Calculate split duration based on file size ratio
  const durationStr = execSync(
    `ffprobe -i "${audioPath}" -show_entries format=duration -v quiet -of csv="p=0"`,
    { encoding: 'utf-8' },
  ).trim();
  const totalDuration = parseFloat(durationStr);
  const numChunks = Math.ceil(stats.size / (WHISPER_MAX_SIZE * 0.9));
  const chunkDuration = Math.floor(totalDuration / numChunks);

  const chunkDir = `/tmp/meeting-${meetingId}-chunks`;
  if (fs.existsSync(chunkDir)) {
    fs.rmSync(chunkDir, { recursive: true });
  }
  fs.mkdirSync(chunkDir, { recursive: true });

  execSync(
    `ffmpeg -i "${audioPath}" -f segment -segment_time ${chunkDuration} -c copy "${chunkDir}/chunk_%03d.mp3" -y 2>/dev/null`,
    { timeout: 120_000 },
  );

  const chunks = fs.readdirSync(chunkDir)
    .filter(f => f.endsWith('.mp3'))
    .sort()
    .map(f => path.join(chunkDir, f));

  return chunks;
}

/**
 * Call Whisper API for transcription (keeps original language).
 */
async function whisperTranscribe(audioPath: string): Promise<WhisperResponse> {
  const formData = new FormData();
  const audioBuffer = fs.readFileSync(audioPath);
  const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
  formData.append('file', blob, path.basename(audioPath));
  formData.append('model', 'whisper-1');
  formData.append('language', 'af');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Whisper transcription failed: ${response.status} ${err}`);
  }

  return response.json() as Promise<WhisperResponse>;
}

/**
 * Call Whisper API for translation (translates to English).
 */
async function whisperTranslate(audioPath: string): Promise<WhisperResponse> {
  const formData = new FormData();
  const audioBuffer = fs.readFileSync(audioPath);
  const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
  formData.append('file', blob, path.basename(audioPath));
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  const response = await fetch('https://api.openai.com/v1/audio/translations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
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
 * Process a single meeting: extract → transcribe → translate → store → LLM.
 */
async function processMeeting(meeting: MeetingRow): Promise<void> {
  console.log(`\n  Extracting audio from ${meeting.recording_path}...`);

  // 1. Extract audio
  const audioPath = extractAudio(meeting.recording_path, meeting.id);
  const audioSize = fs.statSync(audioPath).size;
  console.log(`  Audio extracted: ${(audioSize / 1024 / 1024).toFixed(1)}MB`);

  // 2. Split if needed
  const chunks = splitAudioIfNeeded(audioPath, meeting.id);
  if (chunks.length > 1) {
    console.log(`  Split into ${chunks.length} chunks`);
  }

  // 3. Transcribe (Afrikaans) and translate (English) each chunk
  let allAfSegments: WhisperSegment[] = [];
  let allEnSegments: WhisperSegment[] = [];
  let timeOffset = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    if (chunks.length > 1) {
      console.log(`  Chunk ${i + 1}/${chunks.length}...`);
    }

    console.log(`  Transcribing (Afrikaans)...`);
    const afResult = await whisperTranscribe(chunk);
    const afSegments = afResult.segments.map(s => ({
      ...s,
      start: s.start + timeOffset,
      end: s.end + timeOffset,
    }));
    allAfSegments.push(...afSegments);

    console.log(`  Translating (English)...`);
    const enResult = await whisperTranslate(chunk);
    const enSegments = enResult.segments.map(s => ({
      ...s,
      start: s.start + timeOffset,
      end: s.end + timeOffset,
    }));
    allEnSegments.push(...enSegments);

    timeOffset += afResult.duration;
  }

  // 4. Build transcript texts
  const afTranscript = buildTranscriptText(allAfSegments);
  const enTranscript = buildTranscriptText(allEnSegments);

  console.log(`  Afrikaans: ${allAfSegments.length} segments, ${afTranscript.length} chars`);
  console.log(`  English:   ${allEnSegments.length} segments, ${enTranscript.length} chars`);

  // 5. Store in database
  // raw_transcript gets the English translation (used by LLM processor)
  // Original Afrikaans stored in meeting_transcripts table
  await sql`
    UPDATE meetings
    SET raw_transcript = ${enTranscript},
        transcript_source = 'whisper',
        updated_at = NOW()
    WHERE id = ${meeting.id}
  `;

  // Store Afrikaans original in meeting_transcripts (delete+insert for idempotency)
  await sql`DELETE FROM meeting_transcripts WHERE meeting_id = ${meeting.id} AND format = 'whisper-af'`;
  await sql`
    INSERT INTO meeting_transcripts (meeting_id, format, content, created_at)
    VALUES (${meeting.id}, 'whisper-af', ${afTranscript}, NOW())
  `;

  console.log(`  Stored both transcripts`);

  // 6. Re-run LLM processing
  if (!skipLLM) {
    console.log(`  Running LLM processing...`);
    const summary = await processWithLLM(meeting.id);
    console.log(`  Title: "${summary.suggested_title}"`);
    console.log(`  ${summary.action_items.length} action items, ${summary.decisions.length} decisions`);
  }

  // 7. Cleanup temp files
  if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  const chunkDir = `/tmp/meeting-${meeting.id}-chunks`;
  if (fs.existsSync(chunkDir)) fs.rmSync(chunkDir, { recursive: true });
}

async function main() {
  console.log(`\nWhisper Re-transcription ${dryRun ? '(DRY RUN)' : ''}`);
  console.log(`Skip LLM: ${skipLLM} | Limit: ${limit}\n`);

  let meetings: MeetingRow[];

  if (meetingId > 0) {
    meetings = (await sql`
      SELECT id, title, recording_path, recording_size_bytes
      FROM meetings
      WHERE id = ${meetingId}
        AND recording_path IS NOT NULL
    `) as MeetingRow[];
  } else if (processAll) {
    meetings = (await sql`
      SELECT id, title, recording_path, recording_size_bytes
      FROM meetings
      WHERE recording_path IS NOT NULL
        AND source = 'teams'
      ORDER BY meeting_date DESC
      LIMIT ${limit}
    `) as MeetingRow[];
  } else {
    // Default: only meetings that still have garbled VTT transcripts
    meetings = (await sql`
      SELECT id, title, recording_path, recording_size_bytes
      FROM meetings
      WHERE recording_path IS NOT NULL
        AND source = 'teams'
        AND (transcript_source IS NULL OR transcript_source = 'teams-vtt')
      ORDER BY meeting_date DESC
      LIMIT ${limit}
    `) as MeetingRow[];
  }

  console.log(`Found ${meetings.length} meetings to re-transcribe\n`);

  if (meetings.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (dryRun) {
    meetings.forEach((m, i) => {
      const sizeMB = (Number(m.recording_size_bytes) / 1024 / 1024).toFixed(0);
      console.log(`  ${i + 1}. id=${m.id} "${m.title}" (${sizeMB}MB recording)`);
    });
    return;
  }

  let processed = 0;
  let failed = 0;

  for (let i = 0; i < meetings.length; i++) {
    const m = meetings[i]!;
    const sizeMB = (Number(m.recording_size_bytes) / 1024 / 1024).toFixed(0);
    console.log(`[${i + 1}/${meetings.length}] id=${m.id} "${m.title}" (${sizeMB}MB)`);

    // Verify recording file exists
    if (!fs.existsSync(m.recording_path)) {
      console.log(`  [SKIP] Recording file not found: ${m.recording_path}`);
      failed++;
      continue;
    }

    try {
      await processMeeting(m);
      processed++;
    } catch (err: unknown) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR: ${msg}`);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results:`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
