# SiteCam Auto-Appeals VLM — Phase 3 + 4 (Reviewer UI + Agreement Capture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the advisory VLM recommendation to reviewers on `/activate/sitecam-appeals` (P3), and capture `human_agreed_with_vlm` on every human decision (P4) — closing the *observability* loop the shadow phase needs (spec §6 agreement rate).

**Architecture:** Extend the existing appeals list API to return the `vlm_*` advisory columns; render them in `SiteCamAppealsQueue` as a badge (recommendation + confidence) plus an expandable reasoning/checks panel; and compute agreement in the decision endpoint's existing UPDATE (a SQL `CASE` over the row's `vlm_recommendation` vs the human decision — no extra round-trip). Everything stays shadow-mode: the recommendation is advisory, the human buttons are unchanged.

**Tech Stack:** TypeScript, Next.js API routes + Pages, React, Vitest + node-mocks-http, PostgreSQL via `@/lib/db`.

**Source spec:** `docs/superpowers/specs/2026-07-01-sitecam-appeals-vlm-design.md` (§5.5 reviewer UI, §5.6 HITL agreement signal; roadmap **P3** + the agreement-capture half of **P4**).

**Scope note — deferred:** The §5.6/§5.7.1 *disagreement → few-shot* pipeline (write appeal outcomes into the gallery) is **out of scope** here and gets its own designed phase. Rationale: the appeals VLM few-shot store is the image gallery `vlm_visual_photo_examples` (URL-based, VF-Storage-resolved), not the text `qa_correction_examples` tables; appeal photos are inline base64 with no URL, so feeding one in needs a storage-upload + pHash pipeline; and auto-writing to the curated gallery needs a human curation gate (standing rule: gallery anchors on QA-curated PASSED examples, civils uncurated). It is also only useful once shadow agreement data exists. This is the spec's own **[OPEN 5.6a]**.

## Global Constraints

- **Shadow-mode invariant:** the recommendation is advisory. The decision endpoint's write to `human_agreed_with_vlm` is additive; the approve/deny buttons and their effect on `status` are unchanged.
- Reviewer endpoints stay `withAuth(withRole('manager'))`. No auth changes.
- `human_agreed_with_vlm` is `NULL` when there is no comparable recommendation (`vlm_recommendation` is NULL or `'uncertain'`), `true`/`false` otherwise.
- No `console.log` — use `log` from `@/lib/logger`. No empty catch blocks. 100% type coverage. Files < 300 lines (the component is 185 lines; keep the badge/panel additions tight).
- No DGTS: real assertions.
- Continue on `feature/sitecam-appeals-vlm-phase1` (stacks on P1+P2). Gate on `npm run ci:quick`. **Stop at "PR opened" — do not merge/deploy.**

---

### Task 1: List API returns the `vlm_*` advisory fields

**Files:**
- Modify: `pages/api/activate/sitecam-appeals.ts` (SELECT + returned columns)
- Test: `pages/api/activate/__tests__/sitecam-appeals.test.ts` (create)

**Interfaces:**
- Produces: each appeal row additionally carries `job_type`, `vlm_recommendation`, `vlm_confidence`, `vlm_reasoning`, `vlm_checks`, `vlm_serial_read`, `vlm_skip_reason`, `vlm_evaluated_at`, `human_agreed_with_vlm`. Consumed by the `Appeal` interface in Task 2.

- [ ] **Step 1: Write the failing test**

`pages/api/activate/__tests__/sitecam-appeals.test.ts`:

```ts
vi.mock('@/lib/db', () => ({ default: { query: vi.fn() } }));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withRole: () => (h: unknown) => h,
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import handler from '../sitecam-appeals';

const mockQuery = vi.mocked(pool.query);

function run(query: Record<string, string>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'GET', query });
  return (handler as unknown as (rq: NextApiRequest, rs: NextApiResponse) => Promise<void>)(req, res).then(() => res);
}

describe('GET /api/activate/sitecam-appeals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
  });

  it('selects the advisory vlm_* columns', async () => {
    await run({ status: 'pending' });
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('vlm_recommendation');
    expect(sql).toContain('vlm_confidence');
    expect(sql).toContain('vlm_reasoning');
    expect(sql).toContain('vlm_checks');
    expect(sql).toContain('vlm_serial_read');
    expect(sql).toContain('human_agreed_with_vlm');
  });

  it('rejects a bad status with 400', async () => {
    const res = await run({ status: 'bogus' });
    expect(res._getStatusCode()).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run pages/api/activate/__tests__/sitecam-appeals.test.ts`
