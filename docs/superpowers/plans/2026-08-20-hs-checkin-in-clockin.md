# H&S check-in inside the clock-in — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the H&S daily declaration a set of steps inside the `/my` clock-in flow, so a worker completes it as part of the action they already have a reason to complete.

**Architecture:** The clock-in commits first via the existing unchanged endpoint; the flow then continues into the safety questions, which post to the existing `POST /api/my/hs/checkin`. Two requests, in that order, so no H&S failure can cost a worker their shift start. The worker declares Office or a project rather than the system inferring site-worker status — there is no site data to infer from.

**Tech Stack:** Next.js 14 Pages Router, TypeScript, vitest, Postgres (self-hosted Supabase), Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-20-hs-checkin-clockin-merge-design.md`

## Global Constraints

- All changes go through a PR. Never commit to master.
- `npm run ci:quick` must pass before every PR. Never `--no-verify`.
- New files <300 lines, new components <200 lines.
- No `console.log` — use `log` from `@/lib/logger`. No empty catch blocks.
- Migrations: next free version is **493**. A `rollback_493_*.sql` must accompany it.
- `hs_daily_checkins` has exactly one writer: `src/modules/health-safety/services/checkinWrite.ts`. Do not add a second.
- The H&S API's documented invariant holds: nothing in the H&S path may fail a clock-in.
- Office rows have `project_id IS NULL`. Site rows must keep a project.
- vitest here is 0.34 — `fileParallelism` is silently ignored; DB-touching tests use `threads: false`.

---

### Task 1: Migration — `work_location` and a nullable project

**Files:**
- Create: `scripts/migrations/sql/493_hs_checkin_work_location.sql`
- Create: `scripts/migrations/sql/rollback_493_hs_checkin_work_location.sql`
- Test: `src/modules/health-safety/__tests__/checkinWorkLocationMigration.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: column `hs_daily_checkins.work_location text NOT NULL DEFAULT 'site'`, constraint `hs_daily_checkins_site_needs_project`, `project_id` nullable.

- [ ] **Step 1: Write the migration**

`scripts/migrations/sql/493_hs_checkin_work_location.sql`:

```sql
-- 493: H&S check-in gains an explicit work location.
--
-- The check-in is moving inside the clock-in, where every worker passes
-- through — including office staff, who have no project. `work_location` is
-- what the worker declares; `project_id` stays required for a site
-- declaration and becomes NULL for an office one.
--
-- Existing rows are all site declarations: every one of them carries a
-- project, which was NOT NULL until this migration.

ALTER TABLE hs_daily_checkins
  ADD COLUMN IF NOT EXISTS work_location text NOT NULL DEFAULT 'site';

ALTER TABLE hs_daily_checkins
  ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE hs_daily_checkins
  DROP CONSTRAINT IF EXISTS hs_daily_checkins_work_location_check;
ALTER TABLE hs_daily_checkins
  ADD CONSTRAINT hs_daily_checkins_work_location_check
  CHECK (work_location IN ('site', 'office'));

-- A site declaration without a project would be unattributable on the officer
-- board, so the old NOT NULL is preserved for exactly that case.
ALTER TABLE hs_daily_checkins
  DROP CONSTRAINT IF EXISTS hs_daily_checkins_site_needs_project;
ALTER TABLE hs_daily_checkins
  ADD CONSTRAINT hs_daily_checkins_site_needs_project
  CHECK (work_location <> 'site' OR project_id IS NOT NULL);
```

- [ ] **Step 2: Write the rollback**

`scripts/migrations/sql/rollback_493_hs_checkin_work_location.sql`:

```sql
-- Rollback 493. Office rows have no project and cannot satisfy the restored
-- NOT NULL, so they are deleted — they carry no payroll or attendance meaning,
-- only a fitness declaration that the worker can re-submit.
DELETE FROM hs_daily_checkins WHERE work_location = 'office';

ALTER TABLE hs_daily_checkins
  DROP CONSTRAINT IF EXISTS hs_daily_checkins_site_needs_project;
ALTER TABLE hs_daily_checkins
  DROP CONSTRAINT IF EXISTS hs_daily_checkins_work_location_check;
ALTER TABLE hs_daily_checkins
  ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE hs_daily_checkins
  DROP COLUMN IF EXISTS work_location;
```

- [ ] **Step 3: Write the failing test**

