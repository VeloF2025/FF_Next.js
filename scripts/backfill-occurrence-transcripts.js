/**
 * Backfill: clean contaminated Teams transcripts (and their summaries) by OCCURRENCE.
 *
 * Companion to the fix in src/lib/graph/meeting-helpers.ts (PR #1966). A recurring
 * onlineMeeting's /transcripts endpoint returns artifacts for EVERY occurrence
 * (onlineMeetingId is the shared recurring thread id). The old capture path took
 * transcripts[0], so one occurrence's transcript was stored on every sibling — ~125
 * rows carry a transcript shared with >=1 other meeting (and a summary derived from it).
 *
 * Per contaminated row this script selects the artifact whose createdDateTime is closest
 * to the meeting start within a 2h window (same rule as selectArtifactForOccurrence):
 *   - a different artifact matches  -> REPLACE the transcript (re-summarise via resync)
 *   - the stored one already matches -> UNCHANGED (this row is the legit owner)
 *   - nothing matches / unresolvable -> CLEAR: remove the wrong transcript, reset the
 *     summary to the no-transcript stub, drop stale transcript-sourced action items.
 * Most contaminated rows are recurring-standup siblings that never had their own
 * transcript (confirmed: Graph onlineMeeting unresolvable AND Cortex 404), so CLEAR is
 * the correct end state — there is nothing to restore.
 *
 * TWO PHASES (so a flaky Graph resolve can never non-deterministically clear a
 * recoverable row — the plan you validate is exactly what gets written):
 *   1. DRY RUN (default): resolve every row against Graph (with retry/backoff) and
 *      write the decisions to a plan file. No DB writes. Re-run until skip+error = 0.
 *   2. --apply: replay that plan with DB-only writes (no Graph at all).
 *
 * Usage:
 *   node scripts/backfill-occurrence-transcripts.js              # dry run -> writes plan
 *   node scripts/backfill-occurrence-transcripts.js --apply      # replay plan (DB-only)
 *   node scripts/backfill-occurrence-transcripts.js --limit 200  # cap rows scanned
 *
 * Requires: DATABASE_URL, GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET
 *   (run from a fibreflow deploy env that has them, e.g. via `set -a; . .env.local`).
 *
 * NOTE: the older scripts/backfill-meeting-transcripts.js, scripts/reprocess-meetings.ts and
 *   scripts/backfill-teams-transcripts.ts were RETIRED (deleted) — they picked
 *   transcripts[0]/recordings[0] (and the first two used the dead neon() driver, the third a
 *   now-removed ON CONFLICT(meeting_id) upsert), so they carried the same contamination bug
 *   and would re-contaminate if revived. This script supersedes them.
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');

// The dry run resolves every row against Graph (flaky) and writes its decisions here;
// --apply replays this plan with DB-only writes (no Graph), so what you validate in the
// dry run is EXACTLY what gets applied — no re-resolution, no throttling non-determinism.
const PLAN_PATH = process.env.DUPFIX_PLAN_PATH || '/home/hein/Workspace/ff-dupfix-plan-20260614.json';

// Self-hosted Supabase Postgres (Neon retired 2026-04-18) — use pg.Pool directly,
// not the @neondatabase/serverless HTTP driver (which can't reach a plain PG host
// from a standalone script). ssl handling mirrors scripts/backfill-ai-ticket-summaries.ts.
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required (run from a fibreflow deploy env)');
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});

// Tagged-template adapter so `sql`...${v}...`` works like the neon drop-in:
// turns interpolations into $1..$N parameters and returns the rows array.
async function sql(strings, ...values) {
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
  const res = await pool.query(text, values);
  return res.rows;
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const INTERNAL_DOMAINS = (process.env.INTERNAL_EMAIL_DOMAINS || 'velocityfibre.co.za,blitzfibre.com').split(',');
const TRANSCRIPT_INLINE_LIMIT = 500_000;

// Mirrors OCCURRENCE_MATCH_WINDOW_MS in src/lib/graph/meeting-helpers.ts.
const OCCURRENCE_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 1000;
if (Number.isNaN(LIMIT) || LIMIT <= 0) throw new Error('--limit requires a positive integer');

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt) => Math.min(30_000, 1000 * 2 ** attempt);

/**
 * Graph fetch with retry/backoff. Throttling (429) and transient 5xx/network
 * errors are retried (honouring Retry-After) so resolution is DETERMINISTIC —
 * a transient 429 must never be mistaken for "no transcript exists" and cause a
 * legit row to be cleared.
 */
