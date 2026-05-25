# VLM Benchmark Engine — Implementation Plan 1 (Foundation + Serials Golden Slice)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the VLM benchmark engine core + result storage, and prove it end-to-end with the **serials** pack on the reproducible **golden** dataset, runnable via `npx tsx scripts/vlm-bench/cli.ts run --pack serials --mode golden`.

**Architecture:** One generic engine (loads cases → calls the live VLM endpoint → runs the pack's scorer → aggregates → stores) plus pluggable per-use-case packs implementing a small `VlmTestPack` interface. This plan delivers the engine, the result store (`vlm_bench_runs` table), the `serials` pack on golden data, and a CLI with `run` + `coverage`. Live/HITL sampling, drift alerting, the other six packs, and the model-selection/prompt-A/B consumers are Plans 2–4.

**Tech Stack:** TypeScript, run on velo via `npx tsx`. DB via `pg.Pool` through `@/lib/db-pool` (NOT `neon()` — it can't reach Supabase post-cutover). VLM via `@/lib/vlm` (`VLM_CHAT_ENDPOINT`, `VLM_MODELS_ENDPOINT`, `VLM_MODEL`). Tests via the repo's existing Jest setup. Output via `process.stdout` (the `@/lib/logger` is silent under plain Node/tsx).

**Spec:** `docs/superpowers/specs/2026-05-25-vlm-benchmark-design.md`

---

## File Structure

```
scripts/vlm-bench/
  types.ts                 # BenchCase, CaseScore, PackResult, RunResult, VlmTestPack
  vlmCall.ts               # thin bench-only VLM caller (model-overridable) + health check
  scoring/
    text.ts                # normalizeExact(), charErrorRate() — shared scorers
  packs/
    serials.ts             # the first VlmTestPack (golden loader + buildPrompt + score)
  engine/
    runner.ts              # runPack(): load → call → score → aggregate
    resultStore.ts         # persist RunResult to vlm_bench_runs
  datasets/golden/serials/
    cases.json             # [{ id, imageRef, sha256, expected }]  (golden manifest)
  cli.ts                   # arg parse → run | coverage

scripts/migrations/sql/
  NNN_vlm_bench_runs.sql
  rollback_NNN_vlm_bench_runs.sql

tests/unit/vlm-bench/
  scoring-text.test.ts
  serials-pack.test.ts
  runner.test.ts
```

---

## Task 1: Shared types

**Files:**
- Create: `scripts/vlm-bench/types.ts`

- [ ] **Step 1: Write the types module**

```ts
// scripts/vlm-bench/types.ts
// Shared contracts for the VLM benchmark engine.

/** One labelled benchmark case (image + expected answer). */
export interface BenchCase {
  id: string;                 // stable id, unique within a pack
  imageRef: string;           // file path (golden) or URL (VF Storage)
  sha256?: string;            // golden integrity check (optional for live)
  expected: unknown;          // pack-specific ground truth
}

/** Result of scoring one case. */
export interface CaseScore {
  caseId: string;
  pass: boolean;
  score: number;              // 0..1 (partial credit allowed)
  detail?: Record<string, unknown>; // e.g. { cer: 0.1, drop: true }
  error?: string;             // set when the VLM call itself failed
}

/** What a pack's score() returns (before the engine attaches caseId). */
export interface ScoreOutcome {
  pass: boolean;
  score: number;
  detail?: Record<string, unknown>;
}

/** Aggregated result for one pack run. */
export interface PackResult {
  packId: string;
  total: number;
  scored: number;             // excludes error cases
  errors: number;
  passed: number;
  scorePct: number;           // 100 * sum(score)/scored
  cases: CaseScore[];
}

/** Top-level result for a benchmark invocation. */
export interface RunResult {
  mode: 'golden' | 'live';
  model: string;
  gitSha: string;
  startedAt: string;          // ISO
  status: 'ok' | 'infra_error';
  packs: PackResult[];
}

export interface LoadOpts {
  /** velo-side root for resolving golden image refs */
  goldenRoot: string;
}

/** OpenAI-compatible chat request body sent to vLLM. */
export interface VlmRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'system';
    content:
      | Array<
          | { type: 'text'; text: string }
          | { type: 'image_url'; image_url: { url: string } }
        >
      | string;
  }>;
  max_tokens: number;
  temperature?: number;
}

/** A pluggable use-case pack. */
export interface VlmTestPack {
  id: string;
  loadCases(mode: 'golden' | 'live', opts: LoadOpts): Promise<BenchCase[]>;
  buildPrompt(c: BenchCase, variant?: string): VlmRequest;
  score(expected: unknown, actual: string): ScoreOutcome;
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/vlm-bench/types.ts
git commit -m "feat(vlm-bench): shared engine types"
```

---

## Task 2: Text scorers (TDD)

**Files:**
- Create: `scripts/vlm-bench/scoring/text.ts`
- Test: `tests/unit/vlm-bench/scoring-text.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/vlm-bench/scoring-text.test.ts
import { normalizeExact, charErrorRate } from '@/../scripts/vlm-bench/scoring/text';

describe('normalizeExact', () => {
  it('uppercases, strips spaces/punctuation', () => {
    expect(normalizeExact(' alclb-491 baa2 ')).toBe('ALCLB491BAA2');
  });
});

describe('charErrorRate', () => {
  it('is 0 for identical strings', () => {
    expect(charErrorRate('ABC123', 'ABC123')).toBe(0);
  });
  it('counts a single substitution (O↔0)', () => {
    expect(charErrorRate('ABC0EF', 'ABCOEF')).toBeCloseTo(1 / 6, 5);
  });
  it('counts a dropped char', () => {
    expect(charErrorRate('ABCDEF', 'ABCDE')).toBeCloseTo(1 / 6, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/vlm-bench/scoring-text.test.ts`
Expected: FAIL — cannot find module `scoring/text`.

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/vlm-bench/scoring/text.ts
/** Uppercase and remove anything that is not A-Z or 0-9. */
export function normalizeExact(s: string): string {
  return (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Levenshtein distance / max(len) — character error rate in [0,1]. */
export function charErrorRate(expected: string, actual: string): number {
  const a = expected ?? '';
  const b = actual ?? '';
  if (a.length === 0 && b.length === 0) return 0;
  const d: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[a.length][b.length] / Math.max(a.length, b.length);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/vlm-bench/scoring-text.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add scripts/vlm-bench/scoring/text.ts tests/unit/vlm-bench/scoring-text.test.ts
git commit -m "feat(vlm-bench): text scorers (normalizeExact, charErrorRate) + tests"
```

---

## Task 3: Serials pack — golden loader, prompt, score (TDD)

**Files:**
- Create: `scripts/vlm-bench/packs/serials.ts`
- Create: `scripts/vlm-bench/datasets/golden/serials/cases.json`
- Test: `tests/unit/vlm-bench/serials-pack.test.ts`

- [ ] **Step 1: Create a minimal golden manifest (2 seed cases)**

```json
[
  { "id": "serial-0001", "imageRef": "serial-0001.jpg", "sha256": "PLACEHOLDER_FILLED_AT_SEED_TIME", "expected": { "serial": "ALCLB491BAA2" } },
  { "id": "serial-0002", "imageRef": "serial-0002.jpg", "sha256": "PLACEHOLDER_FILLED_AT_SEED_TIME", "expected": { "serial": "GU18W12V2510005881" } }
]
```

> Note: image files + real sha256 are populated by the seed step in Task 7. Scoring/prompt logic is tested below without needing the images.

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/vlm-bench/serials-pack.test.ts
import { serialsPack } from '@/../scripts/vlm-bench/packs/serials';

describe('serialsPack.score', () => {
  it('passes on exact match after normalisation', () => {
    const r = serialsPack.score({ serial: 'ALCLB491BAA2' }, ' alclb-491 baa2 ');
    expect(r.pass).toBe(true);
    expect(r.score).toBe(1);
  });
  it('gives partial credit + reports cer on single-char error (O vs 0)', () => {
    const r = serialsPack.score({ serial: 'ABC0EF' }, 'ABCOEF');
    expect(r.pass).toBe(false);
    expect(r.score).toBeGreaterThan(0.7);
    expect(r.detail?.cer).toBeCloseTo(1 / 6, 5);
  });
});

describe('serialsPack.buildPrompt', () => {
  it('embeds the image ref and asks for only the serial', () => {
    const req = serialsPack.buildPrompt({ id: 'x', imageRef: 'data:image/jpeg;base64,AAA', expected: {} });
    const content = req.messages[0].content as Array<{ type: string }>;
    expect(content.some((c) => c.type === 'image_url')).toBe(true);
    expect(req.max_tokens).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/unit/vlm-bench/serials-pack.test.ts`
Expected: FAIL — cannot find module `packs/serials`.

- [ ] **Step 4: Write the implementation**

```ts
// scripts/vlm-bench/packs/serials.ts
import * as fs from 'fs';
import * as path from 'path';
import { VLM_EXTRACTION_MODEL } from '@/lib/vlm';
import type { BenchCase, LoadOpts, ScoreOutcome, VlmRequest, VlmTestPack } from '../types';
import { normalizeExact, charErrorRate } from '../scoring/text';

const PROMPT =
  'Read the equipment serial number from the sticker in this image. ' +
  'Reply with ONLY the serial number, no words, no spaces.';

export const serialsPack: VlmTestPack = {
  id: 'serials',

  async loadCases(mode, opts: LoadOpts): Promise<BenchCase[]> {
    if (mode !== 'golden') {
      throw new Error('serials live mode is implemented in Plan 2');
    }
    const manifest = path.join(opts.goldenRoot, 'serials', 'cases.json');
    return JSON.parse(fs.readFileSync(manifest, 'utf8')) as BenchCase[];
  },

  buildPrompt(c: BenchCase): VlmRequest {
    return {
      model: VLM_EXTRACTION_MODEL,
      max_tokens: 40,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: c.imageRef } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    };
  },

  score(expected: unknown, actual: string): ScoreOutcome {
    const want = normalizeExact((expected as { serial: string }).serial);
    const got = normalizeExact(actual);
    const cer = charErrorRate(want, got);
    return {
      pass: want === got,
      score: Math.max(0, 1 - cer),
      detail: { cer, expected: want, got },
    };
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/vlm-bench/serials-pack.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/vlm-bench/packs/serials.ts scripts/vlm-bench/datasets/golden/serials/cases.json tests/unit/vlm-bench/serials-pack.test.ts
git commit -m "feat(vlm-bench): serials pack (golden loader, prompt, scorer) + tests"
```

---

## Task 4: Bench VLM caller + health check

**Files:**
- Create: `scripts/vlm-bench/vlmCall.ts`

- [ ] **Step 1: Write the caller**

```ts
// scripts/vlm-bench/vlmCall.ts
import * as fs from 'fs';
import { VLM_CHAT_ENDPOINT, VLM_MODELS_ENDPOINT } from '@/lib/vlm';
import type { VlmRequest } from './types';

/** Returns true if the VLM is reachable and a model is loaded. */
export async function vlmHealthy(): Promise<boolean> {
  try {
    const res = await fetch(VLM_MODELS_ENDPOINT, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const body = await res.json();
    return Array.isArray(body?.data) && body.data.length > 0;
  } catch {
    return false;
  }
}

/** Calls the VLM; returns the assistant text. Throws on transport/HTTP error. */
export async function vlmComplete(req: VlmRequest, timeoutMs = 60000): Promise<string> {
  const res = await fetch(VLM_CHAT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`VLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = await res.json();
  return body?.choices?.[0]?.message?.content ?? '';
}

/** Reads an image file and returns a data: URL for embedding in a request. */
export function fileToDataUrl(absPath: string): string {
  const b64 = fs.readFileSync(absPath).toString('base64');
  return `data:image/jpeg;base64,${b64}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/vlm-bench/vlmCall.ts
git commit -m "feat(vlm-bench): VLM caller + health check"
```

---

## Task 5: Engine runner (TDD with stubbed VLM)

**Files:**
- Create: `scripts/vlm-bench/engine/runner.ts`
- Test: `tests/unit/vlm-bench/runner.test.ts`

- [ ] **Step 1: Write the failing test (stubbed caller, no GPU needed)**

```ts
// tests/unit/vlm-bench/runner.test.ts
import { runPack } from '@/../scripts/vlm-bench/engine/runner';
import type { VlmTestPack } from '@/../scripts/vlm-bench/types';

const fakePack: VlmTestPack = {
  id: 'fake',
  async loadCases() {
    return [
      { id: 'a', imageRef: 'x', expected: { serial: 'AAA' } },
      { id: 'b', imageRef: 'y', expected: { serial: 'BBB' } },
    ];
  },
  buildPrompt(c) {
    return { model: 'm', max_tokens: 10, messages: [{ role: 'user', content: c.id }] };
  },
  score(expected, actual) {
    const want = (expected as { serial: string }).serial;
    return { pass: want === actual, score: want === actual ? 1 : 0 };
  },
};

describe('runPack', () => {
  it('scores each case via the injected caller and aggregates', async () => {
    const answers: Record<string, string> = { a: 'AAA', b: 'WRONG' };
    const result = await runPack(fakePack, 'golden', { goldenRoot: '/tmp' }, async (req) => answers[req.messages[0].content as string]);
    expect(result.total).toBe(2);
    expect(result.passed).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.scorePct).toBe(50);
  });

  it('records caller errors without counting them in scorePct', async () => {
    const result = await runPack(fakePack, 'golden', { goldenRoot: '/tmp' }, async (req) => {
      if ((req.messages[0].content as string) === 'a') throw new Error('timeout');
      return 'BBB';
    });
    expect(result.errors).toBe(1);
    expect(result.scored).toBe(1);
    expect(result.scorePct).toBe(100); // the one scored case passed
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/vlm-bench/runner.test.ts`
Expected: FAIL — cannot find module `engine/runner`.

- [ ] **Step 3: Write the runner**

```ts
// scripts/vlm-bench/engine/runner.ts
import type { CaseScore, LoadOpts, PackResult, VlmRequest, VlmTestPack } from '../types';

/** Caller signature so tests can inject a stub instead of hitting the GPU. */
export type Caller = (req: VlmRequest) => Promise<string>;

export async function runPack(
  pack: VlmTestPack,
  mode: 'golden' | 'live',
  opts: LoadOpts,
  call: Caller,
): Promise<PackResult> {
  const cases = await pack.loadCases(mode, opts);
  const scores: CaseScore[] = [];
  for (const c of cases) {
    try {
      const actual = await call(pack.buildPrompt(c));
      const s = pack.score(c.expected, actual);
      scores.push({ caseId: c.id, pass: s.pass, score: s.score, detail: s.detail });
    } catch (e) {
      scores.push({ caseId: c.id, pass: false, score: 0, error: (e as Error).message });
    }
  }
  const scored = scores.filter((s) => !s.error);
  const errors = scores.length - scored.length;
  const passed = scored.filter((s) => s.pass).length;
  const scorePct =
    scored.length === 0 ? 0 : (100 * scored.reduce((a, s) => a + s.score, 0)) / scored.length;
  return { packId: pack.id, total: cases.length, scored: scored.length, errors, passed, scorePct, cases: scores };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/vlm-bench/runner.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/vlm-bench/engine/runner.ts tests/unit/vlm-bench/runner.test.ts
git commit -m "feat(vlm-bench): engine runner with injectable caller + tests"
```

---

## Task 6: Result store — migration + persistence

**Files:**
- Create: `scripts/migrations/sql/NNN_vlm_bench_runs.sql`
- Create: `scripts/migrations/sql/rollback_NNN_vlm_bench_runs.sql`
- Create: `scripts/vlm-bench/engine/resultStore.ts`

- [ ] **Step 1: Choose the migration version from the live DB (NOT `ls`)**

Run (on velo, or via tunnel):
```bash
psql "$DATABASE_URL" -tAc "SELECT MAX(version) FROM migrations;"
```
Use `MAX+1` as `NNN`. (Repo rule: side branches apply to the shared DB, so never derive the number from filenames.)

- [ ] **Step 2: Write the migration**

```sql
-- scripts/migrations/sql/NNN_vlm_bench_runs.sql
CREATE TABLE IF NOT EXISTS vlm_bench_runs (
  id            BIGSERIAL PRIMARY KEY,
  mode          TEXT NOT NULL CHECK (mode IN ('golden','live')),
  model         TEXT NOT NULL,
  git_sha       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('ok','infra_error')),
  started_at    TIMESTAMPTZ NOT NULL,
  pack_scores   JSONB NOT NULL,        -- [{packId,total,scored,errors,passed,scorePct}]
  live_snapshot JSONB,                 -- [{packId, caseIds:[...]}] for replay (Plan 2)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vlm_bench_runs_model_started ON vlm_bench_runs (model, started_at DESC);
```

- [ ] **Step 3: Write the rollback**

```sql
-- scripts/migrations/sql/rollback_NNN_vlm_bench_runs.sql
DROP TABLE IF EXISTS vlm_bench_runs;
```

- [ ] **Step 4: Write the store module (pg.Pool via db-pool, dynamic import after env load)**

```ts
// scripts/vlm-bench/engine/resultStore.ts
import type { RunResult } from '../types';

/**
 * Persists a run. Uses a dynamic import of @/lib/db-pool AFTER env is loaded
 * (neon() cannot reach Supabase from tsx; db-pool wraps pg.Pool which can).
 * Stores only per-pack summaries (not per-case) in pack_scores.
 */
export async function storeRun(r: RunResult): Promise<number> {
  const { query } = await import('@/lib/db-pool');
  const summaries = r.packs.map(({ cases: _cases, ...summary }) => summary);
  const rows = await query(
    `INSERT INTO vlm_bench_runs (mode, model, git_sha, status, started_at, pack_scores, live_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [r.mode, r.model, r.gitSha, r.status, r.startedAt, JSON.stringify(summaries), null],
  );
  return rows[0].id as number;
}
```

- [ ] **Step 5: Apply the migration on the shared DB and verify**

Run:
```bash
psql "$DATABASE_URL" -f scripts/migrations/sql/NNN_vlm_bench_runs.sql
psql "$DATABASE_URL" -c "\d vlm_bench_runs"
```
Expected: table exists with the columns above.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrations/sql/NNN_vlm_bench_runs.sql scripts/migrations/sql/rollback_NNN_vlm_bench_runs.sql scripts/vlm-bench/engine/resultStore.ts
git commit -m "feat(vlm-bench): vlm_bench_runs migration + result store"
```

---

## Task 7: Seed golden serial images + real sha256

**Files:**
- Add image files: `scripts/vlm-bench/datasets/golden/serials/serial-0001.jpg`, `serial-0002.jpg`
- Modify: `scripts/vlm-bench/datasets/golden/serials/cases.json` (fill real sha256)
- Create: `scripts/vlm-bench/seedSha.ts`

- [ ] **Step 1: Place two human-verified serial sticker images**

Copy two real, human-verified ONT/UPS sticker photos (expected serials already known) into the golden dir as `serial-0001.jpg` / `serial-0002.jpg`. Source: known-good DR submissions whose serials were confirmed against OES/Fibertime.

- [ ] **Step 2: Write a tiny sha256 filler**

```ts
// scripts/vlm-bench/seedSha.ts
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const dir = path.join(__dirname, 'datasets/golden/serials');
const manifestPath = path.join(dir, 'cases.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Array<{ imageRef: string; sha256: string }>;
for (const c of manifest) {
  const buf = fs.readFileSync(path.join(dir, c.imageRef));
  c.sha256 = crypto.createHash('sha256').update(buf).digest('hex');
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write('sha256 filled\n');
```

- [ ] **Step 3: Run it**

Run: `npx tsx scripts/vlm-bench/seedSha.ts`
Expected: `cases.json` now has real 64-hex sha256 values (no PLACEHOLDER).

- [ ] **Step 4: Commit**

```bash
git add scripts/vlm-bench/datasets/golden/serials/ scripts/vlm-bench/seedSha.ts
git commit -m "feat(vlm-bench): seed golden serial cases with verified sha256"
```

---

## Task 8: CLI — `run` + `coverage`

**Files:**
- Create: `scripts/vlm-bench/cli.ts`

- [ ] **Step 1: Write the CLI**

```ts
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
```

- [ ] **Step 2: Smoke-test coverage (no GPU needed)**

Run: `npx tsx scripts/vlm-bench/cli.ts coverage`
Expected: `serials: 2 golden cases  ⚠️ below 100`.

- [ ] **Step 3: Smoke-test run against the live VLM (on velo; read-only inference)**

Run: `npx tsx scripts/vlm-bench/cli.ts run --pack serials --mode golden`
Expected: a line like `run #1 serials golden: 2/2 pass, scorePct=100.0 (errors=0)` and a row in `vlm_bench_runs`.

- [ ] **Step 4: Verify the stored row**

Run: `psql "$DATABASE_URL" -c "SELECT id, mode, model, status, pack_scores->0->>'scorePct' AS score FROM vlm_bench_runs ORDER BY id DESC LIMIT 1;"`
Expected: one row, status `ok`, score `100`.

- [ ] **Step 5: Commit**

```bash
git add scripts/vlm-bench/cli.ts
git commit -m "feat(vlm-bench): CLI run + coverage commands"
```

---

## Task 9: Full unit suite + README

**Files:**
- Create: `scripts/vlm-bench/README.md`

- [ ] **Step 1: Run the whole bench unit suite**

Run: `npx jest tests/unit/vlm-bench/`
Expected: all tests PASS (scoring-text, serials-pack, runner).

- [ ] **Step 2: Write the README**

```markdown
# vlm-bench

Process-tuned VLM benchmark engine. See spec:
`docs/superpowers/specs/2026-05-25-vlm-benchmark-design.md`.

## Run
    npx tsx scripts/vlm-bench/cli.ts coverage
    npx tsx scripts/vlm-bench/cli.ts run --pack serials --mode golden

## Add a pack
Implement `VlmTestPack` (see `packs/serials.ts`), register it in `cli.ts` PACKS,
and add a golden manifest under `datasets/golden/<pack>/cases.json`.

## Notes
- Runs on velo (where the VLM lives) via tsx.
- DB writes use `@/lib/db-pool` (pg.Pool), never neon().
- Output uses process.stdout (logger is silent under tsx).
```

- [ ] **Step 3: Commit**

```bash
git add scripts/vlm-bench/README.md
git commit -m "docs(vlm-bench): README"
```

---

## Self-Review (completed)

- **Spec coverage (this slice):** engine (Task 5), packs interface + serials (Tasks 1,3), golden dataset + sha256 integrity (Tasks 3,7), `score_pct` + per-pack detail (Tasks 2,3,5), result store `vlm_bench_runs` + reproducibility via git sha/model (Task 6), CLI `run`+`coverage` (Task 8), infra-error vs accuracy-failure distinction (Tasks 5,6,8), tests incl. stubbed endpoint (Tasks 2,3,5). Deferred-by-design to Plans 2–4: live/HITL sampling + drift alerting, the other six packs, model-selection swap orchestration, prompt A/B. These are explicitly out of THIS plan's scope, not gaps.
- **Placeholder scan:** the only literal "PLACEHOLDER" is the sha256 value in the seed manifest, which Task 7 deterministically fills and Step 3 verifies. No TODO / "handle edge cases" / "similar to Task N".
- **Type consistency:** `VlmTestPack`, `BenchCase`, `VlmRequest`, `PackResult`, `RunResult`, `ScoreOutcome`, `LoadOpts`, `Caller`, `runPack`, `storeRun`, `vlmComplete`, `vlmHealthy`, `fileToDataUrl`, `normalizeExact`, `charErrorRate` are used with consistent signatures across Tasks 1–9. `score()` returns `ScoreOutcome` everywhere; the engine attaches `caseId`.

## Follow-on plans (not in scope here)
- **Plan 2:** live/HITL loaders (verify `qa_correction_examples` / `vlm_corrections` schema with `\d` first) + drift monitor + NOC-ticket/WA alerting + `live_snapshot` replay.
- **Plan 3:** remaining packs — categorization (per-step + confusion matrix), power-meter, fleet-ocr (odometer/fuel/plate), documents, construction-qa, receipts — each templated off `serials.ts`.
- **Plan 4:** model-selection `compare` (swap `vllm-qwen` per model, restore incumbent on failure) + prompt A/B; retire `benchmark.sh` + `model-shootout.sh`, repoint the daily cron.