Follow the existing pattern in `src/modules/health-safety/__tests__/checkinSchemaSync.test.ts` for how this repo stands up a real Postgres for migration tests. Read that file first and mirror its setup/teardown exactly.

`src/modules/health-safety/__tests__/checkinWorkLocationMigration.test.ts`:

```typescript
/**
 * Migration 493 against a real Postgres. A mock cannot tell you whether a
 * CHECK constraint actually rejects the row it is supposed to reject.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('migration 493: hs_daily_checkins.work_location', () => {
  it('defaults existing rows to site', async () => {
    const rows = await query(
      `SELECT work_location FROM hs_daily_checkins LIMIT 1`
    );
    expect(rows[0]?.work_location).toBe('site');
  });

  it('accepts an office row with no project', async () => {
    await expect(insertCheckin({ work_location: 'office', project_id: null }))
      .resolves.toBeDefined();
  });

  it('rejects a site row with no project', async () => {
    // The negative assertion is paired with the positive one above so this
    // cannot pass because the insert failed for some unrelated reason.
    await expect(insertCheckin({ work_location: 'site', project_id: null }))
      .rejects.toThrow(/hs_daily_checkins_site_needs_project/);
  });

  it('rejects an unknown work_location', async () => {
    await expect(insertCheckin({ work_location: 'moon', project_id: null }))
      .rejects.toThrow(/hs_daily_checkins_work_location_check/);
  });
});
```

Write the real `query` / `insertCheckin` helpers against the harness used by `checkinSchemaSync.test.ts`. `insertCheckin` must supply every other NOT NULL column on the table — read the current schema with `\d hs_daily_checkins` before writing it.

- [ ] **Step 4: Run the test, verify it fails**

```bash
npx vitest run src/modules/health-safety/__tests__/checkinWorkLocationMigration.test.ts
```
Expected: FAIL — `column "work_location" does not exist`.

- [ ] **Step 5: Apply the migration to your test database, run the test again**

Expected: PASS, all four cases.

- [ ] **Step 6: Verify the rollback is reversible**

Apply `rollback_493`, confirm the column is gone and `project_id` is NOT NULL again, then re-apply 493. Both directions must be clean.

- [ ] **Step 7: Commit**

```bash
git add scripts/migrations/sql/493_hs_checkin_work_location.sql \
        scripts/migrations/sql/rollback_493_hs_checkin_work_location.sql \
        src/modules/health-safety/__tests__/checkinWorkLocationMigration.test.ts
git commit -m "feat(hs): add work_location to daily check-ins, project optional for office"
```

> **Deploy note for whoever ships this:** `scripts/deploy-local.sh dev` applies migrations to the SHARED production database. Migration 493 is additive and safe to land ahead of the code, but be deliberate about when you run it.

---

### Task 2: Clearance branch for office declarations

**Files:**
- Modify: `src/modules/health-safety/types/checkin.types.ts`
- Modify: `src/modules/health-safety/services/checkinClearance.ts:39-50` (the `ClearanceInput` interface) and `:65-97` (`deriveClearance`)
- Test: `src/modules/health-safety/__tests__/checkinClearanceOffice.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 at the type level.
- Produces:
  - `export type CheckinWorkLocation = 'site' | 'office'` in `checkin.types.ts`
  - `ClearanceInput` gains `work_location: CheckinWorkLocation`
  - `deriveClearance(input: ClearanceInput): ClearanceResult` — signature unchanged, behaviour branched

- [ ] **Step 1: Write the failing test**

`src/modules/health-safety/__tests__/checkinClearanceOffice.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { deriveClearance } from '@/modules/health-safety/services/checkinClearance';

const officeBase = {
  work_location: 'office' as const,
  fit_for_duty: true,
  ppe_complete: true,
  declared_activities: [],
  medical_status: 'missing' as const,
};