Expected: FAIL — SELECT does not contain `vlm_recommendation`.

- [ ] **Step 3: Extend the SELECT**

In `pages/api/activate/sitecam-appeals.ts`, replace the SELECT column list:

```ts
  const { rows } = await pool.query(
    `SELECT a.id, a.dr_number, a.step_number, a.job_type, a.appeal_text, a.photo_url,
            a.serial_scanned, a.serial_expected, a.attempt_number,
            a.status, a.decided_via, a.decided_at, a.denial_reason, a.created_at,
            a.vlm_recommendation, a.vlm_confidence, a.vlm_reasoning, a.vlm_checks,
            a.vlm_serial_read, a.vlm_skip_reason, a.vlm_evaluated_at, a.human_agreed_with_vlm,
            s.first_name || ' ' || s.last_name AS tech_name
     FROM sitecam_appeals a
     LEFT JOIN staff s ON s.id = a.technician_id
     WHERE a.status = $1
     ORDER BY a.created_at DESC
     LIMIT 100`,
    [statusFilter],
  );
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run pages/api/activate/__tests__/sitecam-appeals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pages/api/activate/sitecam-appeals.ts pages/api/activate/__tests__/sitecam-appeals.test.ts
git commit -m "feat(sitecam): return advisory vlm_* columns from appeals list API"
```

---

### Task 2: Reviewer UI — advisory badge + reasoning panel + agreement

**Files:**
- Modify: `src/modules/activate/components/SiteCamAppealsQueue.tsx`

**Interfaces:**
- Consumes: the extended appeal rows from Task 1.
- Produces: (UI only) a recommendation badge in each row header; a reasoning/checks/serial panel in the expanded body; an agreement indicator on the approved/denied tabs.

- [ ] **Step 1: Extend the `Appeal` interface + add the badge type**

In `SiteCamAppealsQueue.tsx`, extend the interface (after `denial_reason`):

```ts
interface AppealCheck { name: string; verdict: 'pass' | 'fail' | 'uncertain'; evidence: string }

interface Appeal {
  id: string;
  dr_number: string;
  step_number: number;
  appeal_text: string;
  photo_url: string;
  serial_scanned: string | null;
  serial_expected: string | null;
  attempt_number: number;
  status: 'pending' | 'approved' | 'denied';
  created_at: string;
  tech_name: string | null;
  denial_reason: string | null;
  vlm_recommendation: 'approve' | 'deny' | 'uncertain' | null;
  vlm_confidence: number | null;
  vlm_reasoning: string | null;
  vlm_checks: AppealCheck[] | null;
  vlm_serial_read: string | null;
  vlm_skip_reason: string | null;
  human_agreed_with_vlm: boolean | null;
}
```

- [ ] **Step 2: Add a badge renderer (module-scope helper, above the component)**

```tsx
const REC_STYLES: Record<'approve' | 'deny' | 'uncertain', string> = {
  approve: 'bg-green-100 text-green-700',
  deny: 'bg-red-100 text-red-700',
  uncertain: 'bg-neutral-100 text-neutral-500',
};

function AiBadge({ appeal }: { appeal: Appeal }) {
  const rec = appeal.vlm_recommendation;
  if (!rec) return null;
  const pct = appeal.vlm_confidence != null ? ` ${Math.round(appeal.vlm_confidence * 100)}%` : '';
  const label = rec === 'uncertain' ? 'AI: Uncertain' : `AI: ${rec === 'approve' ? 'Approve' : 'Deny'}${pct}`;
  return (
    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${REC_STYLES[rec]}`}>
      {label}
    </span>
  );
}
```

- [ ] **Step 3: Render the badge in the row header**

In the header `<div>` (right after the `tech_name` span, before the closing `</div>` that precedes the chevron), add:

```tsx
                    <AiBadge appeal={a} />
                    {a.status !== 'pending' && a.human_agreed_with_vlm !== null && (
                      <span className={`ml-2 text-xs ${a.human_agreed_with_vlm ? 'text-green-600' : 'text-amber-600'}`}>
                        {a.human_agreed_with_vlm ? '✓ agreed' : '✗ disagreed'}
                      </span>
                    )}
