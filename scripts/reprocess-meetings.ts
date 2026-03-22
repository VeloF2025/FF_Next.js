/**
 * Reprocess Teams meetings that have a joinUrl but are missing transcripts/recordings.
 * Re-fetches online meeting info, transcripts, recordings, and runs LLM enrichment.
 *
 * Usage:
 *   DATABASE_URL=... OPENAI_API_KEY=... npx tsx scripts/reprocess-meetings.ts [--dry-run] [--limit N]
 */

import { neon } from '@neondatabase/serverless';
import { fetchOnlineMeetingInfo, listTranscripts, downloadTranscriptContent, parseVttSpeakers } from '../src/lib/graph/transcripts';
import { listRecordings, downloadRecordingToDisk } from '../src/lib/graph/recordings';
import { processWithLLM } from '../src/lib/llm/meeting-processor';
import { graphFetch } from '../src/lib/graph/auth';

const sql = neon(process.env.DATABASE_URL!);

const TRANSCRIPT_INLINE_LIMIT = 500_000;
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]!, 10) : 999;

async function main() {
  // Find Teams meetings with joinUrl but missing transcript
  const meetings = await sql`
    SELECT id, title, meeting_date, join_url, organizer_email, organizer_name, duration,
           (raw_transcript IS NOT NULL) as has_transcript,
           (recording_path IS NOT NULL) as has_recording,
           (summary IS NOT NULL) as has_summary
    FROM meetings
    WHERE source = 'teams'
      AND join_url IS NOT NULL
      AND raw_transcript IS NULL
      AND NOT EXISTS (SELECT 1 FROM meeting_transcripts mt WHERE mt.meeting_id = meetings.id)
    ORDER BY meeting_date DESC
    LIMIT ${limit}
  `;

  console.log(`Found ${meetings.length} meetings to reprocess${dryRun ? ' (DRY RUN)' : ''}`);

  if (dryRun) {
    meetings.forEach((m: any) => console.log(`  ${m.id} ${m.meeting_date?.toString().slice(0, 10)} ${m.duration}min ${m.organizer_name} — ${m.title?.slice(0, 50)}`));
    return;
  }

  // We need to resolve organizer Graph user IDs. Build a lookup from email.
  const orgEmails = [...new Set(meetings.map((m: any) => m.organizer_email).filter(Boolean))];
  const userIdMap = new Map<string, string>();

  for (const email of orgEmails) {
    try {
      const resp = await graphFetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email as string)}?$select=id`);
      if (resp.ok) {
        const data = await resp.json();
        userIdMap.set((email as string).toLowerCase(), data.id);
      }
    } catch {
      // skip
    }
  }

  let processed = 0;
  let transcripts = 0;
  let recordings = 0;
  let summaries = 0;
  let failed = 0;

  for (const meeting of meetings) {
    const meetingId = meeting.id as number;
    const joinUrl = meeting.join_url as string;
    const orgEmail = (meeting.organizer_email as string)?.toLowerCase();
    const orgUserId = orgEmail ? userIdMap.get(orgEmail) : null;

    console.log(`\n[${meetingId}] ${meeting.title} (${meeting.meeting_date?.toString().slice(0, 10)})`);

    if (!orgUserId) {
      console.log(`  SKIP — no Graph user ID for organizer ${orgEmail}`);
      failed++;
      continue;
    }

    try {
      // 1. Resolve online meeting
      const meetingInfo = await fetchOnlineMeetingInfo(orgUserId, joinUrl);
      if (!meetingInfo?.id) {
        console.log(`  SKIP — no online meeting found for joinUrl`);
        failed++;
        continue;
      }

      // Update title from calendar subject if still generic
      if (meetingInfo.subject && (meeting.title as string).startsWith('Teams Meeting -')) {
        await sql`UPDATE meetings SET title = ${meetingInfo.subject}, updated_at = NOW() WHERE id = ${meetingId}`;
        console.log(`  Title: ${meetingInfo.subject}`);
      }

      // 2. Fetch transcript
      const transcriptList = await listTranscripts(orgUserId, meetingInfo.id);
      if (transcriptList.length > 0) {
        const vtt = await downloadTranscriptContent(orgUserId, meetingInfo.id, transcriptList[0]!.id);
        if (vtt.length <= TRANSCRIPT_INLINE_LIMIT) {
          await sql`UPDATE meetings SET raw_transcript = ${vtt}, updated_at = NOW() WHERE id = ${meetingId}`;
        } else {
          const speakerMap = JSON.stringify(parseVttSpeakers(vtt).slice(0, 50));
          await sql`
            INSERT INTO meeting_transcripts (meeting_id, format, content, speaker_map, created_at)
            VALUES (${meetingId}, 'vtt', ${vtt}, ${speakerMap}, NOW())
            ON CONFLICT (meeting_id) DO UPDATE SET content = EXCLUDED.content, speaker_map = EXCLUDED.speaker_map
          `;
        }
        transcripts++;
        console.log(`  Transcript: ${vtt.length} chars`);
      } else {
        console.log(`  Transcript: none available`);
      }

      // 3. Fetch recording
      const recordingList = await listRecordings(orgUserId, meetingInfo.id);
      if (recordingList.length > 0) {
        const { filePath, sizeBytes } = await downloadRecordingToDisk(orgUserId, meetingInfo.id, recordingList[0]!.id, meetingId);
        await sql`
          UPDATE meetings SET recording_path = ${filePath}, recording_size_bytes = ${sizeBytes}, updated_at = NOW()
          WHERE id = ${meetingId}
        `;
        recordings++;
        console.log(`  Recording: ${(sizeBytes / 1024 / 1024).toFixed(1)} MB`);
      } else {
        console.log(`  Recording: none available`);
      }

      // 4. LLM enrichment (re-run to get action items from transcript)
      await sql`UPDATE meetings SET processing_status = 'processing', updated_at = NOW() WHERE id = ${meetingId}`;
      await processWithLLM(meetingId);
      await sql`UPDATE meetings SET processing_status = 'completed', processed_at = NOW(), updated_at = NOW() WHERE id = ${meetingId}`;
      summaries++;
      console.log(`  LLM: processed`);

      processed++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED: ${msg}`);
      await sql`UPDATE meetings SET processing_status = 'failed', processing_error = ${msg}, updated_at = NOW() WHERE id = ${meetingId}`;
      failed++;
    }
  }

  console.log(`\nDone: ${processed} processed, ${transcripts} transcripts, ${recordings} recordings, ${summaries} summaries, ${failed} failed`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