describe('deriveClearance — office declarations', () => {
  it('clears a fit office worker with no medical certificate', () => {
    // The office path never asks about height or plant work, so a missing
    // certificate is not evidence of anything.
    const result = deriveClearance(officeBase);
    expect(result.clearance).toBe('cleared');
    expect(result.blocked_reasons).toEqual([]);
  });

  it('blocks an office worker who declares themselves unfit', () => {
    const result = deriveClearance({ ...officeBase, fit_for_duty: false });
    expect(result.clearance).toBe('blocked');
    expect(result.blocked_reasons).toEqual(['self_declared_unfit']);
  });

  it('raises no PPE warning for an office declaration', () => {
    // ppe_complete is not asked on the office path; it arrives false by
    // default and must not become a finding on the officer board.
    const result = deriveClearance({ ...officeBase, ppe_complete: false });
    expect(result.warnings).toEqual([]);
  });

  it('still blocks a site worker with an expired medical for height work', () => {
    // Pins that the office branch did not weaken the site rule.
    const result = deriveClearance({
      work_location: 'site',
      fit_for_duty: true,
      ppe_complete: true,
      declared_activities: ['working_at_height'],
      medical_status: 'expired',
    });
    expect(result.clearance).toBe('blocked');
    expect(result.blocked_reasons).toContain('medical_not_current');
  });
});
```

Check the exact activity key before writing `'working_at_height'` — read `CHECKIN_ACTIVITIES` in `checkin.types.ts` and use a real member of `MEDICAL_REQUIRED_ACTIVITIES`.

- [ ] **Step 2: Run it, verify it fails**

```bash
npx vitest run src/modules/health-safety/__tests__/checkinClearanceOffice.test.ts
```
Expected: FAIL — TypeScript rejects `work_location` on `ClearanceInput`.

- [ ] **Step 3: Add the type**

In `src/modules/health-safety/types/checkin.types.ts`, beside `CheckinCaptureMode`:

```typescript
/**
 * Where the worker declared they are working today. Office declarations skip
 * the site questions entirely — PPE and plant work are not desk risks — so
 * this drives both the question set and the clearance rules.
 */
export type CheckinWorkLocation = 'site' | 'office';
```

- [ ] **Step 4: Branch the clearance rule**

In `checkinClearance.ts`, add to `ClearanceInput`:

```typescript
  work_location: CheckinWorkLocation;
```

and import the type. Then in `deriveClearance`, after the `fit_for_duty` check, return early for office:

```typescript
  // An office declaration answers one question, so it can produce exactly one
  // outcome. Evaluating the site rules here would judge fields the office path
  // never asked — a false PPE warning on every desk worker, every day.
  if (input.work_location === 'office') {
    return {
      clearance: blocked_reasons.length > 0 ? 'blocked' : 'cleared',
      blocked_reasons,
      warnings: [],
    };
  }
```

Update the file's header docstring to say the graduated model applies to site declarations, and that an office declaration blocks only on self-declared unfitness.

- [ ] **Step 5: Run the test, verify it passes**

```bash
npx vitest run src/modules/health-safety/__tests__/checkinClearanceOffice.test.ts
```
Expected: PASS, all four cases.

- [ ] **Step 6: Run the existing clearance tests**

```bash
npx vitest run src/modules/health-safety
```
Every existing caller of `deriveClearance` now needs `work_location`. Fix each call site to pass `'site'` — that is what they all were. Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/modules/health-safety/
git commit -m "feat(hs): office declarations block only on self-declared unfitness"
```

---

### Task 3: Persist `work_location` through the writer

**Files:**
- Modify: `src/modules/health-safety/services/checkinWrite.ts:20-42` (`CreateCheckinInput`) and the INSERT at `:45-80`
- Test: `src/modules/health-safety/__tests__/checkinWriteWorkLocation.test.ts`

**Interfaces:**
- Consumes: `CheckinWorkLocation` from Task 2; the `work_location` column from Task 1.
- Produces: `CreateCheckinInput` gains `workLocation: CheckinWorkLocation` and `projectId` becomes `string | null`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';

