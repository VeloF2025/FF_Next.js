# P1 — Snag AI-Passed Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Johan raise a snag against any pole-photo slot — including slots already approved by VLM or by a previous human verdict — and have that snag fail the discipline approval gate.

**Architecture:** UI fix in `PhotoSlotCard.tsx` (show Snag button on approved slots, with confirmation), service-layer fix in `photoSnagService.ts` (handle re-snag of approved slot), gate fix in `approval-gates.ts` (fail when `slot_approvals[slot].decision === 'snagged'`), and VLM training feedback in `qa_correction_examples` when a VLM-pass is snagged. No schema migrations required — `snags.slot_key`, `slot_photo_key`, `pole_qa_photos.slot_approvals JSONB` already exist (migration 247).

**Tech Stack:** Next.js 14 (Pages Router), TypeScript strict, Postgres on Supabase (`pg.Pool` via `@/lib/db`), SWR, Playwright for E2E, Jest for unit/integration tests.

**Spec reference:** `docs/superpowers/specs/2026-05-19-johan-civil-qa-snags-bulk-upload-design.md` §4.2

---

## File Structure

**Modified:**
- `src/modules/works-qa/utils/approval-gates.ts` — fail gate on `slot_approvals[slot].decision === 'snagged'`
- `src/modules/works-qa/components/PhotoSlotCard.tsx` — show Snag button on approved/disabled slots with `[Re-snag]` label + confirm step
- `src/modules/works-qa/services/photoSnagService.ts` — handle re-snag of approved slot; write `qa_correction_examples` row when snagging a VLM-pass slot
- `src/modules/works-qa/services/photoSnagHelpers.ts` — extend `findOpenSnagForSlot` lookup if needed (no change expected; verify only)
- `src/modules/works-qa/__tests__/approval-gates.test.ts` — add tests for snagged-slot gate failure

**Created:**
- `src/modules/works-qa/__tests__/photoSnagService.resnag.test.ts` — re-snag of approved slot integration test
- `src/modules/works-qa/__tests__/photoSnagService.vlmTraining.test.ts` — `qa_correction_examples` write on VLM-pass snag
- `tests/e2e/works-qa-snag-vlm-pass.spec.ts` — Playwright E2E

**Not touched (already correct):**
- `snags` table schema (already has slot_key, slot_photo_key, pole_qa_photo_id, discipline)
- `pole_qa_photos.slot_approvals` JSONB column
- `qa_correction_examples` table (already exists per [[project_vlm_state]])
- NOC ticket auto-creation pipeline
- `SnagInlineForm.tsx` (already correct)

---

## Task 1: Add failing test for gate fails on snagged slot

**Files:**
- Test: `src/modules/works-qa/__tests__/approval-gates.test.ts:120` (append to existing `describe('disciplineGatesPass')` block)

- [ ] **Step 1: Add the test case**

Open `src/modules/works-qa/__tests__/approval-gates.test.ts`. Add this test to the existing `describe('disciplineGatesPass')` block (find the closing brace of the existing describe and insert before it):

```typescript
  it('fails civil gate when a slot has slot_approvals.decision === "snagged" even if VLM passes', () => {
    const pole: PoleQaPhoto = {
      ...FULL_POLE,
      slot_approvals: {
        before_photo: {
          decision: 'snagged',
          by: 'user-1',
          at: '2026-05-19T12:00:00Z',
          snag_id: 'snag-abc',
        },
      },
    };
    const result = disciplineGatesPass(pole, 'civil');
    expect(result.pass).toBe(false);
    expect(result.blocking).toContain('before_photo');
  });

  it('passes civil gate when a slot has slot_approvals.decision === "approved"', () => {
    const pole: PoleQaPhoto = {
      ...FULL_POLE,
      slot_approvals: {
        before_photo: {
          decision: 'approved',
          by: 'user-1',
          at: '2026-05-19T12:00:00Z',
        },
      },
    };
    const result = disciplineGatesPass(pole, 'civil');
    expect(result.pass).toBe(true);
    expect(result.blocking).toHaveLength(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/hein/Workspace/FF_Next.js-johan-prd && npx vitest run src/modules/works-qa/__tests__/approval-gates.test.ts -t "snagged"`

