/**
 * Backfill script: fetch missing transcripts and recordings for Teams meetings
 *
 * For each meeting with a join_url but no transcript, attempts to:
 * 1. Resolve the onlineMeeting via Graph API (tries all participants)
 * 2. Fetch and store transcript (VTT)
 * 3. Fetch and store recording (MP4)
 *
 * Usage:
 *   node scripts/backfill-meeting-transcripts.js [--dry-run] [--limit N] [--min-duration N]
 *
 * Requires: DATABASE_URL, GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const sql = neon(process.env.DATABASE_URL);

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const RECORDINGS_BASE = process.env.MEETING_RECORDINGS_PATH || '/home/velo/meeting-recordings';
const INTERNAL_DOMAINS = (process.env.INTERNAL_EMAIL_DOMAINS || 'velocityfibre.co.za,blitzfibre.com').split(',');
const TRANSCRIPT_INLINE_LIMIT = 500_000;

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 50;
const minDurIdx = args.indexOf('--min-duration');
const MIN_DURATION = minDurIdx >= 0 ? parseInt(args[minDurIdx + 1], 10) : 2;

// Token cache
let tokenCache = null;

async function getToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 300_000) {
    return tokenCache.token;
  }
  const params = new URLSearchParams({
    client_id: process.env.GRAPH_CLIENT_ID,
    client_secret: process.env.GRAPH_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const resp = await fetch(
    `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() }
  );
  const data = await resp.json();
  if (!data.access_token) throw new Error('Failed to get Graph token: ' + JSON.stringify(data));
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

async function graphFetch(url, opts = {}) {
  const token = await getToken();
  const resp = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
  });
  if (resp.status === 401) {
    tokenCache = null;
    const freshToken = await getToken();
    return fetch(url, {
      ...opts,
      headers: { Authorization: `Bearer ${freshToken}`, 'Content-Type': 'application/json', ...opts.headers },
    });
  }
  return resp;
}

/** Resolve onlineMeeting ID from join URL via a specific user */
async function resolveOnlineMeeting(userId, joinUrl) {
  const encoded = encodeURIComponent(joinUrl);
  const url = `${GRAPH_BASE}/users/${userId}/onlineMeetings?$filter=joinWebUrl eq '${encoded}'`;
  const resp = await graphFetch(url);
  if (!resp.ok) return null;
  const data = await resp.json();
  const meeting = data.value?.[0];
  return meeting ? { id: meeting.id, subject: meeting.subject || null } : null;
}

/** Get internal Graph user IDs from participants JSON */
function getInternalUserIds(participants) {
  if (!Array.isArray(participants)) return [];
  const ids = [];
  for (const p of participants) {
    const email = (p.email || '').toLowerCase();
    const domain = email.split('@')[1];
    if (domain && INTERNAL_DOMAINS.includes(domain)) {
      ids.push(email);
    }
  }
  return ids;
}

/** Cache for email -> Graph user ID lookups */
const userIdCache = new Map();

async function getUserId(email) {
  if (userIdCache.has(email)) return userIdCache.get(email);
  const resp = await graphFetch(`${GRAPH_BASE}/users/${encodeURIComponent(email)}?$select=id`);
  if (!resp.ok) {
    userIdCache.set(email, null);
    return null;
  }
  const data = await resp.json();
  userIdCache.set(email, data.id || null);
  return data.id || null;
}

