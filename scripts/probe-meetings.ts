/**
 * Probe how many Teams meetings with joinUrl can be resolved to an onlineMeeting.
 * Tests a sample to estimate yield before running the full reprocess.
 */
import { neon } from '@neondatabase/serverless';
import { fetchOnlineMeetingInfo } from '../src/lib/graph/transcripts';
import { listTranscripts, listRecordings } from '../src/lib/graph/transcripts';
import { graphFetch } from '../src/lib/graph/auth';

const sql = neon(process.env.DATABASE_URL || '');

async function main() {
  const meetings = await sql`
    SELECT id, join_url, organizer_email, title, meeting_date, duration
    FROM meetings
    WHERE source = 'teams' AND join_url IS NOT NULL
      AND raw_transcript IS NULL
      AND NOT EXISTS (SELECT 1 FROM meeting_transcripts mt WHERE mt.meeting_id = meetings.id)
    ORDER BY meeting_date DESC
  `;

  console.log(`Total meetings to check: ${meetings.length}`);

  // Resolve organizer user IDs
  const orgEmails = [...new Set(meetings.map((m: any) => m.organizer_email).filter(Boolean))] as string[];
  const userMap = new Map<string, string>();
  for (const email of orgEmails) {
    try {
      const resp = await graphFetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}?$select=id`);
      if (resp.ok) userMap.set(email.toLowerCase(), (await resp.json()).id);
    } catch { /* skip */ }
  }
  console.log(`Resolved ${userMap.size} organizer user IDs out of ${orgEmails.length} unique emails`);

  let found = 0;
  let notFound = 0;
  let noUserId = 0;
  let hasTranscript = 0;
  let hasRecording = 0;

  for (const m of meetings) {
    const email = (m.organizer_email as string)?.toLowerCase();
    const userId = email ? userMap.get(email) : null;
    if (!userId) { noUserId++; continue; }

    const info = await fetchOnlineMeetingInfo(userId, m.join_url as string);
    if (info?.id) {
      found++;
      const transcripts = await listTranscripts(userId, info.id);
      const recordings = await listRecordings(userId, info.id);
      if (transcripts.length > 0) hasTranscript++;
      if (recordings.length > 0) hasRecording++;
      console.log(`  FOUND ${m.id} ${(m.meeting_date as string)?.toString().slice(0, 10)} ${m.duration}min — "${info.subject}" T:${transcripts.length} R:${recordings.length}`);
    } else {
      notFound++;
    }
  }

  console.log(`\nResults:`);
  console.log(`  Resolvable online meetings: ${found}`);
  console.log(`  With transcripts: ${hasTranscript}`);
  console.log(`  With recordings: ${hasRecording}`);
  console.log(`  Not resolvable (Meet Now / chat calls): ${notFound}`);
  console.log(`  No organizer user ID: ${noUserId}`);
}

main().catch(e => { console.error(e); process.exit(1); });