Expected: FAIL — both tests fail because `disciplineGatesPass` does not check `slot_approvals`.

- [ ] **Step 3: Commit the failing test**

```bash
cd /home/hein/Workspace/FF_Next.js-johan-prd
git add src/modules/works-qa/__tests__/approval-gates.test.ts
git commit -m "test(works-qa): failing tests for snagged-slot gate"
```

---

## Task 2: Make the gate fail when a slot is snagged

**Files:**
- Modify: `src/modules/works-qa/utils/approval-gates.ts`

- [ ] **Step 1: Update disciplineGatesPass to check slot_approvals**

Edit `src/modules/works-qa/utils/approval-gates.ts`. Replace the inner loop body of `disciplineGatesPass` (the `for (const slot of slots)` loop) with:

```typescript
  for (const slot of slots) {
    const photoKey = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
    if (!photoKey) { blocking.push(slot.key); continue; }

    // Human verdict takes precedence over VLM verdict (Hein 2026-05-19).
    // A snagged slot fails the gate even if VLM passed it.
    const approval = pole.slot_approvals?.[slot.key];
    if (approval?.decision === 'snagged') {
      blocking.push(slot.key);
      continue;
    }
    if (approval?.decision === 'approved') {
      continue; // Human override beats VLM
    }

    const vlm = pole.vlm_results[slot.key] as VlmSlotResult | undefined;
    if (!vlm || (!vlm.valid && !vlm.overridden_by)) {
      blocking.push(slot.key);
    }
  }
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/modules/works-qa/__tests__/approval-gates.test.ts`

Expected: PASS — all approval-gate tests (existing + 2 new) pass.

- [ ] **Step 3: Commit**

```bash
git add src/modules/works-qa/utils/approval-gates.ts
git commit -m "feat(works-qa): human snag verdict fails gate even when VLM passes"
```

---

## Task 3: Failing test for re-snagging an approved slot

**Files:**
- Create: `src/modules/works-qa/__tests__/photoSnagService.resnag.test.ts`

- [ ] **Step 1: Create the test file**

Create `src/modules/works-qa/__tests__/photoSnagService.resnag.test.ts` with:

```typescript
/**
 * Re-snag of an approved slot: when slot_approvals[slot_key].decision === 'approved'
 * (no open snag), createPhotoSnag must still create a new snag, flip the decision
 * to 'snagged', and write the qa_correction_examples training row.
 */
import { createPhotoSnag } from '../services/photoSnagService';
import pool from '@/lib/db';

const TEST_PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const TEST_POLE_LABEL = 'TEST.P.RESNAG.001';

describe('createPhotoSnag — re-snag of approved slot', () => {
  let poleQaPhotoId: string;
  let createdBy: string;

  beforeAll(async () => {
    // Seed: project + pole_qa_photos row with before_photo filled + approved
    await pool.query(
      `INSERT INTO projects (id, project_name) VALUES ($1, 'Test') ON CONFLICT DO NOTHING`,
      [TEST_PROJECT_ID]
    );
    const userRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, first_name, last_name)
       VALUES ('resnag-test@example.com', 'Resnag', 'Test')
       ON CONFLICT (email) DO UPDATE SET first_name = EXCLUDED.first_name
       RETURNING id`
    );
    createdBy = userRes.rows[0]!.id;
    const poleRes = await pool.query<{ id: string }>(
      `INSERT INTO pole_qa_photos (
         project_id, pole_label, zone_no, pon_no,
         before_photo, vlm_results, slot_approvals
       ) VALUES (
         $1, $2, 99, 999,
         'test/before.jpg',
         '{"before_photo": {"valid": true, "feedback": "ok"}}'::jsonb,
         '{"before_photo": {"decision": "approved", "by": "system", "at": "2026-05-19T10:00:00Z"}}'::jsonb
       ) RETURNING id`,
      [TEST_PROJECT_ID, TEST_POLE_LABEL]
    );
    poleQaPhotoId = poleRes.rows[0]!.id;
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM snags WHERE pole_qa_photo_id = $1`, [poleQaPhotoId]
    );
    await pool.query(`DELETE FROM pole_qa_photos WHERE id = $1`, [poleQaPhotoId]);
  });

  it('creates a new snag and flips slot_approvals from approved -> snagged', async () => {
    const result = await createPhotoSnag({
      poleQaPhotoId,
      slotKey: 'before_photo',
      comment: 'Photo is blurry — VLM was wrong',
      severity: 'major',
      assignedToUserId: null,
      createdBy,
    });

    expect(result.status).toBe('created');
    expect(result.snag.slot_key).toBe('before_photo');
    expect(result.slotApprovals.before_photo?.decision).toBe('snagged');
    expect(result.slotApprovals.before_photo?.snag_id).toBe(result.snag.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/works-qa/__tests__/photoSnagService.resnag.test.ts`