// Assert on the SQL the writer emits, mirroring how the other write tests in
// this directory are structured — read one of them before writing this.
describe('createCheckin — work_location', () => {
  it('writes work_location and a null project for an office row', async () => {
    const captured = await captureInsert({ workLocation: 'office', projectId: null });
    expect(captured.text).toMatch(/work_location/);
    expect(captured.values).toContain('office');
    expect(captured.values).toContain(null);
  });

  it('writes the project for a site row', async () => {
    const captured = await captureInsert({
      workLocation: 'site',
      projectId: '11111111-1111-4111-8111-111111111111',
    });
    expect(captured.values).toContain('11111111-1111-4111-8111-111111111111');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

```bash
npx vitest run src/modules/health-safety/__tests__/checkinWriteWorkLocation.test.ts
```
Expected: FAIL — `workLocation` is not a property of `CreateCheckinInput`.

- [ ] **Step 3: Widen the input type**

In `checkinWrite.ts`:

```typescript
export interface CreateCheckinInput {
  checkinDate: string;
  /** Null only for an office declaration; the CHECK constraint enforces this. */
  projectId: string | null;
  workLocation: CheckinWorkLocation;
  // ...rest unchanged
```

- [ ] **Step 4: Add the column to the INSERT**

Add `work_location` to the column list and `${input.workLocation}` to `VALUES`, positionally matched. `${input.projectId}::uuid` already handles null correctly.

- [ ] **Step 5: Run the test, verify it passes**

Expected: PASS both cases.

- [ ] **Step 6: Fix every other caller**

```bash
grep -rn "createCheckin(" src pages --include=*.ts --include=*.tsx | grep -v __tests__
```

The crew-lead path (`checkinCrewWrite.ts`) is always a site declaration — pass `workLocation: 'site'`. Then:

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "health-safety|hs/"
```
Expected: no errors in these paths.

- [ ] **Step 7: Commit**

```bash
git add src/modules/health-safety/
git commit -m "feat(hs): persist work_location on daily check-ins"
```

---

### Task 4: API accepts an office declaration

**Files:**
- Modify: `pages/api/my/hs/checkin.ts:94-115` (validation) and `:120-145` (lookups + clearance call)
- Test: `src/modules/health-safety/__tests__/api/myHsCheckinOffice.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces: `POST /api/my/hs/checkin` accepts `{ work_location: 'office' | 'site' }`. Office bodies require no `project_id`, no `ppe_complete`, and no `declared_activities`. Response shape is unchanged.

- [ ] **Step 1: Write the failing test**

Mock `@/lib/db-pool` / the neon shim and the service layer the way `checkinReviewFixes.test.ts` does — read it first.

```typescript
describe('POST /api/my/hs/checkin — office declarations', () => {
  it('accepts an office body with no project_id', async () => {
    const res = await post({ work_location: 'office', fit_for_duty: true });
    expect(res.statusCode).toBe(201);
  });

  it('rejects a site body with no project_id', async () => {
    const res = await post({ work_location: 'site', fit_for_duty: true, ppe_complete: true });
    expect(res.statusCode).toBe(400);
    expect(bodyOf(res).error.message).toMatch(/project_id/);
  });

  it('defaults to site when work_location is absent', async () => {
    // The standalone page posts no work_location until Task 6 ships. It must
    // keep working in the meantime.
    const res = await post({ project_id: PROJECT, fit_for_duty: true, ppe_complete: true });
    expect(res.statusCode).toBe(201);
    expect(createCheckinSpy.mock.calls[0][0].workLocation).toBe('site');
  });

  it('skips the medical and permit lookups for an office declaration', async () => {
    await post({ work_location: 'office', fit_for_duty: true });
    expect(lookupMedicalStatusSpy).not.toHaveBeenCalled();
    expect(findActivitiesWithoutPermitSpy).not.toHaveBeenCalled();
  });

  it('rejects an unknown work_location', async () => {
    const res = await post({ work_location: 'moon', fit_for_duty: true });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Expected: FAIL — the office body is rejected for a missing `project_id`.

- [ ] **Step 3: Branch the validation**

Replace the current `project_id` and boolean validation block with:

```typescript
    const rawLocation = body.work_location ?? 'site';
    if (rawLocation !== 'site' && rawLocation !== 'office') {
      return apiResponse.badRequest(res, "work_location must be 'site' or 'office'");
    }
    const workLocation: CheckinWorkLocation = rawLocation;
    const isOffice = workLocation === 'office';

    // A site declaration is unattributable without a project; an office one has
    // no project to give.
    const projectId = typeof body.project_id === 'string' ? body.project_id : '';
    if (!isOffice && !UUID_RE.test(projectId)) {
      return apiResponse.badRequest(res, 'project_id must be a uuid');
    }
    if (typeof body.fit_for_duty !== 'boolean') {
      return apiResponse.badRequest(res, 'fit_for_duty is a required boolean');
    }
    // PPE and activities are site-only questions. Coercing them here rather
    // than demanding them keeps the office body to the one question it asks.
    const ppeComplete = isOffice ? true : body.ppe_complete;
    if (typeof ppeComplete !== 'boolean') {
      return apiResponse.badRequest(res, 'ppe_complete is a required boolean');
    }
    const activities = isOffice ? [] : parseActivities(body.declared_activities);
```

Keep the existing `activities === null` rejection below this.

- [ ] **Step 4: Skip the site-only lookups**

```typescript
    const medicalStatus = !isOffice && requiresMedical(activities)
      ? await lookupMedicalStatus({ staffId: session.staffId }, today)
      : 'current';
    const withoutPermit = isOffice
      ? []
      : await findActivitiesWithoutPermit(projectId, activities, today);
```

Pass `work_location: workLocation` into `deriveClearance`, and `workLocation` plus `projectId: isOffice ? null : projectId` into `createCheckin`.

The hazard-to-risk-register call takes a `projectId`. An office hazard has no project — pass the hazard through only when `!isOffice`, and leave `riskRegisterId` null for office rows. Note this in a comment: an office hazard is still recorded on the check-in row itself, it just does not open a project risk.

- [ ] **Step 5: Run the test, verify it passes**

Expected: PASS, all five cases.

- [ ] **Step 6: Run the whole H&S suite and typecheck**

```bash
npx vitest run src/modules/health-safety
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "hs/|health-safety"
```
Expected: green, no new type errors.

- [ ] **Step 7: Commit**

```bash
git add pages/api/my/hs/checkin.ts src/modules/health-safety/
git commit -m "feat(hs): accept office declarations on the daily check-in API"
```

---

### Task 5: The H&S steps component

**Files:**
- Create: `src/modules/attendance/portal/client/clock/HsCheckinSteps.tsx` (must stay under 200 lines)
- Test: `src/modules/attendance/portal/client/clock/__tests__/HsCheckinSteps.test.tsx`

**Interfaces:**
- Consumes: `POST /api/my/hs/checkin` from Task 4.
- Produces:

```typescript
export function HsCheckinSteps(props: {
  attendanceEntryId: string | null;
  gps: { lat: number; lon: number } | null;
  onDone: () => void;
}): JSX.Element
```

- [ ] **Step 1: Write the failing test**

Use `react-test-renderer` with `act()`, following the existing tests in `src/modules/attendance/portal/client/clock/__tests__/`. Assert on CONCATENATED rendered text — React splits interpolated strings across text nodes, so a serialised-tree match can pass vacuously.

```typescript
describe('HsCheckinSteps', () => {
  it('asks for a location first and posts office with no project', async () => {
    fetchMock.mockResolvedValueOnce(bootstrapResponse({ projects: [P1] }));
    const tree = await renderSteps();
    await act(() => tapByLabel(tree, 'Office'));
    await act(() => tapByLabel(tree, 'Yes'));      // fit for duty
    await act(() => tapByLabel(tree, 'Submit'));

    const posted = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(posted.work_location).toBe('office');
    expect(posted.project_id).toBeUndefined();
    expect(posted.ppe_complete).toBeUndefined();
  });

  it('asks the site questions when a project is chosen', async () => {
    // ...select P1, answer fit + ppe, submit
    const posted = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(posted.work_location).toBe('site');
    expect(posted.project_id).toBe(P1.id);
    expect(typeof posted.ppe_complete).toBe('boolean');
  });

  it('sends the attendance entry id and the gps fix', async () => {
    const posted = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(posted.attendance_entry_id).toBe('entry-1');
    expect(posted.lat).toBe(-26.1);
    expect(posted.lon).toBe(28.0);
  });

  it('shows the blocked outcome without hiding that the shift is recorded', async () => {
    // fit_for_duty = No -> API returns clearance blocked
    const text = concatText(tree);
    expect(text).toMatch(/supervisor/i);
    expect(text).toMatch(/time (has been|is) recorded|shift is recorded/i);
  });

  it('calls onDone and does not block when the POST fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    // The clock-in already committed; a failed declaration must never look
    // like a failed clock-in.
    expect(onDone).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

```bash
npx vitest run src/modules/attendance/portal/client/clock/__tests__/HsCheckinSteps.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Build the component**

Bootstrap from `GET /api/my/hs/checkin` for `projects`, `default_project_id`, `activities`, `medical_status`, `completed`. Render in order:

1. **Where are you working today?** — an `Office` option plus one per project, with `default_project_id` pre-selected. Reuse `CHECKIN_CARD` and the prompt components from `@/modules/health-safety/components/checkin/CheckinPrompts` so the wording matches the standalone page exactly.
2. **Fit for duty?** — `YesNo`, both paths.
3. **PPE / activities / hazard** — site path only.
4. **Outcome** — `CheckinOutcome`. On `blocked`, the copy must direct the worker to their supervisor AND state plainly that their time is already recorded. A worker who thinks they have lost their shift will find a way around this screen.

If `completed` is true on bootstrap, call `onDone()` immediately and render nothing — a second clock-in the same day must not re-ask.

Keep it under 200 lines; if it grows past that, split the site questions into a sibling file rather than trimming the copy.

- [ ] **Step 4: Run the test, verify it passes**

Expected: PASS, all five cases.

- [ ] **Step 5: Commit**

```bash
git add src/modules/attendance/portal/client/clock/
git commit -m "feat(attendance): H&S declaration steps for the clock-in flow"
```

---

### Task 6: Wire the steps into the clock-in flow

**Files:**
- Modify: `src/modules/attendance/portal/client/clock/ClockActionFlow.tsx:66-72` (the success branch)
- Modify: `src/modules/attendance/portal/client/clock/useClockSubmission.ts:71-79` (expose the entry id)
- Test: `src/modules/attendance/portal/client/clock/__tests__/ClockActionFlowHs.test.tsx`

**Interfaces:**
- Consumes: `HsCheckinSteps` from Task 5.
- Produces: `useClockSubmission` returns `entryId: string | null`, set from the `submitted_in` response.

- [ ] **Step 1: Write the failing test**

```typescript
describe('ClockActionFlow — H&S steps', () => {
  it('shows the H&S steps after a successful clock-in', async () => {
    expect(concatText(tree)).toMatch(/where are you working/i);
  });

  it('does NOT show them after a clock-OUT', async () => {
    // The declaration is a start-of-day statement. Asking it at knock-off
    // would record a fitness answer against a shift already worked.
    expect(concatText(tree)).not.toMatch(/where are you working/i);
  });

  it('does NOT show them when the clock-in was queued offline', async () => {
    // There is no attendance row yet and no network to post to. The hub badge
    // covers this worker instead.
    expect(concatText(tree)).toMatch(/saved on this phone/i);
    expect(concatText(tree)).not.toMatch(/where are you working/i);
  });

  it('reaches the normal success screen after the declaration is done', async () => {
    await act(() => completeHsSteps(tree));
    expect(concatText(tree)).toMatch(/clocked in/i);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Expected: FAIL — the H&S prompt never renders.

- [ ] **Step 3: Expose the entry id**

In `useClockSubmission.ts`, add `const [entryId, setEntryId] = React.useState<string | null>(null)`, set it in the `submitted_in` branch from `result.response.entryId`, clear it in `reset`, and return it.

- [ ] **Step 4: Gate the steps in `ClockActionFlow`**

Add local state `hsDone`. Replace the success branch so that for `action === 'in'`, `submission.state === 'success'`, and `!hsDone`, the flow renders `HsCheckinSteps` instead of `SuccessView`:

```tsx
      {submission.state === 'success' && action === 'in' && !hsDone && (
        <HsCheckinSteps
          attendanceEntryId={submission.entryId}
          gps={evidence.gps ? { lat: evidence.gps.lat, lon: evidence.gps.lon } : null}
          onDone={() => setHsDone(true)}
        />
      )}
      {submission.state === 'success' && (action === 'out' || hsDone) && (
        <SuccessView ... />   // unchanged
      )}
```

The `queued` branches stay exactly as they are — an offline clock-in never reaches this code.

- [ ] **Step 5: Run the test, verify it passes**

Expected: PASS, all four cases.

- [ ] **Step 6: Mutation check — prove the offline test can fail**

Temporarily remove the `submission.state === 'success'` condition so the steps also render for `queued`, and confirm the offline test FAILS. Restore it. A guard that no test can falsify is not a guard.

- [ ] **Step 7: Commit**

```bash
git add src/modules/attendance/portal/client/clock/
git commit -m "feat(attendance): run the H&S declaration inside the clock-in flow"
```

---

### Task 7: Office option on the standalone page

**Files:**
- Modify: `pages/my/hs-checkin.tsx:50-105` (state + submit)
- Test: `src/modules/health-safety/__tests__/hsCheckinPageOffice.test.tsx`

**Interfaces:**
- Consumes: Task 4's API contract.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

```typescript
it('posts work_location office with no project when Office is chosen', async () => {
  const posted = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(posted.work_location).toBe('office');
  expect(posted.project_id).toBeUndefined();
});

it('still requires a project when a site is chosen', async () => {
  // Submitting with neither Office nor a project selected must be refused
  // client-side, not bounced by the API.
  expect(concatText(tree)).toMatch(/choose which project/i);
});
```

- [ ] **Step 2: Run it, verify it fails**

Expected: FAIL — there is no Office option.

- [ ] **Step 3: Add Office to the picker**

Add `'office'` as a selectable value alongside the projects. When chosen: hide the PPE, activities, and hazard questions, and post `{ work_location: 'office', fit_for_duty }` with no `project_id`. Otherwise post `work_location: 'site'` as today.

Both routes into the same declaration must ask the same questions in the same words — a worker who uses the standalone page one day and the clock-in flow the next should not meet two different forms.

- [ ] **Step 4: Run the test, verify it passes**

Expected: PASS both cases.

- [ ] **Step 5: Commit**

```bash
git add pages/my/hs-checkin.tsx src/modules/health-safety/
git commit -m "feat(hs): office option on the standalone check-in page"
```

---

### Task 8: Louder hub badge while clocked in without a declaration

**Files:**
- Modify: `src/modules/attendance/portal/client/MyHub.tsx` (the H&S tile, around :109 and :140)
- Modify: `src/modules/attendance/portal/client/useMyHubData.ts` if the open-entry state is not already available there — read it first
- Test: `src/modules/attendance/portal/client/__tests__/MyHubHsBadge.test.tsx`

**Interfaces:**
- Consumes: existing hub data.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

```typescript
it('marks the H&S tile outstanding when clocked in with no check-in today', () => {
  expect(concatText(tree)).toMatch(/still to do|outstanding/i);
});

it('does not mark it when the check-in is done', () => {
  expect(concatText(tree)).not.toMatch(/still to do|outstanding/i);
});

it('does not mark it when the worker is not clocked in', () => {
  // An office worker who has not clocked in is not overdue for anything.
  expect(concatText(tree)).not.toMatch(/still to do|outstanding/i);
});
```

- [ ] **Step 2: Run it, verify it fails**

Expected: FAIL — no such text.

- [ ] **Step 3: Implement**

Show the outstanding treatment only when the worker has an open attendance entry AND no self check-in today. Both conditions matter — the third test is what stops this nagging everyone.

- [ ] **Step 4: Run the test, verify it passes**

Expected: PASS all three.

- [ ] **Step 5: Commit**

```bash
git add src/modules/attendance/portal/client/
git commit -m "feat(my): flag an outstanding H&S declaration while clocked in"
```

---

### Task 9: Full gate, PR, and a browser walk on dev

**Files:** none.

- [ ] **Step 1: Full local CI**

```bash
npm run ci:quick
npx vitest run src/modules/health-safety src/modules/attendance
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "hs/|health-safety|attendance"
```
All must be clean. Pre-existing type errors elsewhere in the repo are not yours; do not "fix" them here.

- [ ] **Step 2: Open the PR**

Body must state: migration 493 applies to the shared production database, office rows carry a null project, and offline clock-ins skip the declaration by design.

- [ ] **Step 3: Blind review**

Invoke `/review`. The author does not review their own work. Fix every confirmed HIGH before merging.

- [ ] **Step 4: Deploy to dev and walk both paths in a browser**

```bash
bash scripts/deploy-local.sh dev
```

Then, in a real browser on dev, with a test staff account:
- Clock in → choose a project → answer the site questions → confirm the outcome screen, then check the row in Postgres: `work_location='site'`, `attendance_entry_id` set, `gps_lat`/`gps_lon` set.
- Clock in as a second test account → choose Office → confirm only the fitness question is asked → check the row: `work_location='office'`, `project_id IS NULL`.
- Answer "not fit" and confirm the screen says both *report to your supervisor* and *your time is recorded*.
- Clock in a second time the same day → confirm no re-ask.

Code review is not verification for this feature. The last two H&S changes here each shipped a bug that only a browser walk caught.

- [ ] **Step 5: Report what the walk showed**

Screenshots plus the four DB rows. If any step failed, say so with the evidence rather than re-running until it passes.
