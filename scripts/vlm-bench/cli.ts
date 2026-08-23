// scripts/vlm-bench/cli.ts
// Usage:
//   npx tsx scripts/vlm-bench/cli.ts run --pack serials --mode golden
//   npx tsx scripts/vlm-bench/cli.ts coverage
//   DATABASE_URL=... npx tsx scripts/vlm-bench/cli.ts harvest --pack categorization [--size 80] [--seed v1]
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { serialsPack } from './packs/serials';
import { categorizationPack } from './packs/categorization';
import { civilQaPack, civilQaHoldoutPack, civilPairPack, civilPairHoldoutPack } from './packs/civilQa';
import { stepMetrics, strataBreakdown } from './scoring/steps';
import { harvest, closeHarvestPool } from './harvest';
import { runPack } from './engine/runner';
import { storeRun } from './engine/resultStore';
import { vlmHealthy, vlmComplete, fileToDataUrl } from './vlmCall';
import { VLM_MODEL } from '@/lib/vlm';
import type { RunResult, VlmTestPack } from './types';

const GOLDEN_ROOT = path.join(__dirname, 'datasets/golden');
const PACKS: Record<string, VlmTestPack> = {
  serials: serialsPack,
  categorization: categorizationPack,
  'civil-qa': civilQaPack,
  'civil-qa-holdout': civilQaHoldoutPack,
  'civil-pair': civilPairPack,
  'civil-pair-holdout': civilPairHoldoutPack,
};
const MIN_GOLDEN = 100;

function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

/** Short git sha via execFile (no shell → no injection); env fallback. */
function gitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim();
  } catch {
    return process.env.GIT_SHA ?? 'unknown';
  }
}

async function cmdRun(): Promise<void> {
  const packId = arg('pack', 'serials')!;
  const mode = arg('mode', 'golden') as 'golden' | 'live';
  const pack = PACKS[packId];
  if (!pack) throw new Error(`unknown pack: ${packId}`);

  if (!(await vlmHealthy())) {
    const r: RunResult = { mode, model: VLM_MODEL, gitSha: gitSha(), startedAt: new Date().toISOString(), status: 'infra_error', packs: [] };
    await storeRun(r);
    process.stdout.write('VLM not healthy — recorded infra_error, no scores.\n');
    process.exit(2);
  }

  // Resolve golden image refs (file path) to data URLs at call time.
  const resolved: VlmTestPack = {
    ...pack,
    buildPrompt(c) {
      const ref = mode === 'golden' ? fileToDataUrl(path.join(GOLDEN_ROOT, pack.id, c.imageRef)) : c.imageRef;
      return pack.buildPrompt({ ...c, imageRef: ref });
    },
  };

  const packResult = await runPack(resolved, mode, { goldenRoot: GOLDEN_ROOT }, (req) => vlmComplete(req));
  const run: RunResult = { mode, model: VLM_MODEL, gitSha: gitSha(), startedAt: new Date().toISOString(), status: 'ok', packs: [packResult] };
  const id = await storeRun(run);
  process.stdout.write(
    `run #${id} ${pack.id} ${mode}: ${packResult.passed}/${packResult.scored} pass, scorePct=${packResult.scorePct.toFixed(1)} (errors=${packResult.errors})\n`,
  );

  // Step packs: one pass rate hides which step the model actually confuses, and
  // hides whether it only passed the easy stratum. Print both.
  // Per-case detail is deliberately NOT stored in vlm_bench_runs (resultStore
  // strips it), so a confusion matrix needs a local dump. Opt-in, local file
  // only — the stored row is unchanged.
  const dump = arg('dump');
  if (dump) {
    fs.writeFileSync(dump, `${JSON.stringify({ runId: id, pack: pack.id, cases: packResult.cases }, null, 2)}\n`);
    process.stdout.write(`  per-case detail → ${dump}\n`);
  }

  const metrics = stepMetrics(packResult.cases);
  if (metrics.length > 0) {
    for (const [stratum, s] of Object.entries(strataBreakdown(packResult.cases))) {
      process.stdout.write(`  stratum ${stratum}: ${s.passed}/${s.n}\n`);
    }
    process.stdout.write('  step  support  pred  correct  precision  recall     f1\n');
    for (const m of metrics) {
      process.stdout.write(
        `  ${String(m.step).padStart(4)}  ${String(m.support).padStart(7)}  ${String(m.predicted).padStart(4)}  ` +
          `${String(m.correct).padStart(7)}  ${m.precision.toFixed(3).padStart(9)}  ${m.recall.toFixed(3).padStart(6)}  ${m.f1.toFixed(3).padStart(5)}\n`,
      );
    }
  }
}

async function cmdHarvest(): Promise<void> {
  const packId = arg('pack')!;
  if (!packId) throw new Error('harvest requires --pack <categorization|civil-qa>');
  try {
    await harvest({
      packId,
      goldenRoot: GOLDEN_ROOT,
      seed: arg('seed', 'v1')!,
      size: Number(arg('size', '80')),
      out: (line) => process.stdout.write(line),
    });
  } finally {
    await closeHarvestPool();
  }
}

function cmdCoverage(): void {
  for (const [id, pack] of Object.entries(PACKS)) {
    const manifest = path.join(GOLDEN_ROOT, pack.id, 'cases.json');
    const n = fs.existsSync(manifest) ? (JSON.parse(fs.readFileSync(manifest, 'utf8')) as unknown[]).length : 0;
    const flag = n < MIN_GOLDEN ? `  ⚠️ below ${MIN_GOLDEN}` : '';
    process.stdout.write(`${id}: ${n} golden cases${flag}\n`);
  }
}

(async () => {
  const cmd = process.argv[2];
  if (cmd === 'run') await cmdRun();
  else if (cmd === 'coverage') cmdCoverage();
  else if (cmd === 'harvest') await cmdHarvest();
  else {
    process.stdout.write('usage: cli.ts run|coverage|harvest [--pack <id>] [--mode golden|live] [--size N] [--seed S] [--dump FILE]\n');
    process.exit(1);
  }
  // `run` writes through @/lib/db-pool, whose pool has no exported close and
  // keeps the event loop alive indefinitely — the run finishes, prints its
  // result, then hangs. Close what we own and exit explicitly so a sequence of
  // packs can't stall on a completed run.
  await closeHarvestPool();
  process.exit(0);
})().catch((e) => {
  process.stderr.write(`${(e as Error).message}\n`);
  process.exit(1);
});
