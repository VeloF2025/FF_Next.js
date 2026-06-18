/**
 * SiteCam VLM cross-step "wrong subject" check — desk-test harness.
 *
 * Measures whether the SiteCam validate prompt (with crossStepClassification)
 * correctly REJECTS a photo submitted to the WRONG step, and whether the
 * fail_reason names the subject the photo actually shows.
 *
 * It takes the QA-approved POSITIVE gallery photos for one step ("--actual")
 * and runs each through ANOTHER step's prompt ("--as"), where it should fail.
 * This is the regression signal for the bug where a wall-mount photo sent to
 * "Cable Entry Inside" was rejected with a misleading "entry not visible".
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/sitecam/vlm-crossstep-check.ts \
 *     --actual 5 --as 4 [--limit 10]
 *   # --as all  → run the actual step's photos through every OTHER step
 *
 * Read-only: no writes to any table.
 */
/* eslint-disable no-console -- CLI tool, console is the output channel */

import pool from '@/lib/db';
import { loadGalleryExamples } from '@/lib/vlmGallery';
import { fetchPhotoAsBase64 } from '@/modules/activate/services/photoFetchService';
import { resolveInternalPhotoUrl } from '@/lib/internalPhotoUrl';
import {
  STEP_CRITERIA,
  QUALITY_CHECK_STEPS,
  buildMessageContent,
  type QualityCheckStep,
} from '@/modules/activate/services/stepQualityCriteria';
import {
  VLM_CHAT_ENDPOINT,
  VLM_CATEGORIZATION_MODEL,
  VLM_MAX_TOKENS_QUICK,
  VLM_TEMPERATURE,
  stripThinkTags,
} from '@/lib/vlm';

interface Args {
  actual: QualityCheckStep;
  as: QualityCheckStep[]; // target step prompts to run the photos through
  limit: number;
}

interface PhotoRow {
  id: string;
  photo_url: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const isStep = (n: number): n is QualityCheckStep =>
    (QUALITY_CHECK_STEPS as readonly number[]).includes(n);

  const actual = Number(get('--actual'));
  if (!isStep(actual)) {
    console.error(`--actual must be one of: ${QUALITY_CHECK_STEPS.join(', ')}`);
    process.exit(1);
  }
  const asRaw = get('--as');
  if (!asRaw) {
    console.error('--as <step|all> is required');
    process.exit(1);
  }
  let as: QualityCheckStep[];
  if (asRaw === 'all') {
    as = (QUALITY_CHECK_STEPS as readonly QualityCheckStep[]).filter((s) => s !== actual);
  } else {
    const t = Number(asRaw);
    if (!isStep(t) || t === actual) {
      console.error(`--as must be a quality step other than --actual, or "all"`);
      process.exit(1);
    }
    as = [t];
  }
  const limit = Number(get('--limit') ?? 10);
  if (!Number.isFinite(limit) || limit < 1) {
    console.error('--limit must be a positive number');
    process.exit(1);
  }
  return { actual: actual as QualityCheckStep, as, limit };
}

/** Words of a step label distinctive enough to look for in a fail_reason. */
function subjectKeywords(step: QualityCheckStep): string[] {
  return STEP_CRITERIA[step].label
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 3 && !['from', 'with', 'photo'].includes(w));
}

async function loadPositives(step: number, limit: number): Promise<PhotoRow[]> {
  const { rows } = await pool.query<PhotoRow>(
    `SELECT id, photo_url
     FROM vlm_visual_photo_examples
     WHERE step_number = $1 AND job_type = 'activation' AND label = 'positive'
     ORDER BY saved_at DESC
     LIMIT $2`,
    [step, limit],
  );
  return rows;
}

async function runVlm(content: unknown[]): Promise<{ passes: boolean; reason: string | null }> {
  const resp = await fetch(VLM_CHAT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VLM_CATEGORIZATION_MODEL,
      messages: [{ role: 'user', content }],
      max_tokens: VLM_MAX_TOKENS_QUICK,
      temperature: VLM_TEMPERATURE,
    }),
  });
  if (!resp.ok) throw new Error(`VLM HTTP ${resp.status}`);
  const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = stripThinkTags(json.choices?.[0]?.message?.content ?? '');
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`no JSON in VLM response: ${raw.slice(0, 120)}`);
  const parsed = JSON.parse(match[0]) as { passes?: boolean; pass?: boolean; fail_reason?: string | null };
  const passes = parsed.passes !== undefined ? parsed.passes === true : parsed.pass === true;
  return { passes, reason: parsed.fail_reason ?? null };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `\nSiteCam VLM cross-step check — photos of "${STEP_CRITERIA[args.actual].label}" (step ${args.actual})`,
  );
  console.log(`VLM: ${VLM_CHAT_ENDPOINT} (${VLM_CATEGORIZATION_MODEL})\n`);

  const photos = await loadPositives(args.actual, args.limit);
  if (photos.length === 0) {
    console.error(`No positive gallery photos for step ${args.actual}.`);
    process.exit(1);
  }

  let tested = 0;
  let rejected = 0; // correctly failed (good)
  let named = 0; // fail_reason mentions the true subject (good)
  let errors = 0;
  const keywords = subjectKeywords(args.actual);

  for (const target of args.as) {
    const gallery = await loadGalleryExamples(target, 'activation');
    console.log(`→ run through step ${target} ("${STEP_CRITERIA[target].label}") prompt:`);
    for (const p of photos) {
      try {
        const base64 = await fetchPhotoAsBase64(resolveInternalPhotoUrl(p.photo_url));
        const { content } = buildMessageContent(target, base64, gallery, {
          crossStepClassification: true,
        });
        const { passes, reason } = await runVlm(content);
        tested += 1;
        const reasonLc = (reason ?? '').toLowerCase();
        const mentionsSubject = keywords.some((k) => reasonLc.includes(k));
        if (!passes) rejected += 1;
        if (!passes && mentionsSubject) named += 1;
        const tag = passes ? 'PASS(!)' : mentionsSubject ? 'FAIL+named' : 'FAIL';
        console.log(`   ${tag.padEnd(10)} ${reason ?? '(no reason)'}`);
      } catch (err) {
        errors += 1;
        console.log(`   ERROR      ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log('\nSummary (higher is better):');
  if (tested) {
    console.log(`  correctly rejected: ${rejected}/${tested} (${Math.round((100 * rejected) / tested)}%)`);
    console.log(`  reason named the true subject: ${named}/${tested} (${Math.round((100 * named) / tested)}%)`);
  }
  if (errors) console.log(`  errors: ${errors}`);

  await pool.end();
  process.exit(tested > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
