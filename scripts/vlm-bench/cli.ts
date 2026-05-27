// scripts/vlm-bench/cli.ts
// Usage:
//   npx tsx scripts/vlm-bench/cli.ts run --pack serials --mode golden
//   npx tsx scripts/vlm-bench/cli.ts coverage
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { serialsPack } from './packs/serials';
import { runPack } from './engine/runner';
import { storeRun } from './engine/resultStore';
import { vlmHealthy, vlmComplete, fileToDataUrl } from './vlmCall';
import { VLM_MODEL } from '@/lib/vlm';
import type { RunResult, VlmTestPack } from './types';

const GOLDEN_ROOT = path.join(__dirname, 'datasets/golden');
const PACKS: Record<string, VlmTestPack> = { serials: serialsPack };
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
  else {
    process.stdout.write('usage: cli.ts run|coverage [--pack <id>] [--mode golden|live]\n');
    process.exit(1);
  }
})().catch((e) => {
  process.stderr.write(`${(e as Error).message}\n`);
  process.exit(1);
});
