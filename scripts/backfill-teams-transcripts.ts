#!/usr/bin/env node
/**
 * Backfill Teams Meeting Transcripts & Recordings
 *
 * Finds all Teams meetings that have a join_url but no raw_transcript,
 * and re-attempts transcript/recording fetch. Unlike the original processor,
 * this tries EVERY participant in the tenant (not just the organizer) when
 * looking up the onlineMeeting via Graph API.
 *
 * Usage:
 *   npx tsx scripts/backfill-teams-transcripts.ts [--dry-run] [--limit N]
 */

import { neon } from '@neondatabase/serverless';
import { getGraphAccessToken } from '../src/lib/graph/auth';
import { fetchOnlineMeetingId, listTranscripts, downloadTranscriptContent, parseVttSpeakers } from '../src/lib/graph/transcripts';
import { listRecordings, downloadRecordingToDisk } from '../src/lib/graph/recordings';
import { processWithLLM } from '../src/lib/llm/meeting-processor';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const TRANSCRIPT_INLINE_LIMIT = 500_000;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] || '10', 10) : 999;

interface MeetingRow {
  id: number;
  title: string;
  meeting_date: string;
  join_url: string;
  organizer_email: string | null;
  teams_call_record_id: string;
  participants: string;
}

interface Participant {
  name: string;
  email: string;
  displayName: string;
}

/**
 * Resolve a tenant email to a Graph user ID.
 * Uses the /users/{email} endpoint.
 */
async function resolveGraphUserId(email: string): Promise<string | null> {
  const token = await getGraphAccessToken();
  const response = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(email)}?$select=id`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!response.ok) return null;
  const data = await response.json();
  return (data.id as string) || null;
}

/**
 * Try each participant to find the onlineMeeting and fetch transcript/recording.
 * Returns true if transcript was found and stored.
 */
async function tryFetchTranscriptAndRecording(
  meeting: MeetingRow,
  participants: Participant[]
): Promise<{ transcriptStored: boolean; recordingStored: boolean }> {
  // Collect all tenant emails to try (organizer first, then others)
  const emailsToTry: string[] = [];

  if (meeting.organizer_email) {
    emailsToTry.push(meeting.organizer_email);
  }

  for (const p of participants) {
    if (p.email && !emailsToTry.includes(p.email)) {
      emailsToTry.push(p.email);
    }
  }

  // Only try velocityfibre.co.za and blitzfibre.com emails (in our tenant)
  const tenantEmails = emailsToTry.filter(
    e => e.endsWith('@velocityfibre.co.za') || e.endsWith('@blitzfibre.com')
  );

  if (tenantEmails.length === 0) {
    console.log(`  [SKIP] No tenant emails found for meeting ${meeting.id}`);
    return { transcriptStored: false, recordingStored: false };
  }

  let transcriptStored = false;
  let recordingStored = false;

  for (const email of tenantEmails) {
    const userId = await resolveGraphUserId(email);
    if (!userId) {
      console.log(`  [SKIP] Could not resolve Graph user for ${email}`);
      continue;
    }

    const onlineMeetingId = await fetchOnlineMeetingId(userId, meeting.join_url);
    if (!onlineMeetingId) {
      continue;
    }

    console.log(`  [FOUND] onlineMeeting via ${email} (userId: ${userId.substring(0, 8)}...)`);

    // Fetch transcript
    if (!transcriptStored) {
      const transcripts = await listTranscripts(userId, onlineMeetingId);
      if (transcripts.length > 0) {
        const vtt = await downloadTranscriptContent(userId, onlineMeetingId, transcripts[0]!.id);
        console.log(`  [TRANSCRIPT] ${vtt.length} bytes`);

        if (!dryRun) {
          if (vtt.length <= TRANSCRIPT_INLINE_LIMIT) {
            await sql`UPDATE meetings SET raw_transcript = ${vtt}, updated_at = NOW() WHERE id = ${meeting.id}`;
          } else {
            const speakerMap = JSON.stringify(parseVttSpeakers(vtt).slice(0, 50));
            await sql`
              INSERT INTO meeting_transcripts (meeting_id, format, content, speaker_map, created_at)
              VALUES (${meeting.id}, 'vtt', ${vtt}, ${speakerMap}, NOW())
              ON CONFLICT (meeting_id) DO UPDATE SET content = EXCLUDED.content, speaker_map = EXCLUDED.speaker_map
            `;
          }
          transcriptStored = true;
        } else {
          transcriptStored = true;
        }
      } else {
        console.log(`  [NO TRANSCRIPT] No transcripts available via ${email}`);
      }
    }

    // Fetch recording
    if (!recordingStored) {
      const recordings = await listRecordings(userId, onlineMeetingId);
      if (recordings.length > 0) {
        console.log(`  [RECORDING] Found ${recordings.length} recording(s)`);
        if (!dryRun) {
          try {
            const { filePath, sizeBytes } = await downloadRecordingToDisk(
              userId, onlineMeetingId, recordings[0]!.id, meeting.id
            );
            await sql`
              UPDATE meetings
              SET recording_path = ${filePath}, recording_size_bytes = ${sizeBytes}, updated_at = NOW()
              WHERE id = ${meeting.id}
            `;
            recordingStored = true;
            console.log(`  [RECORDING] Saved ${sizeBytes} bytes to ${filePath}`);
          } catch (err: unknown) {
            console.error(`  [RECORDING ERROR] ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          recordingStored = true;
        }
      }
    }

    // If we found transcript or recording, no need to try more participants
    if (transcriptStored || recordingStored) break;
  }

  return { transcriptStored, recordingStored };
}

async function main() {
  console.log(`\nTeams Transcript Backfill ${dryRun ? '(DRY RUN)' : ''}`);
  console.log(`Limit: ${limit} meetings\n`);

  // Verify Graph auth works
  try {
    await getGraphAccessToken();
    console.log('Graph API auth: OK\n');
  } catch (err: unknown) {
    console.error('Graph API auth failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Find meetings to backfill
  const meetings = await sql`
    SELECT id, title, meeting_date::text, join_url, organizer_email,
           teams_call_record_id, participants::text
    FROM meetings
    WHERE source = 'teams'
      AND join_url IS NOT NULL
      AND raw_transcript IS NULL
      AND NOT EXISTS (SELECT 1 FROM meeting_transcripts mt WHERE mt.meeting_id = meetings.id)
    ORDER BY meeting_date DESC
    LIMIT ${limit}
  ` as MeetingRow[];

  console.log(`Found ${meetings.length} meetings to process\n`);

  let transcriptsFound = 0;
  let recordingsFound = 0;
  let noTranscriptAvailable = 0;
  let errors = 0;

  for (let i = 0; i < meetings.length; i++) {
    const m = meetings[i]!;
    const participants: Participant[] = JSON.parse(m.participants || '[]');
    console.log(`[${i + 1}/${meetings.length}] Meeting ${m.id}: ${m.title} (${m.meeting_date})`);

    try {
      const result = await tryFetchTranscriptAndRecording(m, participants);
      if (result.transcriptStored) transcriptsFound++;
      if (result.recordingStored) recordingsFound++;
      if (!result.transcriptStored && !result.recordingStored) noTranscriptAvailable++;
    } catch (err: unknown) {
      errors++;
      console.error(`  [ERROR] ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results:`);
  console.log(`  Processed:    ${meetings.length}`);
  console.log(`  Transcripts:  ${transcriptsFound}`);
  console.log(`  Recordings:   ${recordingsFound}`);
  console.log(`  No data:      ${noTranscriptAvailable}`);
  console.log(`  Errors:       ${errors}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
