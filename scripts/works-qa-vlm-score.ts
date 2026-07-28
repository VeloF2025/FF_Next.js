/**
 * Works-QA VLM scoring — headless CLI.
 *
 * Runs the VLM over pole_qa_photos slots that have a photo but no score yet and
 * no human decision, writing {valid,confidence,feedback,scored:true} into
 * vlm_results[slot]. The ingest cron runs this AFTER works-qa-sync.ts so synced
 * photos get scored. Skips already-scored and humanly approved/snagged slots.
 *
 *   Phase 1 (fresh):   all eligible slots on rows updated within --fresh-hours.
 *   Phase 2 (backlog): up to --limit eligible slots, oldest updated_at first.
 *
 * Usage:
 *   DATABASE_URL=… tsx scripts/works-qa-vlm-score.ts [--limit 500] [--concurrency 4] [--fresh-hours 3] [--project <uuid>]
 */
import { Pool } from 'pg';
import { validatePhotoWithVlm, isVlmFallback } from '@/modules/works-qa/services/worksQaVlmService';
import { eligibleSlotsForRow, type ScorableRow } from '@/modules/works-qa/services/worksQaScoreEligibility';
import { absolutePhotoUrl } from '@/modules/works-qa/utils/photo-url';
import { vlmProxyKeyParam } from '@/lib/vlm/photoProxyAuth';
import { getSlotMeta } from '@/modules/works-qa/utils/slot-keys';

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Parse a positive-number flag, failing loudly on a typo instead of silently
// coercing NaN (which would make Array.from({length: NaN}) run zero workers).
function numArg(flag: string, def: number): number {
  const raw = argVal(flag);
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`ERROR: ${flag} must be a positive number (got "${raw}")`);  // eslint-disable-line no-console
    process.exit(1);
  }
  return n;
}

const SCORABLE_COLUMNS = `
  id,
  civil_step_01_key, civil_step_02_key, civil_step_03_key, civil_step_04_key,
  civil_step_05_key, civil_step_06_key, civil_step_07_key, civil_step_08_key,
  optical_dome_01_key, optical_dome_02_key, optical_dome_03_key, optical_dome_04_key,
  optical_dome_05_key, optical_dome_06_key, optical_dome_07_key, optical_dome_08_key,
  main_joint_11_key, main_joint_12_key, main_joint_13_key,
  main_joint_14_key, main_joint_15_key, main_joint_16_key,
  vlm_results, slot_approvals, civil_approved, dome_approved, joint_approved
`;

// SQL predicate: the row plausibly has something to score — at least one photo
// slot filled AND not every discipline human-approved. Excludes empty and
// fully-approved (dormant) rows so they can't crowd the oldest-first backlog
// scan forever (final per-slot eligibility is still enforced by
// eligibleSlotsForRow). The approval columns are nullable (DEFAULT false), so
// COALESCE guards against a NULL turning the whole AND into SQL NULL and
// silently dropping a row that still has eligible slots.
const HAS_CANDIDATE_SLOT = `
  num_nonnulls(
    civil_step_01_key, civil_step_02_key, civil_step_03_key, civil_step_04_key,
    civil_step_05_key, civil_step_06_key, civil_step_07_key, civil_step_08_key,
    optical_dome_01_key, optical_dome_02_key, optical_dome_03_key, optical_dome_04_key,
    optical_dome_05_key, optical_dome_06_key, optical_dome_07_key, optical_dome_08_key,
    main_joint_11_key, main_joint_12_key, main_joint_13_key,
    main_joint_14_key, main_joint_15_key, main_joint_16_key
  ) > 0
  AND NOT (COALESCE(civil_approved, false) AND COALESCE(dome_approved, false) AND COALESCE(joint_approved, false))
`;

interface ScoreTask { rowId: string; slotKey: string; photoKey: string; }

function tasksForRows(rows: ScorableRow[]): ScoreTask[] {
  const tasks: ScoreTask[] = [];
  for (const row of rows) {
    for (const { slotKey, photoKey } of eligibleSlotsForRow(row)) {
      tasks.push({ rowId: row.id, slotKey, photoKey });
    }
  }
  return tasks;
}

async function scoreOne(pool: Pool, task: ScoreTask): Promise<'scored' | 'skipped' | 'errored'> {
  const meta = getSlotMeta(task.slotKey);
  if (!meta) return 'skipped';
  try {
    const result = await validatePhotoWithVlm({
      photoUrl: absolutePhotoUrl(task.photoKey, undefined, vlmProxyKeyParam()),
      slotKey: task.slotKey,
      stepLabel: meta.label,
      vlmCheck: meta.vlmCheck,
    });
    // VLM produced no real verdict → leave unscored (retry next run), never
    // persist a fallback as a real score. Sentinel lives in worksQaVlmService.
    if (isVlmFallback(result)) {
      return 'errored';
    }
    const entry = JSON.stringify({ [task.slotKey]: { ...result, scored: true } });
    await pool.query(
      `UPDATE pole_qa_photos
         SET vlm_results = vlm_results || $1::jsonb, updated_at = NOW()
       WHERE id = $2::uuid`,
      [entry, task.rowId],
    );
    return 'scored';
  } catch (err) {
    console.error(`  score failed row=${task.rowId} slot=${task.slotKey}: ${err instanceof Error ? err.message : String(err)}`);  // eslint-disable-line no-console
    return 'errored';
  }
}