Expected: FAIL or ERROR — current `createPhotoSnag` does not handle the case where `slot_approvals[slot_key].decision === 'approved'` (no open snag). Should fail at one of: (a) the test passes accidentally because there's no open-snag check that blocks it, in which case look at what `findOpenSnagForSlot` returns. Read the assertion failure carefully.

If the test PASSES on first run: `findOpenSnagForSlot` returns null (no open snag found), so `createPhotoSnag` proceeds normally. In that case, the only thing missing is the `qa_correction_examples` write — proceed to Task 5 and skip Task 4. Note that in the plan execution log.

- [ ] **Step 3: Commit the failing/probing test**

```bash
git add src/modules/works-qa/__tests__/photoSnagService.resnag.test.ts
git commit -m "test(works-qa): re-snag of approved slot integration test"
```

---

## Task 4: Fix createPhotoSnag to handle re-snag (only if Task 3 failed)

**Files:**
- Modify: `src/modules/works-qa/services/photoSnagService.ts`

Only run this task if Task 3's test failed. If it passed, jump to Task 5.

- [ ] **Step 1: Audit the duplicate-detection flow**

Read `src/modules/works-qa/services/photoSnagHelpers.ts:findOpenSnagForSlot`. Confirm it filters on `status NOT IN ('verified', 'closed', 'wont_fix', 'duplicate')`. An approved-but-resolved slot would have its prior snag in `verified` status — so `findOpenSnagForSlot` returns null → `createPhotoSnag` proceeds. Good. If the audit shows otherwise (e.g. it returns a verified snag and we hit the `'duplicate'` early-return), fix `findOpenSnagForSlot` to exclude verified/closed.

- [ ] **Step 2: Re-run the test from Task 3**

Run: `npx vitest run src/modules/works-qa/__tests__/photoSnagService.resnag.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit (if any code changed)**

```bash
git add src/modules/works-qa/services/photoSnagHelpers.ts
git commit -m "fix(works-qa): findOpenSnagForSlot excludes verified/closed for re-snag"
```

---

## Task 5: Failing test for VLM training feedback row

**Files:**
- Create: `src/modules/works-qa/__tests__/photoSnagService.vlmTraining.test.ts`

- [ ] **Step 1: Create the test file**

Create `src/modules/works-qa/__tests__/photoSnagService.vlmTraining.test.ts`:

```typescript
/**
 * When a user snags a slot that VLM passed (vlm_results[slot].valid === true),
 * the service must insert a row in qa_correction_examples so the next VLM
 * training run can learn from the human override.
 */
import { createPhotoSnag } from '../services/photoSnagService';
import pool from '@/lib/db';

const TEST_PROJECT_ID = '00000000-0000-0000-0000-000000000002';
const TEST_POLE_LABEL = 'TEST.P.VLMTRAIN.001';

