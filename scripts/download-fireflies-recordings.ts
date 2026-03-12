/**
 * Download Fireflies recordings (audio MP3) for all meetings that don't have a local recording.
 *
 * Usage:
 *   DATABASE_URL=... FIREFLIES_API_KEY=... npx tsx scripts/download-fireflies-recordings.ts
 *
 * Downloads to /home/velo/meeting-recordings/YYYY/MM/<meetingId>.mp3
 * Updates meetings.recording_path and recording_size_bytes on success.
 */

import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';
import * as path from 'path';

const FIREFLIES_API_URL = 'https://api.fireflies.ai/graphql';
const RECORDINGS_BASE = process.env.MEETING_RECORDINGS_PATH || '/home/velo/meeting-recordings';

const sql = neon(process.env.DATABASE_URL!);
const API_KEY = process.env.FIREFLIES_API_KEY!;

if (!API_KEY) {
  console.error('FIREFLIES_API_KEY required');
  process.exit(1);
}

interface FFTranscript {
  id: string;
  title: string;
  audio_url: string | null;
}

async function fetchFirefliesAudioUrls(): Promise<FFTranscript[]> {
  // Fireflies API returns max ~100 at a time; paginate if needed
  const allTranscripts: FFTranscript[] = [];
  let hasMore = true;
  let skip = 0;
  const batchSize = 50;

  while (hasMore) {
    const query = `{ transcripts(limit: ${batchSize}, skip: ${skip}) { id title audio_url } }`;
    const response = await fetch(FIREFLIES_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`Fireflies API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const batch = (data.data?.transcripts ?? []) as FFTranscript[];
    allTranscripts.push(...batch);

    if (batch.length < batchSize) {
      hasMore = false;
    } else {
      skip += batchSize;
    }
  }

  return allTranscripts;
}

async function downloadFile(url: string, destPath: string): Promise<number> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(destPath, buffer);
  return buffer.length;
}

async function main() {
  console.log('Fetching Fireflies audio URLs...');
  const ffTranscripts = await fetchFirefliesAudioUrls();
  console.log(`Found ${ffTranscripts.length} Fireflies transcripts`);

  // Get meetings that need recordings
  const meetings = await sql`
    SELECT id, fireflies_id, meeting_date, recording_path
    FROM meetings
    WHERE source = 'fireflies'
      AND fireflies_id IS NOT NULL
      AND recording_path IS NULL
    ORDER BY meeting_date DESC
  `;

  console.log(`${meetings.length} Fireflies meetings need recordings`);

  // Build lookup: fireflies_id -> audio_url
  const audioMap = new Map<string, string>();
  for (const t of ffTranscripts) {
    if (t.audio_url) {
      audioMap.set(t.id, t.audio_url);
    }
  }

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const meeting of meetings) {
    const ffId = meeting.fireflies_id as string;
    const audioUrl = audioMap.get(ffId);

    if (!audioUrl) {
      console.log(`  [SKIP] Meeting ${meeting.id} (${ffId}) — no audio URL from Fireflies`);
      skipped++;
      continue;
    }

    const date = new Date(meeting.meeting_date as string);
    const yyyy = date.getFullYear().toString();
    const mm = (date.getMonth() + 1).toString().padStart(2, '0');
    const filePath = path.join(RECORDINGS_BASE, yyyy, mm, `${meeting.id}.mp3`);

    try {
      console.log(`  [DL] Meeting ${meeting.id} "${ffId}" -> ${filePath}`);
      const sizeBytes = await downloadFile(audioUrl, filePath);

      await sql`
        UPDATE meetings
        SET recording_path = ${filePath},
            recording_size_bytes = ${sizeBytes},
            updated_at = NOW()
        WHERE id = ${meeting.id}
      `;

      downloaded++;
      console.log(`  [OK] ${(sizeBytes / 1024 / 1024).toFixed(1)} MB`);
    } catch (err: unknown) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [FAIL] Meeting ${meeting.id}: ${msg}`);
    }
  }

  console.log(`\nDone: ${downloaded} downloaded, ${skipped} skipped, ${failed} failed`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
