/**
 * Backfill: re-key contaminated Teams transcripts/recordings by OCCURRENCE.
 *
 * Companion to the fix in src/lib/graph/meeting-helpers.ts (PR #1966). A recurring
 * onlineMeeting's /transcripts and /recordings endpoints return artifacts for EVERY
 * occurrence (onlineMeetingId is the shared recurring thread id). The old capture
 * path took transcripts[0]/recordings[0], so one occurrence's media was stored on
 * every sibling — ~125 rows carry a transcript shared with >=1 other meeting.
 *
 * This script finds those contaminated rows and, per occurrence, selects the artifact
 * whose createdDateTime is closest to the meeting start within a 2h window (the same
 * rule as selectArtifactForOccurrence), then re-stores the correct transcript (and,
 * with --recordings, the correct recording). It FAILS CLOSED: when no artifact matches
 * the occurrence window, the contaminated (sibling's) transcript is CLEARED rather than
 * left wrong.
 *
 * DRY RUN IS THE DEFAULT. Nothing is written without --apply.
 *
 * Usage:
 *   node scripts/backfill-occurrence-transcripts.js                 # dry run (default)
 *   node scripts/backfill-occurrence-transcripts.js --apply         # re-key transcripts
 *   node scripts/backfill-occurrence-transcripts.js --apply --recordings  # + recordings
 *   node scripts/backfill-occurrence-transcripts.js --limit 200     # cap rows scanned
 *
 * Requires: DATABASE_URL, GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET
 *   (run from a fibreflow deploy env that has them, e.g. via `set -a; . .env.local`).
 *
 * NOTE: scripts/backfill-meeting-transcripts.js still picks transcripts[0]/recordings[0]
 *   (lines ~169/201) — it has the SAME bug and will re-contaminate if re-run. Fix or
 *   retire it before using it again.
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Self-hosted Supabase Postgres (Neon retired 2026-04-18) — use pg.Pool directly,
// not the @neondatabase/serverless HTTP driver (which can't reach a plain PG host
// from a standalone script). ssl handling mirrors scripts/backfill-ai-ticket-summaries.ts.
const DATABASE_URL = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL && DATABASE_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});

// Tagged-template adapter so `sql`...${v}...`` works like the neon drop-in:
// turns interpolations into $1..$N parameters and returns the rows array.
async function sql(strings, ...values) {
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
  const res = await pool.query(text, values);
  return res.rows;
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const RECORDINGS_BASE = process.env.MEETING_RECORDINGS_PATH || '/home/velo/meeting-recordings';
const INTERNAL_DOMAINS = (process.env.INTERNAL_EMAIL_DOMAINS || 'velocityfibre.co.za,blitzfibre.com').split(',');
const TRANSCRIPT_INLINE_LIMIT = 500_000;

// Mirrors OCCURRENCE_MATCH_WINDOW_MS in src/lib/graph/meeting-helpers.ts.
const OCCURRENCE_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DO_RECORDINGS = args.includes('--recordings');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 1000;

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const short = (s) => (s ? String(s).slice(0, 10) : 'n/a');

// ── Self-contained Graph client (mirrors backfill-meeting-transcripts.js) ─────
let tokenCache = null;
async function getToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 300_000) return tokenCache.token;
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
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers };
  const resp = await fetch(url, { ...opts, headers });
  if (resp.status === 401) {
    tokenCache = null;
    const fresh = await getToken();
    return fetch(url, { ...opts, headers: { ...headers, Authorization: `Bearer ${fresh}` } });
  }
  return resp;
}

const userIdCache = new Map();
async function getUserId(email) {
  if (userIdCache.has(email)) return userIdCache.get(email);
  const resp = await graphFetch(`${GRAPH_BASE}/users/${encodeURIComponent(email)}?$select=id`);
  const id = resp.ok ? (await resp.json()).id || null : null;
  userIdCache.set(email, id);
  return id;
}
async function resolveOnlineMeeting(userId, joinUrl) {
  const url = `${GRAPH_BASE}/users/${userId}/onlineMeetings?$filter=joinWebUrl eq '${encodeURIComponent(joinUrl)}'`;
  const resp = await graphFetch(url);
  if (!resp.ok) return null;
  const meeting = (await resp.json()).value?.[0];
  return meeting ? { id: meeting.id } : null;
}

/** Closest artifact within the occurrence window — mirrors selectArtifactForOccurrence. */
function selectArtifactForOccurrence(artifacts, occurrenceStart) {
  const startMs = new Date(occurrenceStart).getTime();
  if (Number.isNaN(startMs)) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const a of artifacts) {
    const ms = new Date(a.createdDateTime).getTime();
    if (Number.isNaN(ms)) continue;
    const delta = Math.abs(ms - startMs);
    if (delta <= OCCURRENCE_MATCH_WINDOW_MS && delta < bestDelta) {
      best = a;
      bestDelta = delta;
    }
  }
  return best ? { ...best, deltaMs: bestDelta } : null;
}