```

- [ ] **Step 4: Render the reasoning/checks panel in the expanded body**

In the expanded `<div>` body, after the `appeal_text` paragraph and before the serial block, add:

```tsx
                    {a.vlm_recommendation && (
                      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 space-y-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-neutral-600">
                          <span>VLM recommendation</span>
                          <AiBadge appeal={a} />
                          {a.vlm_skip_reason && <span className="text-neutral-400">({a.vlm_skip_reason})</span>}
                        </div>
                        {a.vlm_reasoning && <p className="text-sm text-neutral-700">{a.vlm_reasoning}</p>}
                        {a.vlm_serial_read && (
                          <p className="text-xs text-neutral-500">Serial read: <span className="font-mono">{a.vlm_serial_read}</span></p>
                        )}
                        {a.vlm_checks && a.vlm_checks.length > 0 && (
                          <ul className="space-y-1">
                            {a.vlm_checks.map((c, i) => (
                              <li key={i} className="text-xs text-neutral-500">
                                <span className={c.verdict === 'pass' ? 'text-green-600' : c.verdict === 'fail' ? 'text-red-600' : 'text-neutral-400'}>
                                  {c.verdict}
                                </span>{' '}
                                <span className="font-medium">{c.name}</span> — {c.evidence}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `SiteCamAppealsQueue.tsx`. Confirm the file is still < 300 lines.

- [ ] **Step 6: Commit**

```bash
git add src/modules/activate/components/SiteCamAppealsQueue.tsx
git commit -m "feat(sitecam): advisory VLM badge + reasoning panel + agreement in appeals queue"
```

---

### Task 3: Decision endpoint captures `human_agreed_with_vlm`

**Files:**
- Modify: `pages/api/activate/sitecam-appeals/[id]/decision.ts`
- Test: `pages/api/activate/sitecam-appeals/[id]/__tests__/decision.test.ts` (create)

**Interfaces:**
- Produces: on every decision, `sitecam_appeals.human_agreed_with_vlm` is set — `true` when the human decision matches the advisory recommendation, `false` when it contradicts a definite recommendation, `NULL` when there was no comparable recommendation.

- [ ] **Step 1: Write the failing test**

`pages/api/activate/sitecam-appeals/[id]/__tests__/decision.test.ts`:

```ts
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withRole: () => (h: unknown) => h,
}));
const client = { query: vi.fn(), release: vi.fn() };
vi.mock('@/lib/db', () => ({ default: { connect: vi.fn(() => Promise.resolve(client)) } }));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../decision';

function run(id: string, body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', query: { id }, body });
  (req as unknown as { user: { id: string } }).user = { id: 'mgr-1' };
  return (handler as unknown as (rq: NextApiRequest, rs: NextApiResponse) => Promise<void>)(req, res).then(() => res);
}

describe('POST /api/activate/sitecam-appeals/[id]/decision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.query.mockImplementation((sql: string) => {
      if (sql.includes('UPDATE sitecam_appeals')) return Promise.resolve({ rows: [{ dr_number: 'DR001', step_number: 6 }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  });

  it('computes human_agreed_with_vlm in the UPDATE', async () => {
    const res = await run('a1', { decision: 'approved' });
    expect(res._getStatusCode()).toBe(200);
    const update = client.query.mock.calls.map((c: unknown[]) => c[0] as string).find((s) => s.includes('UPDATE sitecam_appeals'));
    expect(update).toContain('human_agreed_with_vlm');
    // agreement is derived from vlm_recommendation vs the decision, and NULL for uncertain/none
    expect(update).toContain('vlm_recommendation');
    expect(update).toMatch(/uncertain/);
  });

  it('rejects an invalid decision with 400', async () => {
    const res = await run('a1', { decision: 'maybe' });
    expect(res._getStatusCode()).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run "pages/api/activate/sitecam-appeals/[id]/__tests__/decision.test.ts"`
Expected: FAIL — UPDATE does not contain `human_agreed_with_vlm`.

- [ ] **Step 3: Add the agreement computation to the UPDATE**

In `decision.ts`, replace the UPDATE query with (adds one SET clause + returns the new fields):

```ts
    const { rows } = await client.query<{ dr_number: string; step_number: number }>(
      `UPDATE sitecam_appeals
       SET status = $1,
           decided_by = $2,
           decided_via = 'in_app',
           decided_at = now(),
           denial_reason = $3,
           human_agreed_with_vlm = CASE
             WHEN vlm_recommendation IS NULL OR vlm_recommendation = 'uncertain' THEN NULL
             WHEN vlm_recommendation = 'approve' AND $1 = 'approved' THEN true
             WHEN vlm_recommendation = 'deny'    AND $1 = 'denied'   THEN true
             ELSE false
           END
       WHERE id = $4
       RETURNING dr_number, step_number`,
      [decision, decidedBy, denialReason ?? null, id],
    );
```

(The `CASE` reads the row's pre-update `vlm_recommendation`, so no extra query is needed. `status` is only ever `'approved'`/`'denied'`; the advisory recommendation is `'approve'`/`'deny'`/`'uncertain'`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run "pages/api/activate/sitecam-appeals/[id]/__tests__/decision.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "pages/api/activate/sitecam-appeals/[id]/decision.ts" "pages/api/activate/sitecam-appeals/[id]/__tests__/decision.test.ts"
git commit -m "feat(sitecam): capture human_agreed_with_vlm on appeal decision (shadow HITL signal)"
```

---

### Task 4: Full gate + deferred-loop note

**Files:** none (verification only).

- [ ] **Step 1: Run the appeals test subset**

Run: `npx vitest run pages/api/activate/__tests__/sitecam-appeals.test.ts "pages/api/activate/sitecam-appeals/[id]/__tests__/decision.test.ts"`
Expected: all PASS.

- [ ] **Step 2: Run the local CI gate**

Run: `npm run ci:quick`
Expected: PASS. Fix any changed-file failure before proceeding — never `--no-verify`.

- [ ] **Step 3: Record the deferred phase**

The §5.6/§5.7.1 disagreement→few-shot pipeline remains **unbuilt by design** (see Scope note). Its own design pass should decide: (a) the store (extend the image gallery `vlm_visual_photo_examples` vs a new `sitecam_appeal_examples`), (b) how an inline base64 appeal photo becomes a gallery URL (storage upload + pHash), (c) the human curation gate before anything enters the curated gallery, and (d) activations-vs-civils coverage. Blocked on real shadow agreement data (spec §6) — do not build speculatively.

---

## Self-Review

**1. Spec coverage:** §5.5 reviewer badge + reasoning/checks panel → Task 2. §5.6 agreement signal (`human_agreed_with_vlm`) → Task 3. §5.6/§5.7.1 few-shot loop → explicitly deferred with rationale (Task 4 note). ✅

**2. Placeholder scan:** No TBD/TODO; every code + test step shows full content. ✅

**3. Type consistency:** `AppealCheck { name, verdict, evidence }` matches `appealsVlmService.AppealCheck` and the `vlm_checks` jsonb shape written by `recordEvaluation`. `vlm_recommendation` union (`approve|deny|uncertain|null`) matches the migration-436 CHECK. The list API returns exactly the fields the `Appeal` interface consumes. Agreement `CASE` maps `approved↔approve`, `denied↔deny`, NULL for uncertain/none — consistent with the boolean/NULL contract. ✅

---

## Execution Handoff

Inline execution, test-first, commit per task (continuing the P2 session style). After this, the full **shadow-mode** feature is built (P1–P4 minus the deferred few-shot loop); open one PR for the whole buildout and **stop for Hein**.