async function runPool(pool: Pool, tasks: ScoreTask[], concurrency: number) {
  let scored = 0, skipped = 0, errored = 0, next = 0;
  async function worker() {
    while (next < tasks.length) {
      const task = tasks[next++]!;
      const outcome = await scoreOne(pool, task);
      if (outcome === 'scored') scored++; else if (outcome === 'skipped') skipped++; else errored++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return { scored, skipped, errored };
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('ERROR: DATABASE_URL not set'); process.exit(1); }  // eslint-disable-line no-console

  // Without VLM_PROXY_SECRET every photo URL we hand vLLM is unauthorised: the
  // proxy fails closed with 401, vLLM cannot read the image, and EVERY slot errors.
  // This is not a partial degradation, so refuse the run instead of grinding out
  // thousands of guaranteed failures (11 054 of them between 2026-07-21 and 07-27,
  // which read as "the VLM is broken" rather than "the cron lost an env var").
  // Exit 1 — the cron treats step 3 as non-fatal and continues to the coverage check.
  if (!process.env.VLM_PROXY_SECRET) {
    console.error(  // eslint-disable-line no-console
      'ERROR: VLM_PROXY_SECRET not set — every photo-proxy fetch would 401 and all ' +
      'scoring would fail. This script runs outside Next.js, so .env.local is NOT ' +
      'auto-loaded; export it from the caller (see scripts/cron/worksqa-qfield-ingest.sh).',
    );
    process.exit(1);
  }

  const limit = numArg('--limit', 500);
  const concurrency = numArg('--concurrency', 4);
  const freshHours = numArg('--fresh-hours', 3);
  const project = argVal('--project');
  const projFilter = project ? 'AND project_id = $1::uuid' : '';
  const projParams = project ? [project] : [];

  const pool = new Pool({ connectionString: dbUrl });
  try {
    // Phase 1 — fresh: everything synced in this run's window.
    const fresh = await pool.query<ScorableRow>(
      `SELECT ${SCORABLE_COLUMNS} FROM pole_qa_photos
        WHERE updated_at > NOW() - ($${projParams.length + 1} || ' hours')::interval ${projFilter}
          AND ${HAS_CANDIDATE_SLOT}`,
      [...projParams, String(freshHours)],
    );
    const freshTasks = tasksForRows(fresh.rows);
    console.log(`Phase 1 (fresh <${freshHours}h): ${fresh.rows.length} rows, ${freshTasks.length} eligible slots`);  // eslint-disable-line no-console
    const freshRes = await runPool(pool, freshTasks, concurrency);
    console.log(`  fresh: scored=${freshRes.scored} errored=${freshRes.errored} skipped=${freshRes.skipped}`);  // eslint-disable-line no-console

    // Phase 2 — backlog: oldest first, capped at --limit eligible slots.
    const backlog = await pool.query<ScorableRow>(
      `SELECT ${SCORABLE_COLUMNS} FROM pole_qa_photos
        WHERE updated_at <= NOW() - ($${projParams.length + 1} || ' hours')::interval ${projFilter}
          AND ${HAS_CANDIDATE_SLOT}
        ORDER BY updated_at ASC
        LIMIT $${projParams.length + 2}`,
      [...projParams, String(freshHours), limit],
    );
    const backlogTasks = tasksForRows(backlog.rows).slice(0, limit);
    console.log(`Phase 2 (backlog): ${backlog.rows.length} rows scanned, scoring ${backlogTasks.length} slots (limit ${limit})`);  // eslint-disable-line no-console
    const backRes = await runPool(pool, backlogTasks, concurrency);
    console.log(`  backlog: scored=${backRes.scored} errored=${backRes.errored} skipped=${backRes.skipped}`);  // eslint-disable-line no-console

    const totalErr = freshRes.errored + backRes.errored;
    console.log(`TOTAL: scored=${freshRes.scored + backRes.scored} errored=${totalErr}`);  // eslint-disable-line no-console
    if (totalErr > 0) process.exitCode = 1; // cron logs a WARNING
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('works-qa-vlm-score failed:', err instanceof Error ? err.message : String(err));  // eslint-disable-line no-console
  process.exit(1);
});