/** Build the candidate user list for a meeting: organizer first, then internal participants. */
function candidateEmails(meeting) {
  const emails = [];
  if (meeting.organizer_email) emails.push(meeting.organizer_email.toLowerCase());
  if (Array.isArray(meeting.participants)) {
    for (const p of meeting.participants) {
      const email = (p.email || '').toLowerCase();
      const domain = email.split('@')[1];
      if (domain && INTERNAL_DOMAINS.includes(domain) && !emails.includes(email)) emails.push(email);
    }
  }
  return emails;
}

async function resolve(meeting) {
  for (const email of candidateEmails(meeting)) {
    const userId = await getUserId(email);
    if (!userId) continue;
    const info = await resolveOnlineMeeting(userId, meeting.join_url);
    if (info?.id) return { userId, onlineMeetingId: info.id };
  }
  return null;
}

// ── Per-row analysis ──────────────────────────────────────────────────────────
async function analyzeTranscript(meeting, resolved) {
  const listResp = await graphFetch(
    `${GRAPH_BASE}/users/${resolved.userId}/onlineMeetings/${resolved.onlineMeetingId}/transcripts`
  );
  if (!listResp.ok) return { action: 'skip', reason: `transcripts_list_${listResp.status}` };
  const artifacts = (await listResp.json()).value || [];
  const pick = selectArtifactForOccurrence(artifacts, meeting.meeting_date);

  if (!pick) {
    return { action: 'clear', reason: `no_artifact_in_window (candidates=${artifacts.length})` };
  }

  const vttResp = await graphFetch(
    `${GRAPH_BASE}/users/${resolved.userId}/onlineMeetings/${resolved.onlineMeetingId}/transcripts/${pick.id}/content?$format=text/vtt`,
    { headers: { Accept: 'text/vtt' } }
  );
  if (!vttResp.ok) return { action: 'skip', reason: `transcript_download_${vttResp.status}` };
  const vtt = await vttResp.text();
  const correctHash = md5(vtt);
  const deltaMin = Math.round(pick.deltaMs / 60000);

  if (correctHash === meeting.tx_hash) {
    return { action: 'unchanged', artifactId: pick.id, createdDateTime: pick.createdDateTime, deltaMin };
  }
  return { action: 'replace', artifactId: pick.id, createdDateTime: pick.createdDateTime, deltaMin, vtt, correctHash };
}

async function applyTranscript(meeting, result) {
  if (result.action === 'clear') {
    await sql`UPDATE meetings SET raw_transcript = NULL, updated_at = NOW() WHERE id = ${meeting.id}`;
    await sql`DELETE FROM meeting_transcripts WHERE meeting_id = ${meeting.id} AND format = 'vtt'`;
    return;
  }
  if (result.action !== 'replace') return;
  const { vtt } = result;
  if (vtt.length <= TRANSCRIPT_INLINE_LIMIT) {
    await sql`UPDATE meetings SET raw_transcript = ${vtt}, updated_at = NOW() WHERE id = ${meeting.id}`;
    await sql`DELETE FROM meeting_transcripts WHERE meeting_id = ${meeting.id} AND format = 'vtt'`;
  } else {
    await sql`UPDATE meetings SET raw_transcript = NULL, updated_at = NOW() WHERE id = ${meeting.id}`;
    await sql`
      INSERT INTO meeting_transcripts (meeting_id, format, content, created_at)
      VALUES (${meeting.id}, 'vtt', ${vtt}, NOW())
      ON CONFLICT (meeting_id) DO UPDATE SET content = EXCLUDED.content
    `;
  }
}