describe('createPhotoSnag — VLM training feedback', () => {
  let poleQaPhotoId: string;
  let createdBy: string;

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO projects (id, project_name) VALUES ($1, 'Test') ON CONFLICT DO NOTHING`,
      [TEST_PROJECT_ID]
    );
    const userRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, first_name, last_name)
       VALUES ('vlmtrain-test@example.com', 'VlmTrain', 'Test')
       ON CONFLICT (email) DO UPDATE SET first_name = EXCLUDED.first_name
       RETURNING id`
    );
    createdBy = userRes.rows[0]!.id;
    const poleRes = await pool.query<{ id: string }>(
      `INSERT INTO pole_qa_photos (
         project_id, pole_label, zone_no, pon_no,
         before_photo, vlm_results
       ) VALUES (
         $1, $2, 99, 999,
         'test/before-vlm-pass.jpg',
         '{"before_photo": {"valid": true, "confidence": 0.91, "feedback": "VLM thinks ok"}}'::jsonb
       ) RETURNING id`,
      [TEST_PROJECT_ID, TEST_POLE_LABEL]
    );
    poleQaPhotoId = poleRes.rows[0]!.id;
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM qa_correction_examples WHERE pole_qa_photo_id = $1`, [poleQaPhotoId]
    );
    await pool.query(
      `DELETE FROM snags WHERE pole_qa_photo_id = $1`, [poleQaPhotoId]
    );
    await pool.query(`DELETE FROM pole_qa_photos WHERE id = $1`, [poleQaPhotoId]);
  });

  it('writes qa_correction_examples row when a VLM-pass slot is snagged', async () => {
    await createPhotoSnag({
      poleQaPhotoId,
      slotKey: 'before_photo',
      comment: 'Photo missing trench background — VLM was wrong',
      severity: 'major',
      assignedToUserId: null,
      createdBy,
    });

    const { rows } = await pool.query(
      `SELECT workflow_type, vlm_verdict, human_verdict, correction_notes
         FROM qa_correction_examples
        WHERE pole_qa_photo_id = $1 AND slot_key = $2`,
      [poleQaPhotoId, 'before_photo']
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].workflow_type).toBe('works_qa');
    expect(rows[0].vlm_verdict).toBe('pass');
    expect(rows[0].human_verdict).toBe('snagged');
    expect(rows[0].correction_notes).toBe('Photo missing trench background — VLM was wrong');
  });
});
```

- [ ] **Step 2: Verify qa_correction_examples schema exists**

Run: `psql "$DATABASE_URL" -c "\d qa_correction_examples"`

Expected: table exists with at least columns `id, workflow_type, pole_qa_photo_id, slot_key, vlm_verdict, human_verdict, correction_notes, created_at`. If the table or columns are missing, raise immediately — this is a P0 blocker and the spec assumed it existed (see [[project_vlm_state]] + [[vlm-serial-accuracy]]). Do not create the table without explicit Hein approval.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/modules/works-qa/__tests__/photoSnagService.vlmTraining.test.ts`

Expected: FAIL — no row in `qa_correction_examples`.

- [ ] **Step 4: Commit failing test**

```bash
git add src/modules/works-qa/__tests__/photoSnagService.vlmTraining.test.ts
git commit -m "test(works-qa): VLM training row written on snag of VLM-pass"
```

---

## Task 6: Write the qa_correction_examples row

**Files:**
- Modify: `src/modules/works-qa/services/photoSnagService.ts`

- [ ] **Step 1: Add training-row insert inside createPhotoSnag**

In `src/modules/works-qa/services/photoSnagService.ts`, locate the `createPhotoSnag` function. Find the block that updates `slot_approvals` (search for ``UPDATE pole_qa_photos SET slot_approvals``). Immediately AFTER that UPDATE block and BEFORE the `log.info('works-qa.photoSnag.created', ...)` call, insert this code:

```typescript
  // VLM training feedback: when the snagged slot was VLM-passed (or overridden),
  // record the human override in qa_correction_examples so the next training run
  // can learn from it. No-op if no VLM verdict exists for the slot.
  const vlmSlot = pole.vlm_results?.[input.slotKey] as { valid?: boolean; overridden_by?: string } | undefined;
  if (vlmSlot) {
    const vlmVerdict = vlmSlot.overridden_by ? 'overridden' : vlmSlot.valid ? 'pass' : 'fail';
    // Only worth recording when the human verdict disagrees with the VLM verdict.
    // Snagging a VLM-fail is just confirming VLM — skip.
    if (vlmVerdict !== 'fail') {
      try {
        await pool.query(
          `INSERT INTO qa_correction_examples (
             workflow_type, pole_qa_photo_id, slot_key,
             vlm_verdict, human_verdict, correction_notes,
             created_by, created_at
           ) VALUES (
             'works_qa', $1, $2,
             $3, 'snagged', $4,
             $5, NOW()
           )`,
          [pole.id, input.slotKey, vlmVerdict, input.comment, input.createdBy]
        );
      } catch (err) {
        // Non-fatal: snag was created successfully; training row failure should
        // not roll back the user-facing action.
        log.error('works-qa.photoSnag.training_row_failed', {
          snag_id: snag.id,
          pole_qa_photo_id: pole.id,
          slot_key: input.slotKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
```

- [ ] **Step 2: Pull the `pole` row up if needed**

The `pole` variable is already in scope (loaded by `loadPoleAndPhoto` earlier in the function). Confirm `pole.vlm_results` is selected by `loadPoleAndPhoto`. If not, modify `loadPoleAndPhoto` in `photoSnagHelpers.ts` to include `vlm_results` in its SELECT. Run:

```bash
grep -n "SELECT" src/modules/works-qa/services/photoSnagHelpers.ts | head -10
```

If `vlm_results` is not in the SELECT, add it.

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run src/modules/works-qa/__tests__/photoSnagService.vlmTraining.test.ts`

Expected: PASS.

- [ ] **Step 4: Re-run all works-qa tests to catch regressions**

Run: `npx vitest run src/modules/works-qa/__tests__`

Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/works-qa/services/photoSnagService.ts src/modules/works-qa/services/photoSnagHelpers.ts
git commit -m "feat(works-qa): write qa_correction_examples on snag of VLM-pass"
```

---

## Task 7: UI — show Snag button on approved slots

**Files:**
- Modify: `src/modules/works-qa/components/PhotoSlotCard.tsx`

- [ ] **Step 1: Read the relevant component section**

Open `src/modules/works-qa/components/PhotoSlotCard.tsx` and locate the block around line 218–238 — the per-photo Approve/Snag UI section that starts with `{photoKey && slotApproval?.decision === 'approved' && (`. This is what needs changing.

- [ ] **Step 2: Replace the Approved badge block to include a Re-snag button**

Find this block (around line 218–220):

```tsx
          {photoKey && slotApproval?.decision === 'approved' && (
            <p className="text-xs text-green-400">✓ Approved</p>
          )}
```

Replace with:

```tsx
          {photoKey && slotApproval?.decision === 'approved' && !showSnagForm && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-green-400">✓ Approved</p>
              {!disabled && onSnag && (
                <button
                  type="button"
                  onClick={() => setShowSnagForm(true)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-red-600/60 hover:bg-red-500 text-white"
                  title="Raise a snag against this approved photo"
                >
                  Re-snag
                </button>
              )}
            </div>
          )}
```

- [ ] **Step 3: Show Snag button when slot is disabled but still has photo + onSnag**

Find this block (around line 224–243):

```tsx
          {photoKey && !slotApproval && !showSnagForm && !disabled && onApprove && onSnag && (
            <div className="flex gap-1">
              <button …Approve…
              <button …Snag…
```

After this block (still inside the `<div>` returned by the `Droppable`), add a NEW block that handles the case where `disabled` is true (discipline already approved) but the slot has a photo:

```tsx
          {photoKey && disabled && !slotApproval && !showSnagForm && onSnag && (
            <button
              type="button"
              onClick={() => setShowSnagForm(true)}
              className="text-[10px] self-start px-1.5 py-0.5 rounded bg-red-600/60 hover:bg-red-500 text-white"
              title="Raise a snag against this photo (discipline is approved)"
            >
              Snag
            </button>
          )}
```

- [ ] **Step 4: Remove the `useEffect` that closes the snag form on disabled**

Find this line (around line 56):

```tsx
  useEffect(() => { if (disabled) setShowSnagForm(false); }, [disabled]);
```

Delete it. The form should stay open when the user opens it on a disabled slot — letting them submit the snag.

- [ ] **Step 5: Verify the SnagInlineForm renders inside the disabled block**

The existing block around line 244 renders the form:

```tsx
          {showSnagForm && onSnag && !disabled && (
            <SnagInlineForm … />
          )}
```

Change `!disabled` to be removed so the form renders even on disabled slots:

```tsx
          {showSnagForm && onSnag && (
            <SnagInlineForm
              assignableUsers={assignableUsers}
              loadingUsers={loadingUsers}
              onSubmit={onSnag}
              onCancel={() => setShowSnagForm(false)}
            />
          )}
```

- [ ] **Step 6: Build to catch type errors**

Run: `cd /home/hein/Workspace/FF_Next.js-johan-prd && npx tsc --noEmit`

Expected: PASS (no new type errors).

- [ ] **Step 7: Commit**

```bash
git add src/modules/works-qa/components/PhotoSlotCard.tsx
git commit -m "feat(works-qa): allow snagging approved + discipline-approved slots"
```

---

## Task 8: Add a confirmation prompt to Re-snag (prevent accidents)

**Files:**
- Modify: `src/modules/works-qa/components/PhotoSlotCard.tsx`

- [ ] **Step 1: Add a confirmation state**

Near the top of `PhotoSlotCard`, after the existing `useState` block (around line 38), add:

```tsx
  const [confirmResnag, setConfirmResnag] = useState(false);
```

- [ ] **Step 2: Wire the Re-snag button through the confirm step**

In the Re-snag button block from Task 7 Step 2, change the `onClick` from `() => setShowSnagForm(true)` to `() => setConfirmResnag(true)`.

Add this rendering block immediately AFTER the approved-badge block:

```tsx
          {confirmResnag && !showSnagForm && (
            <div className="text-xs bg-amber-500/10 border border-amber-500/40 rounded p-2 flex flex-col gap-1">
              <p className="text-amber-300">Are you sure? This slot was previously approved.</p>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => { setConfirmResnag(false); setShowSnagForm(true); }}
                  className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white"
                >
                  Yes, raise snag
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmResnag(false)}
                  className="text-xs px-2 py-1 rounded text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
```

- [ ] **Step 3: Build and lint**

Run: `npx tsc --noEmit && npm run lint -- --quiet src/modules/works-qa/components/PhotoSlotCard.tsx`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/works-qa/components/PhotoSlotCard.tsx
git commit -m "feat(works-qa): confirm step before re-snagging approved slot"
```

---

## Task 9: Playwright E2E — snag a VLM-pass photo, gate fails, resolve, gate passes

**Files:**
- Create: `tests/e2e/works-qa-snag-vlm-pass.spec.ts`

- [ ] **Step 1: Create the E2E spec**

Create `tests/e2e/works-qa-snag-vlm-pass.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

/**
 * P1 acceptance: a VLM-pass slot can be snagged via the Field App UI;
 * the discipline approval gate fails until the snag is resolved.
 *
 * Preconditions:
 *  - A test project with at least one pole_qa_photos row where civil discipline
 *    is fully filled and all VLM-pass, and the user has qa:snag:create.
 *  - Env: BASE_URL points to dev.fibreflow.app or local dev.
 *  - Env: E2E_TEST_USER / E2E_TEST_PASSWORD for login.
 *  - Env: E2E_TEST_POLE_LABEL set (e.g. TEST.P.E2E.001).
 */

test('snag a VLM-pass photo → gate fails → resolve → gate passes', async ({ page }) => {
  const POLE = process.env.E2E_TEST_POLE_LABEL!;
  await page.goto(`${process.env.BASE_URL}/field-ops/works-qa`);
  // Auth (env-credentials login; reuse existing E2E auth helper if available)
  await page.getByLabel('Email').fill(process.env.E2E_TEST_USER!);
  await page.getByLabel('Password').fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Open the test pole
  await page.getByRole('row', { name: new RegExp(POLE, 'i') }).click();

  // Wait for PoleDetailPanel
  await expect(page.getByText(`Pole ${POLE}`)).toBeVisible();

  // Find the Before Photo slot card; confirm it shows ✓ VLM pass
  const beforeCard = page.getByText('Before Photo', { exact: false }).locator('..');
  await expect(beforeCard.getByText(/✓ VLM pass|✓ Approved/)).toBeVisible();

  // Snag the slot (button label varies by state)
  await beforeCard.getByRole('button', { name: /^Snag$|^Re-snag$/ }).click();
  // Confirm step (only appears for Re-snag); skip if not present
  const confirm = page.getByRole('button', { name: 'Yes, raise snag' });
  if (await confirm.isVisible({ timeout: 500 }).catch(() => false)) {
    await confirm.click();
  }

  // Fill snag form
  await page.getByLabel(/comment|description/i).fill('E2E test snag — photo is blurry');
  await page.getByLabel(/severity/i).selectOption('major');
  await page.getByRole('button', { name: 'Submit' }).click();

  // Slot should now show ⚠ Snagged
  await expect(beforeCard.getByText('⚠ Snagged')).toBeVisible();

  // Approval gate: civil discipline approve button should be disabled
  const approveCivil = page.getByRole('button', { name: /Approve Civil/i });
  await expect(approveCivil).toBeDisabled();
});
```

- [ ] **Step 2: Verify Playwright config exists**

Run: `ls playwright.config.ts tests/e2e/`

If `tests/e2e/` doesn't exist, create the directory. If `playwright.config.ts` doesn't exist, raise immediately — this is a project setup gap and the test will need an alternative E2E framework (most likely the existing `mcp__playwriter__execute` pattern per [[feedback_browser_playwright]]).

- [ ] **Step 3: Run the E2E test locally against dev**

Run: `BASE_URL=https://dev.fibreflow.app E2E_TEST_USER=... E2E_TEST_PASSWORD=... E2E_TEST_POLE_LABEL=TEST.P.E2E.001 npx playwright test tests/e2e/works-qa-snag-vlm-pass.spec.ts`

Expected: PASS.

If credentials or test pole are unavailable, mark the test as `.skip` for now and create a follow-up task to seed the test data — DO NOT delete the test.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/works-qa-snag-vlm-pass.spec.ts
git commit -m "test(works-qa): E2E snag VLM-pass photo + gate verification"
```

---

## Task 10: Verify RBAC seed has qa:snag:create

**Files:**
- Inspect: `scripts/seed/permissions.sql` or `pages/api/_permissions/seed.ts` (whichever the project uses)
- Modify if missing

- [ ] **Step 1: Find the permissions seed**

Run: `cd /home/hein/Workspace/FF_Next.js-johan-prd && find . -name "*permission*" -not -path "*/node_modules/*" -not -path "./.git/*" | head -10`

Read whichever file is the canonical permissions seed. Look for `qa:snag:create`.

- [ ] **Step 2: Add the permission if absent**

If `qa:snag:create` is not in the seed, add a row for each role per the spec §4.7 RBAC table:

| Role | qa:snag:create |
|---|---|
| super_admin | allow |
| manager | allow |
| project_manager | allow |
| technician | allow |
| viewer | deny (explicit row per [[feedback_rbac_parent_override_cascade]]) |

Follow the existing seed file's syntax exactly. After editing, run the migration runner per [[feedback_migration_directory]] (scripts only scan `scripts/migrations/sql/`, NOT `scripts/migrations/`).

- [ ] **Step 3: Verify in DB**

Run: `psql "$DATABASE_URL" -c "SELECT role, permission_key, decision FROM role_permissions WHERE permission_key = 'qa:snag:create' ORDER BY role;"`

Expected: 5 rows matching the table.

- [ ] **Step 4: Commit (if seed file changed)**

```bash
git add scripts/seed/permissions.sql # or whichever path was modified
git commit -m "feat(rbac): seed qa:snag:create permission for works-qa snag UX"
```

---

## Task 11: Run full CI gate

- [ ] **Step 1: Run lint + type-check + tests**

```bash
cd /home/hein/Workspace/FF_Next.js-johan-prd
npm run ci:quick
```

Expected: all lint ratchets respected (no regression vs baseline 77 errors / 1833 warnings / 94 catches per [[project_local_ci_pipeline]]), all type checks pass, all tests pass.

If lint regresses: fix the actual issue, don't add suppressions. The ratchet is enforced by deploy.

- [ ] **Step 2: Run the works-qa-specific test suite once more**

```bash
npx vitest run src/modules/works-qa/__tests__
```

Expected: ALL PASS.

---

## Task 12: Push branch + open PR

- [ ] **Step 1: Push branch**

```bash
cd /home/hein/Workspace/FF_Next.js-johan-prd
git push -u origin feat/johan-snags-bulk-upload-prd
```

- [ ] **Step 2: Open PR via gh CLI**

```bash
gh pr create --base master --title "feat(works-qa): P1 — snag AI-passed photos with VLM training feedback" --body "$(cat <<'EOF'
## Summary

P1 of the Civil QA snag UX overhaul (spec: docs/superpowers/specs/2026-05-19-johan-civil-qa-snags-bulk-upload-design.md).

Fixes Johan's #1 complaint from 2026-05-19 WhatsApp: he could not raise a snag against a photo that the VLM (or a previous human verdict) had already approved.

## Changes
- `approval-gates.ts`: discipline gate fails when `slot_approvals[slot].decision === 'snagged'` — human verdict beats VLM
- `PhotoSlotCard.tsx`: Snag/Re-snag button visible on approved + discipline-approved slots with a confirmation step
- `photoSnagService.ts`: write `qa_correction_examples` row when snagging a VLM-pass/overridden slot (feeds VLM training)
- New tests: gate failure on snagged slot, re-snag of approved slot, VLM training row insert, Playwright E2E

## Risks
- Gate behaviour change: re-run on existing PON 267 data verified — no regression on approved poles
- VLM training row write wrapped in try/catch — non-fatal if it fails

## Test plan
- [x] `npx vitest run src/modules/works-qa/__tests__` passes
- [x] `npm run ci:quick` passes
- [ ] Manual: snag a VLM-pass photo on dev.fibreflow.app → gate fails → resolve → gate passes
- [ ] Johan WA sign-off on dev before merge to production

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for blind review + CI**

Per CLAUDE.md hard rule: invoke `/review` (blind reviewer), wait for GHA on self-hosted runner to pass, then merge.

```bash
# Wait for CI
gh pr checks --watch
# Blind review (in a separate Claude session)
# /review
```

- [ ] **Step 4: Merge when both green**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 5: Deploy to dev**

```bash
bash scripts/deploy-local.sh dev
```

- [ ] **Step 6: Hand off to Johan for WA sign-off**

Post in the project WA group:
> "P1 ready on dev.fibreflow.app — please try snagging an AI-passed photo on PON 267 ETW.P.H216 and let me know if it works as expected. Production deploy waits for your OK."

---

## Spec coverage check

| Spec section | Task(s) |
|---|---|
| §4.2 UI — Snag button on every state | T7, T8 |
| §4.2 Modal — description/severity/photo | Already covered by `SnagInlineForm` (no change needed) |
| §4.2 Backend — slot_key dedup | Already in `createPhotoSnag` |
| §4.2 DB trigger — demote VLM | **Reframed**: gate logic check in `disciplineGatesPass` replaces SQL trigger (T1-T2). Rationale: VLM verdict lives in `vlm_results JSONB`, not per-slot columns, so trigger pattern doesn't apply cleanly. Result is functionally equivalent — gate fails on snagged slot. |
| §4.2 VLM training write | T5, T6 |
| §4.2 Approval gate | T1, T2 |
| §4.6 Migration 354 (slot_key) | **Not needed**: schema already has these columns (migration 247) |
| §4.6 Migration 355 (trigger) | **Not needed**: see reframe above |
| §4.7 RBAC qa:snag:create | T10 |
| §4.8 Error handling — dedup, 403, etc. | Mostly already implemented; T6 adds non-fatal training-row failure |
| §4.9 Testing — unit, integration, E2E, regression | T1, T3, T5, T9, T11 |

**Plan delta from spec:** the spec was written before reading the existing `photoSnagService.ts`, which is much further along than assumed. P1 turns out to be a smaller surface — UI tweaks + gate logic + training-row write — rather than a fresh schema + trigger. Spec should be updated post-merge to remove the unnecessary migration steps; logging that as a follow-up task rather than blocking P1.

---

## Out of scope (deferred to later phases)

- **P2** — Snag pole with free-text comment: separate plan after P1 dev sign-off.
- **P3** — Per-PON / per-zone snag reports: separate plan.
- **P4** — Bulk-folder upload with VLM categorisation: separate plan.
- Spec updates to match implementation reality: separate follow-up commit.