async function graphFetch(url, opts = {}, attempt = 0) {
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers };
  let resp;
  try {
    resp = await fetch(url, { ...opts, headers });
  } catch (err) {
    if (attempt < 5) { await sleep(backoff(attempt)); return graphFetch(url, opts, attempt + 1); }
    throw err;
  }
  if (resp.status === 401 && attempt < 5) {
    tokenCache = null;
    await sleep(backoff(attempt));
    return graphFetch(url, opts, attempt + 1);
  }
  if ((resp.status === 429 || resp.status >= 500) && attempt < 6) {
    const ra = parseInt(resp.headers.get('retry-after') || '', 10);
    await sleep(Number.isFinite(ra) ? ra * 1000 : backoff(attempt));
    return graphFetch(url, opts, attempt + 1);
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
  // OData string literals escape a single quote by doubling it; encodeURIComponent does
  // NOT encode ' — so a join URL containing one would break the $filter (and, here,
  // mis-classify the row as unresolvable → CLEAR). Double-then-encode.
  const odata = encodeURIComponent(joinUrl.replace(/'/g, "''"));
  const url = `${GRAPH_BASE}/users/${userId}/onlineMeetings?$filter=joinWebUrl eq '${odata}'`;
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

// The minimal no-transcript summary processWithLLM writes, so cleared rows match
// what the app produces for a meeting with no transcript (rather than a stale one).
const STUB_SUMMARY = JSON.stringify({
  suggested_title: '',
  overview: 'No transcript available for analysis.',
  keywords: [],
  outline: [],
  decisions: [],
  action_items: [],
});

/**
 * Clears a contaminated row: removes the wrong (sibling's) transcript, resets the
 * summary to the no-transcript stub, and drops the stale transcript-sourced action
 * items so nothing derived from the wrong transcript survives.
 */
async function clearMeeting(meeting) {
  await sql`
    UPDATE meetings
    SET raw_transcript    = NULL,
        summary           = ${STUB_SUMMARY},
        processing_status = 'completed',
        processed_at      = NOW(),
        updated_at        = NOW()
    WHERE id = ${meeting.id}
  `;
  await sql`DELETE FROM meeting_transcripts WHERE meeting_id = ${meeting.id} AND format = 'vtt'`;
  // Only PENDING transcript-sourced items — preserves any human-actioned item (status
  // moved off 'pending'). Mirrors the app's writeActionItems delete-before-reinsert set,
  // narrowed so a manually-actioned action item is never lost.
  await sql`
    DELETE FROM action_items
    WHERE meeting_id = ${meeting.id}
      AND (source = 'transcript' OR source IS NULL)
      AND status = 'pending'
  `;
}

async function applyTranscript(meeting, result) {
  if (result.action !== 'replace') return;
  const { vtt } = result;
  if (vtt.length <= TRANSCRIPT_INLINE_LIMIT) {
    await sql`UPDATE meetings SET raw_transcript = ${vtt}, updated_at = NOW() WHERE id = ${meeting.id}`;
    await sql`DELETE FROM meeting_transcripts WHERE meeting_id = ${meeting.id} AND format = 'vtt'`;
  } else {
    await sql`UPDATE meetings SET raw_transcript = NULL, updated_at = NOW() WHERE id = ${meeting.id}`;
    // meeting_transcripts has no UNIQUE on meeting_id (PK is `id`), so ON CONFLICT
    // (meeting_id) would error — delete the old vtt row(s) then insert fresh.
    await sql`DELETE FROM meeting_transcripts WHERE meeting_id = ${meeting.id} AND format = 'vtt'`;
    await sql`
      INSERT INTO meeting_transcripts (meeting_id, format, content, created_at)
      VALUES (${meeting.id}, 'vtt', ${vtt}, NOW())
    `;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function findContaminated() {
  // Rows whose transcript content (inline or spilled) is byte-identical to >=1 other meeting.
  return sql`
    WITH all_tx AS (
      -- meeting_date is a timestamp-without-time-zone storing the UTC wall-clock;
      -- to_char(...Z) hands it back as a UTC ISO string so the occurrence match
      -- compares UTC-to-UTC (node would otherwise parse a bare timestamp as SAST).
      SELECT id, organizer_email, participants, join_url, teams_call_record_id,
             to_char(meeting_date, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS meeting_date,
             title, md5(raw_transcript) AS tx_hash
      FROM meetings
      WHERE raw_transcript IS NOT NULL AND length(raw_transcript) > 500
      UNION ALL
      SELECT m.id, m.organizer_email, m.participants, m.join_url, m.teams_call_record_id,
             to_char(m.meeting_date, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
             m.title, md5(mt.content) AS tx_hash
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

// Phase 1 (default): resolve every row against Graph (with retries) and write a plan.
async function buildPlan() {
  console.log('\n=== Build plan (resolve + decide; NO DB writes) ===');
  const rows = await findContaminated();
  console.log(`Found ${rows.length} contaminated transcript rows across shared groups.\n`);

  const tally = { replace: 0, clear: 0, clear_unresolved: 0, unchanged: 0, skip: 0, error: 0 };
  const plan = [];

  for (let i = 0; i < rows.length; i++) {
    const m = rows[i];
    const tag = `[${m.id}] ${m.meeting_date} ${(m.organizer_email || '?')} grp=${m.group_size} tx=${short(m.tx_hash)}`;
    try {
      const resolved = await resolve(m);
      if (!resolved) {
        // No onlineMeeting resolves (recurring series gone; Cortex 404s too) — the
        // stored transcript is a contaminated sibling's and nothing exists to restore.
        tally.clear_unresolved++;
        plan.push({ id: m.id, action: 'clear', reason: 'unresolvable' });
        console.log(`${tag} — CLEAR (unresolvable — no transcript exists)`);
        continue;
      }
      const tx = await analyzeTranscript(m, resolved);
      if (tx.action === 'replace') {
        tally.replace++;
        plan.push({ id: m.id, action: 'replace', vtt: tx.vtt, artifactId: tx.artifactId });
        console.log(`${tag} — REPLACE -> artifact ${short(tx.artifactId)} @ ${tx.createdDateTime} (Δ${tx.deltaMin}m) new=${short(tx.correctHash)}`);
      } else if (tx.action === 'clear') {
        tally.clear++;
        plan.push({ id: m.id, action: 'clear', reason: tx.reason });
        console.log(`${tag} — CLEAR (fail-closed): ${tx.reason}`);
      } else if (tx.action === 'unchanged') {
        tally.unchanged++;
        plan.push({ id: m.id, action: 'unchanged', artifactId: tx.artifactId });
        console.log(`${tag} — unchanged (legit owner of artifact ${short(tx.artifactId)}, Δ${tx.deltaMin}m)`);
      } else {
        // Transient list/download failure that survived retries — record as skip so
        // --apply leaves the row untouched (never clear on an uncertain signal).
        tally.skip++;
        plan.push({ id: m.id, action: 'skip', reason: tx.reason });
        console.log(`${tag} — SKIP: ${tx.reason}`);
      }
    } catch (err) {
      tally.error++;
      plan.push({ id: m.id, action: 'skip', reason: `error:${err.message}` });
      console.log(`${tag} — ERROR: ${err.message}`);
    }
    if (i > 0 && i % 10 === 0) await sleep(800);
  }

  fs.writeFileSync(PLAN_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), tally, plan }));
  console.log('\n=== Plan summary ===');
  console.log(JSON.stringify(tally, null, 2));
  console.log(`\nPlan written: ${PLAN_PATH}`);
  if (tally.skip > 0 || tally.error > 0) {
    console.log(`⚠ ${tally.skip + tally.error} row(s) unresolved this pass — re-run the dry run until skip+error = 0 before --apply.`);
  } else {
    console.log('All rows decided (0 skip/0 error). Re-run with --apply to execute this exact plan.');
  }
}

// Phase 2 (--apply): replay the plan with DB-only writes. No Graph, fully deterministic.
async function applyPlan() {
  if (!fs.existsSync(PLAN_PATH)) throw new Error(`No plan at ${PLAN_PATH} — run the dry run first`);
  const { plan, generatedAt } = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'));
  console.log(`\n=== APPLY plan (${plan.length} rows; DB-only, no Graph) — built ${generatedAt || 'unknown'} ===`);
  const ageH = generatedAt ? (Date.now() - new Date(generatedAt).getTime()) / 3.6e6 : Infinity;
  if (ageH > 4) {
    console.log(`⚠ plan is ${ageH.toFixed(1)}h old — if the meetings table changed since (re-capture/resync), re-run the dry run before applying.`);
  }

  const tally = { replace: 0, clear: 0, unchanged: 0, skip: 0, error: 0 };
  const replaceIds = [];
  for (const e of plan) {
    try {
      if (e.action === 'clear') { await clearMeeting({ id: e.id }); tally.clear++; }
      else if (e.action === 'replace') { await applyTranscript({ id: e.id }, { action: 'replace', vtt: e.vtt }); replaceIds.push(e.id); tally.replace++; }
      else if (e.action === 'unchanged') { tally.unchanged++; }
      else { tally.skip++; }
    } catch (err) {
      tally.error++;
      console.log(`[${e.id}] APPLY ERROR: ${err.message}`);
    }
  }

  console.log('\n=== Apply summary ===');
  console.log(JSON.stringify(tally, null, 2));
  if (replaceIds.length) {
    console.log(`\nREPLACE meetingIds (corrected transcript, stale summary): ${replaceIds.join(', ')}`);
    console.log('Re-summarise via POST /api/meetings/<id>/resync (or let Stage 4 Cortex summaries supersede).');
  }
}

async function main() {
  return APPLY ? applyPlan() : buildPlan();
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('Fatal:', err);
    try { await pool.end(); } catch (e) { console.error('pool.end error:', e.message); }
    process.exit(1);
  });