async function applyRecording(meeting, resolved) {
  const listResp = await graphFetch(
    `${GRAPH_BASE}/users/${resolved.userId}/onlineMeetings/${resolved.onlineMeetingId}/recordings`
  );
  if (!listResp.ok) return { action: 'skip', reason: `recordings_list_${listResp.status}` };
  const pick = selectArtifactForOccurrence((await listResp.json()).value || [], meeting.meeting_date);
  if (!pick) {
    if (APPLY) {
      await sql`UPDATE meetings SET recording_path = NULL, recording_size_bytes = NULL, updated_at = NOW() WHERE id = ${meeting.id}`;
    }
    return { action: 'clear', reason: 'no_recording_in_window' };
  }
  if (!APPLY) return { action: 'replace', artifactId: pick.id, createdDateTime: pick.createdDateTime };

  const contentResp = await graphFetch(
    `${GRAPH_BASE}/users/${resolved.userId}/onlineMeetings/${resolved.onlineMeetingId}/recordings/${pick.id}/content`
  );
  if (!contentResp.ok) return { action: 'skip', reason: `recording_download_${contentResp.status}` };
  const buffer = Buffer.from(await contentResp.arrayBuffer());
  const d = new Date(meeting.meeting_date);
  const dir = path.join(RECORDINGS_BASE, d.getFullYear().toString(), String(d.getMonth() + 1).padStart(2, '0'));
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${meeting.id}.mp4`);
  fs.writeFileSync(filePath, buffer);
  await sql`
    UPDATE meetings SET recording_path = ${filePath}, recording_size_bytes = ${buffer.length}, updated_at = NOW()
    WHERE id = ${meeting.id}
  `;
  return { action: 'replace', artifactId: pick.id, sizeMB: (buffer.length / 1048576).toFixed(1) };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function findContaminated() {
  // Rows whose transcript content (inline or spilled) is byte-identical to >=1 other meeting.
  return sql`
    WITH all_tx AS (
      SELECT id, organizer_email, participants, join_url, teams_call_record_id,
             meeting_date::text AS meeting_date, title, md5(raw_transcript) AS tx_hash
      FROM meetings
      WHERE raw_transcript IS NOT NULL AND length(raw_transcript) > 500
      UNION ALL
      SELECT m.id, m.organizer_email, m.participants, m.join_url, m.teams_call_record_id,
             m.meeting_date::text, m.title, md5(mt.content) AS tx_hash
      FROM meetings m JOIN meeting_transcripts mt ON mt.meeting_id = m.id
      WHERE mt.format = 'vtt' AND length(mt.content) > 500
    ),
    dups AS (SELECT tx_hash FROM all_tx GROUP BY tx_hash HAVING count(DISTINCT id) > 1)
    SELECT a.*, (SELECT count(DISTINCT id) FROM all_tx x WHERE x.tx_hash = a.tx_hash) AS group_size
    FROM all_tx a JOIN dups d ON a.tx_hash = d.tx_hash
    ORDER BY a.tx_hash, a.meeting_date
    LIMIT ${LIMIT}
  `;
}

async function main() {
  console.log('\n=== Occurrence transcript/recording re-key backfill ===');
  console.log(`Mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'} | recordings: ${DO_RECORDINGS} | limit: ${LIMIT}\n`);

  const rows = await findContaminated();
  console.log(`Found ${rows.length} contaminated transcript rows across shared groups.\n`);

  const tally = { replace: 0, clear: 0, unchanged: 0, skip: 0, error: 0, rec_replace: 0, rec_clear: 0, rec_skip: 0 };

  for (let i = 0; i < rows.length; i++) {
    const m = rows[i];
    const tag = `[${m.id}] ${m.meeting_date} ${(m.organizer_email || '?')} grp=${m.group_size} tx=${short(m.tx_hash)}`;
    try {
      const resolved = await resolve(m);
      if (!resolved) {
        tally.skip++;
        console.log(`${tag} — SKIP: onlineMeeting unresolved`);
        continue;
      }
      const tx = await analyzeTranscript(m, resolved);
      if (tx.action === 'replace') {
        tally.replace++;
        console.log(`${tag} — REPLACE -> artifact ${short(tx.artifactId)} @ ${tx.createdDateTime} (Δ${tx.deltaMin}m) new=${short(tx.correctHash)}`);
        if (APPLY) await applyTranscript(m, tx);
      } else if (tx.action === 'clear') {
        tally.clear++;
        console.log(`${tag} — CLEAR (fail-closed): ${tx.reason}`);
        if (APPLY) await applyTranscript(m, tx);
      } else if (tx.action === 'unchanged') {
        tally.unchanged++;
        console.log(`${tag} — unchanged (already owns artifact ${short(tx.artifactId)}, Δ${tx.deltaMin}m)`);
      } else {
        tally.skip++;
        console.log(`${tag} — SKIP: ${tx.reason}`);
      }

      if (DO_RECORDINGS && (tx.action === 'replace' || tx.action === 'clear')) {
        const rec = await applyRecording(m, resolved);
        if (rec.action === 'replace') { tally.rec_replace++; console.log(`        recording REPLACE -> ${short(rec.artifactId)}${rec.sizeMB ? ` (${rec.sizeMB}MB)` : ''}`); }
        else if (rec.action === 'clear') { tally.rec_clear++; console.log(`        recording CLEAR: ${rec.reason}`); }
        else { tally.rec_skip++; console.log(`        recording SKIP: ${rec.reason}`); }
      }
    } catch (err) {
      tally.error++;
      console.log(`${tag} — ERROR: ${err.message}`);
    }
    if (i > 0 && i % 10 === 0) await new Promise((r) => setTimeout(r, 800));
  }

  console.log('\n=== Summary ===');
  console.log(JSON.stringify(tally, null, 2));
  if (!APPLY) console.log('\nDRY RUN — nothing written. Re-run with --apply (and optionally --recordings) to execute.');
  if (APPLY && (tally.replace > 0 || tally.clear > 0)) {
    console.log('\nNOTE: re-keyed/cleared rows now have a transcript that differs from their stale `meetings.summary`.');
    console.log('Re-summarize those meetingIds (or let the Cortex machine-published summaries supersede in Stage 4).');
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('Fatal:', err);
    try { await pool.end(); } catch { /* already closing */ }
    process.exit(1);
  });
