# SiteCam Auto-Appeals VLM — Phase 2 (Scoring Cron) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the automated scoring layer for SiteCam appeals — a `job_type`-aware cron that picks up pending, not-yet-scored appeals, runs the already-built `evaluateAppeal` service, and writes an **advisory** recommendation to the `vlm_*` columns, **never touching `status`** (shadow mode).

**Architecture:** Mirror the proven `auto-qa` → `auto-feedback` cron pattern. A precursor migration + submit-path change gives every new appeal a stored `job_type` (the wizard already knows it). A thin persistence module (`appealsVlmStore`) owns the SELECT of eligible rows and the advisory UPDATE, splitting terminal results (set `vlm_evaluated_at`, done) from transient VLM outages (bump `vlm_attempts`, retry until a cap parks them) — exactly like `markAutoFeedbackSent` vs `recordAutoFeedbackFailure`. The cron handler (`/api/cron/appeals-vlm`) is a bearer-`CRON_SECRET` orchestrator over a bounded batch.

**Tech Stack:** TypeScript, Next.js API routes, Vitest + node-mocks-http, PostgreSQL (self-hosted Supabase), the on-prem Qwen3-VL endpoint, `pg.Pool` via `@/lib/db`.

**Source spec:** `docs/superpowers/specs/2026-07-01-sitecam-appeals-vlm-design.md` (§4 Approach A, §5.1, §5.2, §5.8; roadmap **P2**). Builds on Phase 1 (migration 436 + `appealsVlmService.evaluateAppeal`). Job-type decision (2026-07-03): **store `job_type` on the appeal at submit time** (chosen over cron-only defaulting).

## Global Constraints

- Migrations MUST live in `scripts/migrations/sql/` (top-level `scripts/migrations/` is silently ignored). Latest on disk is **436**; next free number is **437**. Ship a matching `rollback_437_*.sql`.
- **Shadow-mode invariant:** nothing in Phase 2 reads or writes `sitecam_appeals.status`. The cron writes only `vlm_*` columns. There is a dedicated test that asserts no UPDATE touches `status`.
- **Fail-open policy = `uncertain` + `vlm_skip_reason`, NEVER a silent approve.** This is already enforced inside `evaluateAppeal`; the cron must persist it faithfully and must not invent an `approve`.
- Cron auth: bearer `process.env.CRON_SECRET`, identical guard to `auto-feedback`. **Never** hardcode or log the secret value (a prior `CRON_SECRET` leak is tracked for rotation — do not reintroduce it).
- No `console.log` — use `log` from `@/lib/logger`. No empty catch blocks. 100% type coverage. Files < 300 lines.
- No DGTS: real assertions, no `assert true`, no tautologies, no mocks masquerading as implementations.
- Never edit `STEP_CRITERIA` / `CIVIL_STEP_CRITERIA` or the appeal prompt builder — Phase 2 is wiring only.
- All work on the existing `feature/sitecam-appeals-vlm-phase1` branch (P1 is unmerged; P2 stacks on it). Gate on `npm run ci:quick` before the PR. **Stop at "PR opened" — do not merge or deploy** (wait for Hein).
- Do **not** hand-run migration 437 against the shared dev/prod DB. It is applied via the project migration runner against dev first, coordinated with Hein (Hard Rule 10).

---

### Task 1: Migration 437 — `job_type` column on `sitecam_appeals`

**Files:**
- Create: `scripts/migrations/sql/437_sitecam_appeals_job_type.sql`
- Create: `scripts/migrations/sql/rollback_437_sitecam_appeals_job_type.sql`

**Interfaces:**
- Consumes: existing `sitecam_appeals` table (migrations `402`, `436`).
- Produces: nullable column `job_type text CHECK (job_type IN ('activations','civils'))`. Nullable because pre-Phase-2 rows have no captured discipline; the cron treats `NULL` as `'activations'` (Task 4). New rows always populate it (Task 2).

- [ ] **Step 1: Write the forward migration**

`scripts/migrations/sql/437_sitecam_appeals_job_type.sql`:

```sql
-- scripts/migrations/sql/437_sitecam_appeals_job_type.sql
-- Auto-Appeals VLM, Phase 2. Captures the SiteCam discipline (activations|civils)
-- on each appeal so the scoring cron can select the correct step criteria and
-- gallery. Nullable: legacy rows predate capture and are treated as 'activations'
-- by the cron. See docs/superpowers/specs/2026-07-01-sitecam-appeals-vlm-design.md §5.3.
ALTER TABLE sitecam_appeals
  ADD COLUMN IF NOT EXISTS job_type text
      CHECK (job_type IN ('activations','civils'));
```

- [ ] **Step 2: Write the rollback migration**

`scripts/migrations/sql/rollback_437_sitecam_appeals_job_type.sql`:

```sql
-- Rollback for 437_sitecam_appeals_job_type.sql
ALTER TABLE sitecam_appeals DROP COLUMN IF EXISTS job_type;
```

- [ ] **Step 3: Verify idempotency by inspection**

Confirm `ADD COLUMN` uses `IF NOT EXISTS` and `DROP COLUMN` uses `IF EXISTS`. Re-running either file must be a no-op. No command needed — read check only. (Apply note: applied by the migration runner against dev first, coordinated with Hein — never hand-run against the shared DB.)

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/sql/437_sitecam_appeals_job_type.sql scripts/migrations/sql/rollback_437_sitecam_appeals_job_type.sql
git commit -m "feat(sitecam): migration 437 — job_type column on sitecam_appeals"
```

---

### Task 2: Capture `job_type` on appeal submit

**Files:**
- Modify: `src/modules/sitecam/components/AppealModal.tsx` (add `jobType` prop + POST field)
- Modify: `src/modules/sitecam/components/SiteCamWizard.tsx:116-134` (pass `jobType={siteInfo.jobType}`)
- Modify: `pages/api/my/sitecam/appeal.ts` (accept + validate + INSERT `job_type`)
- Test: `pages/api/my/sitecam/__tests__/appeal.test.ts` (create if absent)

**Interfaces:**
- Consumes: `SiteCamJobType` (`'activations' | 'civils'`) from `@/modules/sitecam/lib/sitecamSteps`; `siteInfo.jobType` already drives `getStepsForJobType` in the wizard.
- Produces: `sitecam_appeals.job_type` populated on every new appeal. The POST body of `/api/my/sitecam/appeal` gains a required `jobType: SiteCamJobType` field.

- [ ] **Step 1: Write the failing API test**

Create `pages/api/my/sitecam/__tests__/appeal.test.ts` (mirror the mocking style of `pages/api/cron/__tests__/auto-feedback.test.ts`). The submit path is wrapped in `withMySession`; mock it to inject a session, and mock the WA send + pool.

```ts
vi.mock('@/lib/db', () => ({ default: { query: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/modules/notifications/services/whatsappDelivery', () => ({ sendWhatsAppGroup: vi.fn() }));
// Bypass auth: run the inner handler with an injected session.
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession: (h: unknown) => (req: unknown, res: unknown) =>
    (h as (r: unknown, s: unknown, sess: unknown) => unknown)(req, res, { staffId: 'staff-1' }),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import handler from '../../../../../pages/api/my/sitecam/appeal'; // adjust relative depth to the file

const mockQuery = vi.mocked(pool.query);

function run(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', body });
  return (handler as unknown as (rq: NextApiRequest, rs: NextApiResponse) => Promise<void>)(req, res).then(() => res);
}

const baseBody = {
  drNumber: 'DR001', stepNumber: 6, appealText: 'green cable is visible',
  photoUrl: 'data:image/jpeg;base64,AAAA', attemptNumber: 3, jobType: 'activations',
};

describe('POST /api/my/sitecam/appeal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockImplementation((async (sql: string) => {
      if (sql.includes('FROM staff')) return { rows: [{ first_name: 'Ada', last_name: 'Lovelace' }], rowCount: 1 };
      if (sql.includes('INSERT INTO sitecam_appeals')) return { rows: [{ id: 'appeal-1' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }) as never);
  });

  it('persists job_type in the INSERT', async () => {
    const res = await run(baseBody);
    expect(res._getStatusCode()).toBe(200);
    const insert = mockQuery.mock.calls.map((c) => c[0] as string).find((s) => s.includes('INSERT INTO sitecam_appeals'));
    expect(insert).toContain('job_type');
    const insertCall = mockQuery.mock.calls.find((c) => (c[0] as string).includes('INSERT INTO sitecam_appeals'));
    expect(insertCall?.[1]).toContain('activations');
  });

  it('rejects an invalid job_type with 400', async () => {
    const res = await run({ ...baseBody, jobType: 'plumbing' });
    expect(res._getStatusCode()).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run pages/api/my/sitecam/__tests__/appeal.test.ts`
Expected: FAIL — INSERT does not contain `job_type`; invalid job_type is accepted (no 400).

- [ ] **Step 3: Update the API handler**

In `pages/api/my/sitecam/appeal.ts`:

Add the import at the top:
```ts
import type { SiteCamJobType } from '@/modules/sitecam/lib/sitecamSteps';
```

Add `jobType` to `AppealBody`:
```ts
interface AppealBody {
  drNumber: string;
  stepNumber: number;
  appealText: string;
  photoUrl: string;
  serialScanned?: string;
  serialExpected?: string;
  attemptNumber: number;
  jobType: SiteCamJobType;
}
```

Destructure and validate it (after the existing `data:image/` check, before the staff lookup):
```ts
const {
  drNumber, stepNumber, appealText, photoUrl,
  serialScanned, serialExpected, attemptNumber, jobType,
} = req.body as AppealBody;

// ...existing required-field + data:image/ checks...

if (jobType !== 'activations' && jobType !== 'civils')
  return apiResponse.badRequest(res, 'jobType must be "activations" or "civils"');
```

Add `job_type` to the INSERT:
```ts
const { rows } = await pool.query<{ id: string }>(
  `INSERT INTO sitecam_appeals
     (dr_number, step_number, technician_id, appeal_text, photo_url,
      serial_scanned, serial_expected, attempt_number, job_type)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
   RETURNING id`,
  [drNumber, stepNumber, session.staffId, appealText, photoUrl,
   serialScanned ?? null, serialExpected ?? null, attemptNumber, jobType],
);
```

- [ ] **Step 4: Thread `jobType` through the modal**

In `src/modules/sitecam/components/AppealModal.tsx`, add to `Props`:
```ts
import type { SiteCamJobType } from '@/modules/sitecam/lib/sitecamSteps';
// ...
  attemptNumber: number;
  jobType: SiteCamJobType;
```
Destructure it in the component signature (`attemptNumber, jobType,`) and add it to the POST body:
```ts
body: JSON.stringify({
  drNumber,
  stepNumber,
  appealText: text.trim(),
  photoUrl: photo,
  serialScanned,
  serialExpected,
  attemptNumber,
  jobType,
}),
```

In `src/modules/sitecam/components/SiteCamWizard.tsx`, add the prop to the `<AppealModal .../>` render (after `attemptNumber={...}`):
```tsx
jobType={siteInfo.jobType}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run pages/api/my/sitecam/__tests__/appeal.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Typecheck the touched modules**

Run: `npx tsc --noEmit`
Expected: no new errors in `AppealModal.tsx`, `SiteCamWizard.tsx`, `appeal.ts`.

- [ ] **Step 7: Commit**

```bash
git add pages/api/my/sitecam/appeal.ts pages/api/my/sitecam/__tests__/appeal.test.ts src/modules/sitecam/components/AppealModal.tsx src/modules/sitecam/components/SiteCamWizard.tsx
git commit -m "feat(sitecam): capture job_type on appeal submit (wizard → modal → API)"
```

---

### Task 3: `appealsVlmStore` — eligible-row SELECT + advisory UPDATE

**Files:**
- Create: `src/modules/sitecam/services/appealsVlmStore.ts`
- Test: `src/modules/sitecam/services/__tests__/appealsVlmStore.test.ts`

**Interfaces:**
- Consumes: `AppealEvaluation` and `AppealSkipReason` from `@/modules/sitecam/services/appealsVlmService`; `SiteCamJobType` from `@/modules/sitecam/lib/sitecamSteps`; `pool` from `@/lib/db`.
- Produces:
  - `interface PendingAppeal { id: string; dr_number: string; step_number: number; job_type: SiteCamJobType | null; photo_url: string | null; appeal_text: string; serial_scanned: string | null; serial_expected: string | null; }`
  - `findPendingAppeals(limit: number, maxAttempts: number): Promise<PendingAppeal[]>`
  - `recordEvaluation(id: string, evaluation: AppealEvaluation): Promise<void>` — terminal write, sets `vlm_evaluated_at = NOW()`, `vlm_attempts = vlm_attempts + 1`, never touches `status`.
  - `recordTransientFailure(id: string, evaluation: AppealEvaluation, maxAttempts: number): Promise<{ attempts: number; parked: boolean }>` — bumps `vlm_attempts`, sets `vlm_skip_reason`, leaves `vlm_evaluated_at` NULL so the row is retried until `vlm_attempts >= maxAttempts` (then the `findPendingAppeals` filter parks it). Never touches `status`.

- [ ] **Step 1: Write the failing test**

`src/modules/sitecam/services/__tests__/appealsVlmStore.test.ts`:

```ts
vi.mock('@/lib/db', () => ({ default: { query: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '@/lib/db';
import { findPendingAppeals, recordEvaluation, recordTransientFailure } from '../appealsVlmStore';
import type { AppealEvaluation } from '../appealsVlmService';

const mockQuery = vi.mocked(pool.query);

const evaluation: AppealEvaluation = {
  recommendation: 'approve', confidence: 0.9, reasoning: 'green cable visible',
  checks: [{ name: 'reason_matches_photo', verdict: 'pass', evidence: 'cable present' }],
  serialRead: null, model: 'qwen/appeal-v1', skipReason: null,
};

describe('appealsVlmStore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('findPendingAppeals selects only pending, unscored, under-cap rows and never filters on vlm status write', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    await findPendingAppeals(10, 3);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain('vlm_evaluated_at IS NULL');
    expect(sql).toContain('vlm_attempts');
    expect(sql).toContain('job_type');
  });

  it('recordEvaluation writes vlm_* incl. evaluated_at and NEVER touches status', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);
    await recordEvaluation('appeal-1', evaluation);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE sitecam_appeals');
    expect(sql).toContain('vlm_recommendation');
    expect(sql).toContain('vlm_evaluated_at = NOW()');
    expect(sql).not.toMatch(/\bstatus\s*=/); // shadow-mode invariant
    // vlm_checks persisted as JSON
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params.some((p) => typeof p === 'string' && p.includes('reason_matches_photo'))).toBe(true);
  });

  it('recordTransientFailure bumps attempts, sets skip_reason, leaves evaluated_at NULL, and reports parked at the cap', async () => {
    mockQuery.mockResolvedValue({ rows: [{ vlm_attempts: 3 }], rowCount: 1 } as never);
    const out = await recordTransientFailure('appeal-1', { ...evaluation, recommendation: 'uncertain', skipReason: 'vlm_unavailable' }, 3);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('vlm_attempts = COALESCE(vlm_attempts, 0) + 1');
    expect(sql).toContain('vlm_skip_reason');
    expect(sql).not.toContain('vlm_evaluated_at = NOW()');
    expect(sql).not.toMatch(/\bstatus\s*=/);
    expect(out).toEqual({ attempts: 3, parked: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/sitecam/services/__tests__/appealsVlmStore.test.ts`
Expected: FAIL with "Cannot find module '../appealsVlmStore'".

- [ ] **Step 3: Write the implementation**

`src/modules/sitecam/services/appealsVlmStore.ts`:

```ts
/**
 * Persistence for the appeals-VLM scoring cron (shadow mode). Owns the eligible-row
 * SELECT and the advisory UPDATE. Splits terminal results (set `vlm_evaluated_at`,
 * done) from transient VLM outages (bump `vlm_attempts`, retry until a cap parks
 * the row). NEVER writes `sitecam_appeals.status` — shadow-mode invariant.
 */
import pool from '@/lib/db';
import type { SiteCamJobType } from '@/modules/sitecam/lib/sitecamSteps';
import type { AppealEvaluation } from './appealsVlmService';

export interface PendingAppeal {
  id: string;
  dr_number: string;
  step_number: number;
  job_type: SiteCamJobType | null;
  photo_url: string | null;
  appeal_text: string;
  serial_scanned: string | null;
  serial_expected: string | null;
}

/** Pending, not-yet-scored appeals under the attempt cap, oldest first. */
export async function findPendingAppeals(limit: number, maxAttempts: number): Promise<PendingAppeal[]> {
  const { rows } = await pool.query<PendingAppeal>(
    `SELECT id, dr_number, step_number, job_type, photo_url,
            appeal_text, serial_scanned, serial_expected
     FROM sitecam_appeals
     WHERE status = 'pending'
       AND vlm_evaluated_at IS NULL
       AND COALESCE(vlm_attempts, 0) < $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [maxAttempts, limit],
  );
  return rows;
}

/** Terminal advisory write. Sets vlm_evaluated_at so the row is never re-scored. */
export async function recordEvaluation(id: string, evaluation: AppealEvaluation): Promise<void> {
  await pool.query(
    `UPDATE sitecam_appeals
     SET vlm_recommendation = $2,
         vlm_confidence     = $3,
         vlm_reasoning      = $4,
         vlm_checks         = $5::jsonb,
         vlm_serial_read    = $6,
         vlm_model          = $7,
         vlm_skip_reason    = $8,
         vlm_attempts       = COALESCE(vlm_attempts, 0) + 1,
         vlm_evaluated_at   = NOW()
     WHERE id = $1`,
    [
      id,
      evaluation.recommendation,
      evaluation.confidence,
      evaluation.reasoning,
      JSON.stringify(evaluation.checks),
      evaluation.serialRead ?? null,
      evaluation.model,
      evaluation.skipReason,
    ],
  );
}

/**
 * Transient outage: bump the attempt counter and record the skip reason, but leave
 * vlm_evaluated_at NULL so the row is retried next tick. Once vlm_attempts reaches
 * maxAttempts the findPendingAppeals filter stops selecting it (parked).
 */
export async function recordTransientFailure(
  id: string,
  evaluation: AppealEvaluation,
  maxAttempts: number,
): Promise<{ attempts: number; parked: boolean }> {
  const { rows } = await pool.query<{ vlm_attempts: number }>(
    `UPDATE sitecam_appeals
     SET vlm_attempts    = COALESCE(vlm_attempts, 0) + 1,
         vlm_skip_reason = $2
     WHERE id = $1
     RETURNING vlm_attempts`,
    [id, evaluation.skipReason],
  );
  const attempts = rows[0]?.vlm_attempts ?? 0;
  return { attempts, parked: attempts >= maxAttempts };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/modules/sitecam/services/__tests__/appealsVlmStore.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add src/modules/sitecam/services/appealsVlmStore.ts src/modules/sitecam/services/__tests__/appealsVlmStore.test.ts
git commit -m "feat(sitecam): appealsVlmStore — eligible-row select + advisory (shadow) update"
```

---

### Task 4: `/api/cron/appeals-vlm` — the scoring cron

**Files:**
- Create: `pages/api/cron/appeals-vlm.ts`
- Test: `pages/api/cron/__tests__/appeals-vlm.test.ts`

**Interfaces:**
- Consumes: `findPendingAppeals`, `recordEvaluation`, `recordTransientFailure`, `PendingAppeal` (Task 3); `evaluateAppeal`, `AppealInput` (`@/modules/sitecam/services/appealsVlmService`); `apiResponse`, `ErrorCode` (`@/lib/apiResponse`); `log` (`@/lib/logger`).
- Produces: a Next.js API handler (`export default`). Response `data`: `{ processed: number; scored: number; retried: number }`. `scored` = terminal writes; `retried` = transient failures (incl. parked).

Behaviour rules (from spec §5.8 + fail-open policy):
- GET or POST only; else 405.
- Missing `CRON_SECRET` env → 500. Wrong/absent bearer → 401.
- Batch limit `BATCH_LIMIT = 10`; attempt cap `MAX_ATTEMPTS = 3`.
- `photo_url` is a `data:image/…;base64,…` URI; strip the prefix to raw base64 before building `AppealInput` (the service expects raw base64).
- `job_type` NULL (legacy) → treat as `'activations'`.
- Route the result: `skipReason === 'vlm_unavailable'` → `recordTransientFailure` (retry); everything else (real approve/deny, or terminal `uncertain` with `no_photo`/`unsupported_step`/`unreadable_image`, or `skipReason === null`) → `recordEvaluation`.
- A thrown error while processing one appeal is logged and skipped — it must not abort the batch.

- [ ] **Step 1: Write the failing test**

`pages/api/cron/__tests__/appeals-vlm.test.ts`:

```ts
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/modules/sitecam/services/appealsVlmStore', () => ({
  findPendingAppeals: vi.fn(),
  recordEvaluation: vi.fn(),
  recordTransientFailure: vi.fn(),
}));
vi.mock('@/modules/sitecam/services/appealsVlmService', () => ({
  evaluateAppeal: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../appeals-vlm';
import { findPendingAppeals, recordEvaluation, recordTransientFailure } from '@/modules/sitecam/services/appealsVlmStore';
import { evaluateAppeal } from '@/modules/sitecam/services/appealsVlmService';

const mockFind = vi.mocked(findPendingAppeals);
const mockRecord = vi.mocked(recordEvaluation);
const mockRetry = vi.mocked(recordTransientFailure);
const mockEval = vi.mocked(evaluateAppeal);

const SECRET = 'test-cron-secret';
const AUTH = { authorization: `Bearer ${SECRET}` };

function run(headers: Record<string, string>, method: 'GET' | 'POST' | 'PUT' = 'POST') {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method, headers });
  return handler(req, res).then(() => res);
}

const pendingPhoto = {
  id: 'a1', dr_number: 'DR001', step_number: 6, job_type: 'activations',
  photo_url: 'data:image/jpeg;base64,AAAA', appeal_text: 'green cable visible',
  serial_scanned: null, serial_expected: null,
};
const approve = { recommendation: 'approve', confidence: 0.9, reasoning: 'ok', checks: [], serialRead: null, model: 'm', skipReason: null };

describe('POST /api/cron/appeals-vlm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    mockFind.mockResolvedValue([]);
    mockRetry.mockResolvedValue({ attempts: 1, parked: false });
  });

  it('rejects non-GET/POST with 405', async () => {
    expect((await run(AUTH, 'PUT'))._getStatusCode()).toBe(405);
  });
  it('returns 500 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    expect((await run(AUTH))._getStatusCode()).toBe(500);
  });
  it('returns 401 on a missing bearer', async () => {
    expect((await run({}))._getStatusCode()).toBe(401);
  });
  it('returns 401 on a wrong bearer', async () => {
    expect((await run({ authorization: 'Bearer nope' }))._getStatusCode()).toBe(401);
  });

  it('processed:0 when nothing is pending', async () => {
    const res = await run(AUTH);
    expect(res._getJSONData().data).toMatchObject({ processed: 0, scored: 0, retried: 0 });
  });

  it('scores a photo appeal: strips the data URI, defaults job_type, records terminal', async () => {
    mockFind.mockResolvedValue([pendingPhoto] as never);
    mockEval.mockResolvedValue(approve as never);
    const res = await run(AUTH);
    // raw base64 passed to the evaluator (prefix stripped)
    expect(mockEval).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'activations', stepNumber: 6, photoBase64: 'AAAA', appealText: 'green cable visible',
    }));
    expect(mockRecord).toHaveBeenCalledWith('a1', approve);
    expect(mockRetry).not.toHaveBeenCalled();
    expect(res._getJSONData().data).toMatchObject({ processed: 1, scored: 1, retried: 0 });
  });

  it('defaults a NULL job_type to activations', async () => {
    mockFind.mockResolvedValue([{ ...pendingPhoto, job_type: null }] as never);
    mockEval.mockResolvedValue(approve as never);
    await run(AUTH);
    expect(mockEval).toHaveBeenCalledWith(expect.objectContaining({ jobType: 'activations' }));
  });

  it('routes a transient VLM outage to recordTransientFailure (retry), not a terminal write', async () => {
    mockFind.mockResolvedValue([pendingPhoto] as never);
    mockEval.mockResolvedValue({ ...approve, recommendation: 'uncertain', skipReason: 'vlm_unavailable' } as never);
    const res = await run(AUTH);
    expect(mockRetry).toHaveBeenCalledWith('a1', expect.objectContaining({ skipReason: 'vlm_unavailable' }), 3);
    expect(mockRecord).not.toHaveBeenCalled();
    expect(res._getJSONData().data).toMatchObject({ processed: 1, scored: 0, retried: 1 });
  });

  it('records a terminal uncertain (unsupported_step) rather than retrying', async () => {
    mockFind.mockResolvedValue([pendingPhoto] as never);
    mockEval.mockResolvedValue({ ...approve, recommendation: 'uncertain', skipReason: 'unsupported_step' } as never);
    await run(AUTH);
    expect(mockRecord).toHaveBeenCalledOnce();
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it('a thrown evaluator error skips that appeal without aborting the batch', async () => {
    mockFind.mockResolvedValue([pendingPhoto, { ...pendingPhoto, id: 'a2' }] as never);
    mockEval.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(approve as never);
    const res = await run(AUTH);
    expect(mockRecord).toHaveBeenCalledWith('a2', approve);
    expect(res._getJSONData().data).toMatchObject({ processed: 2, scored: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run pages/api/cron/__tests__/appeals-vlm.test.ts`
Expected: FAIL with "Cannot find module '../appeals-vlm'".

- [ ] **Step 3: Write the cron handler**

`pages/api/cron/appeals-vlm.ts`:

```ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { SiteCamJobType } from '@/modules/sitecam/lib/sitecamSteps';
import { evaluateAppeal, type AppealInput } from '@/modules/sitecam/services/appealsVlmService';
import {
  findPendingAppeals,
  recordEvaluation,
  recordTransientFailure,
  type PendingAppeal,
} from '@/modules/sitecam/services/appealsVlmStore';

const MODULE = 'AppealsVlmCron';
const BATCH_LIMIT = 10;
// A transient VLM outage retries until this cap, then findPendingAppeals parks the row.
const MAX_ATTEMPTS = 3;

/** Strip the `data:image/…;base64,` prefix — the evaluator expects raw base64. */
function toRawBase64(dataUri: string | null): string {
  return (dataUri ?? '').replace(/^data:image\/[^;]+;base64,/, '');
}

function toAppealInput(a: PendingAppeal): AppealInput {
  return {
    jobType: (a.job_type ?? 'activations') as SiteCamJobType,
    stepNumber: a.step_number,
    photoBase64: toRawBase64(a.photo_url),
    appealText: a.appeal_text,
    serialScanned: a.serial_scanned,
    serialExpected: a.serial_expected,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET not configured', undefined, MODULE);
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Server misconfigured: CRON_SECRET not set');
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    return apiResponse.unauthorized(res, 'Invalid or missing cron secret');
  }

  try {
    const appeals = await findPendingAppeals(BATCH_LIMIT, MAX_ATTEMPTS);
    log.info(`Appeals VLM: ${appeals.length} pending`, undefined, MODULE);

    let scored = 0;
    let retried = 0;

    for (const appeal of appeals) {
      try {
        const evaluation = await evaluateAppeal(toAppealInput(appeal));
        // Only a transient VLM outage is retryable; every other outcome — a real
        // approve/deny or a terminal uncertain (no_photo/unsupported_step/
        // unreadable_image) — is written once and never re-scored.
        if (evaluation.skipReason === 'vlm_unavailable') {
          const { attempts, parked } = await recordTransientFailure(appeal.id, evaluation, MAX_ATTEMPTS);
          retried++;
          if (parked) {
            log.error(`Appeal ${appeal.id} parked after ${attempts} VLM outages`, undefined, MODULE);
          } else {
            log.warn(`Appeal ${appeal.id} VLM unavailable — attempt ${attempts}/${MAX_ATTEMPTS}, will retry`, undefined, MODULE);
          }
        } else {
          await recordEvaluation(appeal.id, evaluation);
          scored++;
          log.info(`Appeal ${appeal.id} scored: ${evaluation.recommendation} (${evaluation.confidence})`, undefined, MODULE);
        }
      } catch (err) {
        log.error(`Unexpected error scoring appeal ${appeal.id}`, { err: String(err) }, MODULE);
      }
    }

    return apiResponse.success(res, { processed: appeals.length, scored, retried });
  } catch (err) {
    log.error('Appeals VLM cron failed', { err: String(err) }, MODULE);
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Appeals VLM cron failed');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run pages/api/cron/__tests__/appeals-vlm.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add pages/api/cron/appeals-vlm.ts pages/api/cron/__tests__/appeals-vlm.test.ts
git commit -m "feat(sitecam): appeals-vlm scoring cron (shadow mode, batch + retry cap)"
```

---

### Task 5: Full gate + ops note

**Files:** none (verification + docs only).

- [ ] **Step 1: Run the sitecam + cron test subset**

Run: `npx vitest run pages/api/cron/__tests__/appeals-vlm.test.ts src/modules/sitecam/services/__tests__ pages/api/my/sitecam/__tests__/appeal.test.ts`
Expected: all PASS.

- [ ] **Step 2: Run the local CI gate**

Run: `npm run ci:quick`
Expected: PASS (lint + type gates). Fix any failure before proceeding — never `--no-verify`.

- [ ] **Step 3: Record the cron-registration ops step (attached to this phase, applied by Hein at deploy)**

The cron is **not** self-scheduling. Registration mirrors `cron-auto-qa` / `cron-auto-feedback` (systemd timer or crontab on Velocity, calling the route with `Authorization: Bearer $CRON_SECRET`). Suggested cadence: **every 5 minutes** (spec §7 open item 7a, batch 10). This is an ops action for deploy time, listed in the PR description — do not run it here. Reference the secret only as `$CRON_SECRET` (never the value).

- [ ] **Step 4: (No commit)** — proceed to open the PR per the finishing-a-development-branch flow once P3/P4 are also built, or open a P2-only PR if stopping here. **Stop at "PR opened" — wait for Hein.**

---

## Self-Review

**1. Spec coverage (P2 scope):**
- §4 Approach A async cron → Task 4. ✅
- §5.1 architecture (cron → evaluate → vlm_* → advisory) → Tasks 3+4. ✅
- §5.2 idempotency (pick `vlm_evaluated_at IS NULL`), attempt cap/park → Task 3 `findPendingAppeals` + `recordTransientFailure`. ✅
- §5.8 auth (bearer CRON_SECRET), fail-open→uncertain persisted, batch limit, downscale-before-VLM (already inside `evaluateAppeal`) → Task 4. ✅
- Shadow-mode invariant (never write `status`) → asserted in Tasks 3 & 4 tests. ✅
- Job-type provenance (2026-07-03 decision) → Tasks 1+2. ✅

**2. Placeholder scan:** No TBD/TODO; every code + test step shows full content. ✅

**3. Type consistency:** `PendingAppeal`, `AppealInput`, `AppealEvaluation`, `SiteCamJobType`, and the `{ processed, scored, retried }` response shape are used identically across Tasks 3–4. `recordTransientFailure(id, evaluation, maxAttempts)` signature matches its call site. Data-URI stripping (`toRawBase64`) feeds `AppealInput.photoBase64` (documented "raw base64, no data: prefix"). ✅

---

## Execution Handoff

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.

After P2, Phase 3 (reviewer UI advisory badge/panel) and Phase 4 (HITL loop) each get their own plan before implementation.
