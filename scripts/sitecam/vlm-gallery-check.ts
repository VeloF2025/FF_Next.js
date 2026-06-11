/**
 * SiteCam VLM gallery check — desk-test harness.
 *
 * Runs QA-curated gallery photos (vlm_visual_photo_examples) through the SAME
 * prompt + VLM path that /api/sitecam/validate uses, and reports whether the
 * VLM agrees with QA: positives should PASS, negatives should FAIL.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/sitecam/vlm-gallery-check.ts \
 *     --step 1 [--label positive|negative|both] [--limit 20]
 *
 * Read-only: no writes to any table, no photo-hash recording, no escalations.
 *
 * Note: the 6 newest gallery photos per label are injected INTO the prompt as
 * few-shot examples (see src/lib/vlmGallery.ts). Testing those same photos is
 * trivially self-confirming, so they are marked [in-prompt] and excluded from
 * the non-example summary.
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

import { GALLERY_EXAMPLES_PER_LABEL as INJECTED_PER_LABEL } from '@/lib/vlmGallery';

interface Args {
  step: QualityCheckStep;
  label: 'positive' | 'negative' | 'both';
  limit: number;
}

interface GalleryRow {
  id: string;
  photo_url: string;
  label: 'positive' | 'negative';
  saved_at: string;
}

interface RowResult {
  row: GalleryRow;
  injected: boolean;
  verdict: 'PASS' | 'FAIL' | 'ERROR';
  reason: string | null;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const job = get('--job') ?? 'activation';
  if (job !== 'activation') {
    console.error(`--job ${job} not supported: only activation gallery examples are QA-curated.`);
    process.exit(1);
  }
  const step = Number(get('--step'));
  if (!(QUALITY_CHECK_STEPS as readonly number[]).includes(step)) {
    console.error(`--step must be one of: ${QUALITY_CHECK_STEPS.join(', ')}`);
    process.exit(1);
  }
  const label = (get('--label') ?? 'both') as Args['label'];
  if (!['positive', 'negative', 'both'].includes(label)) {
    console.error(`--label must be positive, negative or both`);
    process.exit(1);
  }
  const limit = Number(get('--limit') ?? 20);
  if (!Number.isFinite(limit) || limit < 1) {
    console.error(`--limit must be a positive number`);
    process.exit(1);
  }
  return { step: step as QualityCheckStep, label, limit };
}

async function loadRows(step: number, label: Args['label'], limit: number): Promise<GalleryRow[]> {
  const labels = label === 'both' ? ['positive', 'negative'] : [label];
  const { rows } = await pool.query<GalleryRow>(
    `SELECT id, photo_url, label, saved_at
     FROM vlm_visual_photo_examples
     WHERE step_number = $1 AND job_type = 'activation' AND label = ANY($2)
     ORDER BY saved_at DESC
     LIMIT $3`,
    [step, labels, limit],
  );
  return rows;
}

/** IDs of the rows that loadGalleryExamples will inject into the prompt. */
async function loadInjectedIds(step: number): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const label of ['positive', 'negative'] as const) {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM vlm_visual_photo_examples
       WHERE step_number = $1 AND job_type = 'activation' AND label = $2
       ORDER BY saved_at DESC
       LIMIT $3`,
      [step, label, INJECTED_PER_LABEL],
    );
    rows.forEach((r) => ids.add(r.id));
  }
  return ids;
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

function urlTail(url: string): string {
  return url.length > 48 ? `…${url.slice(-45)}` : url;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const criteria = STEP_CRITERIA[args.step];
  console.log(`\nSiteCam VLM gallery check — Step ${args.step}: ${criteria.label}`);
  console.log(`VLM: ${VLM_CHAT_ENDPOINT} (${VLM_CATEGORIZATION_MODEL})\n`);

  const [rows, injectedIds, galleryExamples] = await Promise.all([
    loadRows(args.step, args.label, args.limit),
    loadInjectedIds(args.step),
    loadGalleryExamples(args.step, 'activation'),
  ]);

  if (rows.length === 0) {
    console.error('No gallery rows found for this step/label.');
    process.exit(1);
  }

  const results: RowResult[] = [];
  for (const row of rows) {
    const injected = injectedIds.has(row.id);
    try {
      const base64 = await fetchPhotoAsBase64(resolveInternalPhotoUrl(row.photo_url));
      const { content } = buildMessageContent(args.step, base64, galleryExamples);
      const { passes, reason } = await runVlm(content);
      results.push({ row, injected, verdict: passes ? 'PASS' : 'FAIL', reason });
    } catch (err) {
      results.push({ row, injected, verdict: 'ERROR', reason: err instanceof Error ? err.message : String(err) });
    }
    const last = results[results.length - 1]!;
    console.log(
      `${last.verdict.padEnd(5)} [${row.label}]${last.injected ? ' [in-prompt]' : ''} ${urlTail(row.photo_url)}` +
        (last.reason ? `\n      ↳ ${last.reason}` : ''),
    );
  }

  const summarise = (subset: RowResult[], name: string): void => {
    const pos = subset.filter((r) => r.row.label === 'positive' && r.verdict !== 'ERROR');
    const neg = subset.filter((r) => r.row.label === 'negative' && r.verdict !== 'ERROR');
    const errors = subset.filter((r) => r.verdict === 'ERROR').length;
    const posOk = pos.filter((r) => r.verdict === 'PASS').length;
    const negOk = neg.filter((r) => r.verdict === 'FAIL').length;
    console.log(`\n${name}:`);
    if (pos.length) console.log(`  positives accepted: ${posOk}/${pos.length} (${Math.round((100 * posOk) / pos.length)}%)`);
    if (neg.length) console.log(`  negatives rejected: ${negOk}/${neg.length} (${Math.round((100 * negOk) / neg.length)}%)`);
    if (errors) console.log(`  errors: ${errors}`);
  };

  summarise(results, 'All tested photos');
  const nonExample = results.filter((r) => !r.injected);
  if (nonExample.length < results.length) {
    summarise(nonExample, 'Excluding in-prompt examples (the honest number)');
  }

  await pool.end();
  const anyResult = results.some((r) => r.verdict !== 'ERROR');
  process.exit(anyResult ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