async function processMeeting(meeting) {
  const { id, title, join_url, participants, organizer_email, duration } = meeting;
  const prefix = `[${id}] ${(title || '').substring(0, 40)}`;

  // Build candidate list: organizer first
  const emails = [];
  if (organizer_email) emails.push(organizer_email.toLowerCase());
  for (const e of getInternalUserIds(participants)) {
    if (!emails.includes(e)) emails.push(e);
  }

  if (emails.length === 0) {
    console.log(`${prefix} — SKIP: no internal participants`);
    return { status: 'skip', reason: 'no_participants' };
  }

  // Try to resolve onlineMeeting
  let resolvedUserId = null;
  let meetingInfo = null;

  for (const email of emails) {
    const userId = await getUserId(email);
    if (!userId) continue;

    meetingInfo = await resolveOnlineMeeting(userId, join_url);
    if (meetingInfo?.id) {
      resolvedUserId = userId;
      break;
    }
  }

  if (!resolvedUserId || !meetingInfo?.id) {
    console.log(`${prefix} — SKIP: could not resolve onlineMeeting (tried ${emails.length} users)`);
    return { status: 'skip', reason: 'no_resolution' };
  }

  if (DRY_RUN) {
    console.log(`${prefix} — DRY RUN: would fetch transcript + recording (subject: ${meetingInfo.subject || 'n/a'})`);
    return { status: 'dry_run' };
  }

  // Update title from subject if available
  if (meetingInfo.subject && (title || '').startsWith('Teams Meeting -')) {
    await sql`UPDATE meetings SET title = ${meetingInfo.subject}, updated_at = NOW() WHERE id = ${id}`;
  }

  let gotTranscript = false;
  let gotRecording = false;

  // Fetch transcript
  try {
    const txResp = await graphFetch(`${GRAPH_BASE}/users/${resolvedUserId}/onlineMeetings/${meetingInfo.id}/transcripts`);
    if (txResp.ok) {
      const txData = await txResp.json();
      if (txData.value?.length > 0) {
        const txId = txData.value[0].id;
        const vttResp = await graphFetch(
          `${GRAPH_BASE}/users/${resolvedUserId}/onlineMeetings/${meetingInfo.id}/transcripts/${txId}/content?$format=text/vtt`,
          { headers: { Accept: 'text/vtt' } }
        );
        if (vttResp.ok) {
          const vtt = await vttResp.text();
          if (vtt.length <= TRANSCRIPT_INLINE_LIMIT) {
            await sql`UPDATE meetings SET raw_transcript = ${vtt}, updated_at = NOW() WHERE id = ${id}`;
          } else {
            // Parse speakers for spill
            await sql`
              INSERT INTO meeting_transcripts (meeting_id, format, content, created_at)
              VALUES (${id}, 'vtt', ${vtt}, NOW())
              ON CONFLICT (meeting_id) DO UPDATE SET content = EXCLUDED.content
            `;
          }
          gotTranscript = true;
          console.log(`${prefix} — transcript: ${(vtt.length / 1024).toFixed(0)}KB`);
        }
      }
    }
  } catch (err) {
    console.log(`${prefix} — transcript error: ${err.message}`);
  }

  // Fetch recording
  try {
    const recResp = await graphFetch(`${GRAPH_BASE}/users/${resolvedUserId}/onlineMeetings/${meetingInfo.id}/recordings`);
    if (recResp.ok) {
      const recData = await recResp.json();
      if (recData.value?.length > 0) {
        const recId = recData.value[0].id;
        const contentResp = await graphFetch(
          `${GRAPH_BASE}/users/${resolvedUserId}/onlineMeetings/${meetingInfo.id}/recordings/${recId}/content`
        );
        if (contentResp.ok) {
          const buffer = Buffer.from(await contentResp.arrayBuffer());
          const meetingDate = new Date(meeting.meeting_date);
          const year = meetingDate.getFullYear().toString();
          const month = String(meetingDate.getMonth() + 1).padStart(2, '0');
          const dir = path.join(RECORDINGS_BASE, year, month);
          fs.mkdirSync(dir, { recursive: true });
          const filePath = path.join(dir, `${id}.mp4`);
          fs.writeFileSync(filePath, buffer);

          await sql`
            UPDATE meetings
            SET recording_path = ${filePath},
                recording_size_bytes = ${buffer.length},
                updated_at = NOW()
            WHERE id = ${id}
          `;
          gotRecording = true;
          console.log(`${prefix} — recording: ${(buffer.length / 1024 / 1024).toFixed(1)}MB`);
        }
      }
    }
  } catch (err) {
    console.log(`${prefix} — recording error: ${err.message}`);
  }

  if (!gotTranscript && !gotRecording) {
    console.log(`${prefix} — RESOLVED but no transcript/recording available`);
    return { status: 'resolved_empty' };
  }

  return { status: 'success', transcript: gotTranscript, recording: gotRecording };
}

async function main() {
  console.log(`\n=== Meeting Transcript/Recording Backfill ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Limit: ${LIMIT} | Min duration: ${MIN_DURATION}min\n`);

  const candidates = await sql`
    SELECT id, title, join_url, participants, organizer_email, duration,
           meeting_date::text as meeting_date
    FROM meetings
    WHERE join_url IS NOT NULL
      AND raw_transcript IS NULL
      AND NOT EXISTS (SELECT 1 FROM meeting_transcripts mt WHERE mt.meeting_id = meetings.id)
      AND recording_path IS NULL
      AND duration >= ${MIN_DURATION}
    ORDER BY meeting_date DESC
    LIMIT ${LIMIT}
  `;

  console.log(`Found ${candidates.length} candidates\n`);

  const results = { success: 0, skip: 0, dry_run: 0, resolved_empty: 0, error: 0 };

  for (let i = 0; i < candidates.length; i++) {
    const meeting = candidates[i];
    try {
      const result = await processMeeting(meeting);
      results[result.status] = (results[result.status] || 0) + 1;
    } catch (err) {
      console.log(`[${meeting.id}] ERROR: ${err.message}`);
      results.error++;
    }

    // Rate limit: small delay between meetings
    if (i > 0 && i % 10 === 0) {
      console.log(`\n--- Progress: ${i}/${candidates.length} ---\n`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\n=== Results ===`);
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
