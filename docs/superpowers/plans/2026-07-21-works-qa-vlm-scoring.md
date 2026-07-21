# Works-QA VLM Scoring + Honest Pending State — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the VLM on Works-QA QField photos (skipping already-scored and humanly-decided slots) and render never-scored photos as a neutral "Pending" state instead of a red "VLM fail".

**Architecture:** Score at the `pole_qa_photos` level after sync, reusing the existing `validatePhotoWithVlm()` function. A new headless script scores eligible slots in bounded batches; a new cron step runs it after `works-qa-sync.ts`. A distinct `pending` slot state is threaded through the sync marker, the overview API/derivation, and the detail card so unscored photos read as "Awaiting AI".

**Tech Stack:** TypeScript, Next.js (Pages Router), `pg`, `tsx` (headless scripts), Vitest, Qwen3-VL on vLLM (`:8100`).

## Global Constraints

- Worktree only: all work in `/home/hein/Workspace/FF_Next.js-vlm-scoring` (main-tree edits are hook-blocked). For any `git` write, start the Bash command with `cd /home/hein/Workspace/FF_Next.js-vlm-scoring && …` (leading `cd … &&` is required for the worktree guard to allow it).
- Files < 300 lines, components < 200 lines.
- App code: no `console.log` — use `log` from `@/lib/logger`. **Headless scripts under `scripts/` are exempt** and use `console.log`/`console.error` (established pattern in `scripts/works-qa-sync.ts`; the in-memory logger is invisible from a `tsx` CLI).
- TDD: write the failing test first, watch it fail, implement, watch it pass, commit.
- Run tests with: `npx vitest run <path>` from the worktree.
- Before the PR: `npm run ci:quick`.
- "Scored" is detected by the **presence of a boolean `valid`** in a `vlm_results[slot]` entry (robust across legacy, manual-upload, and new producers). The `scored` flag is only the pending marker's content (`{scored:false}`) — never the scored-detection key.

---

### Task 1: Sync writes a pending marker (+ `VlmSlotResult.scored`)

Stop the QField sync from stamping unscored photos as `valid:false`. When upstream `vlm_confidence` is NULL, write a `{scored:false}` pending marker (no `valid` field) instead.

**Files:**
- Modify: `src/modules/works-qa/types/works-qa.types.ts:1-12` (add `scored?` to `VlmSlotResult`)
- Modify: `src/modules/works-qa/services/syncQfieldCore.ts:269-277` (pending marker)
- Test: `src/modules/works-qa/services/__tests__/syncQfieldCore.test.ts`

**Interfaces:**
- Produces: `VlmSlotResult` now has optional `scored?: boolean`. Pending marker shape: `{ scored: false }`. Scored shape unchanged: `{ valid, confidence, feedback, scored: true }`.

- [ ] **Step 1: Add the `scored` field to the type**

In `src/modules/works-qa/types/works-qa.types.ts`, change the `VlmSlotResult` interface (lines 1-12) to add:

```typescript
export interface VlmSlotResult {
  valid: boolean;
  confidence: number;
  feedback: string;
  overridden_by?: string;
  override_reason?: string;
  // True once the VLM has actually scored this slot. A pending (never-scored)
  // slot is written as `{ scored: false }` with no `valid` field, so the UI can
  // show "Awaiting AI" instead of a red failure. Scored-detection elsewhere keys
  // on the presence of a boolean `valid`, not on this flag.
  scored?: boolean;
  // Set when a single photo is reused to satisfy a second step (e.g. a depth
  // shot that also shows the end-plates). Distinct from a normal override so it
  // can be excluded from VLM training — see pages/api/works-qa/link-photo.ts.
  dual_step?: boolean;
  source_slot?: string;
}
```

- [ ] **Step 2: Write the failing test**

Open `src/modules/works-qa/services/__tests__/syncQfieldCore.test.ts`. Find how it mocks the pool and drives `syncQfieldForProject` (follow the existing cases). Add a test that a QField row with `vlm_confidence = null` results in the `vlm_results` entry being written as `{ scored: false }` (no `valid`), and a row with `vlm_confidence = 0.82` is written as `{ valid: true, confidence: 0.82, feedback: …, scored: true }`. Assert on the JSON passed to the `UPDATE pole_qa_photos … vlm_results = vlm_results || $2::jsonb` query (the 2nd bind param).

```typescript
it('writes a pending marker (scored:false, no valid) when upstream confidence is NULL', async () => {
  // Arrange a single civil pole row with vlm_confidence = null (see existing
  // mockPool helper in this file for the exact query-routing shape).
  const captured = runSyncCapturingVlmEntry({ vlm_confidence: null, checklist_step: 1, work_type: 'pole_installation', feature_type: 'pole', feature_id: 'HT_X_F0001PL' });
  const entry = JSON.parse(captured.vlmEntryJson);
  expect(entry.civil_01).toEqual({ scored: false });
});

it('writes a scored result (valid + scored:true) when upstream confidence is present', async () => {
  const captured = runSyncCapturingVlmEntry({ vlm_confidence: 0.82, checklist_step: 1, work_type: 'pole_installation', feature_type: 'pole', feature_id: 'HT_X_F0001PL' });
  const entry = JSON.parse(captured.vlmEntryJson);
  expect(entry.civil_01.valid).toBe(true);
  expect(entry.civil_01.confidence).toBe(0.82);
  expect(entry.civil_01.scored).toBe(true);
});
```

Note: `runSyncCapturingVlmEntry` is a thin helper you write in the test file that builds the mock pool (returning the one QField row from the `qfield_photo_validations` SELECT, an empty slot column so the UPSERT path runs, and capturing the bind params of the `vlm_results = vlm_results || $2` UPDATE). Reuse the mock-pool utilities already present in this test file rather than inventing a new mock style.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/modules/works-qa/services/__tests__/syncQfieldCore.test.ts`
Expected: FAIL — the pending case gets `{ valid:false, confidence:0, feedback:'Synced from QField' }`, not `{ scored:false }`.

- [ ] **Step 4: Implement the pending marker**

In `src/modules/works-qa/services/syncQfieldCore.ts`, replace the `vlmEntry` construction (lines 269-277):

```typescript
    // Build VLM result entry. A row with no upstream confidence has never been
    // scored — write a pending marker (scored:false, no `valid`) so the UI shows
    // "Awaiting AI", NOT a red fail. The new works-qa-vlm-score step fills these
    // in on a later run. A row that DOES carry a confidence (legacy pre-2026-03
    // data) keeps its real pass/fail.
    const vlmEntry = row.vlm_confidence !== null
      ? JSON.stringify({
          [slotKey]: {
            valid: Number(row.vlm_confidence) >= 0.6,
            confidence: Number(row.vlm_confidence),
            feedback: row.vlm_feedback ?? 'Synced from QField',
            scored: true,
          },
        })
      : JSON.stringify({ [slotKey]: { scored: false } });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/modules/works-qa/services/__tests__/syncQfieldCore.test.ts`
Expected: PASS (all cases, including the pre-existing ones).

- [ ] **Step 6: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-vlm-scoring && git add src/modules/works-qa/types/works-qa.types.ts src/modules/works-qa/services/syncQfieldCore.ts src/modules/works-qa/services/__tests__/syncQfieldCore.test.ts && git commit -m "fix(works-qa): sync writes pending marker for unscored QField photos"
```

---

### Task 2: Overview renders a neutral "pending" dot

Add a `pending` slot state so the PON-overview dots show present-but-unscored slots as neutral, not green ('pass') and not red ('fail'). The overview API must tell the pure derivation which slots are actually scored.

**Files:**
- Modify: `src/modules/works-qa/types/works-qa.types.ts:93-98` (add `'pending'` to `SlotState`)
- Modify: `pages/api/works-qa/poles.ts:70-74` (emit `scored_slots`)
- Modify: `src/modules/works-qa/utils/pole-overview.ts:10-89,136-149` (`scored_slots`, `deriveSlotState`, `deriveStatus`)
- Test: `src/modules/works-qa/utils/__tests__/pole-overview.test.ts`

**Interfaces:**
- Consumes: `VlmSlotResult.scored` (Task 1) — but detection keys on `valid` presence, not the flag.
- Produces: `SlotState` union gains `'pending'`. `PoleOverviewRow` gains `scored_slots: string[]` (slot keys whose `vlm_results` entry has a boolean `valid`). `deriveSlotState` precedence: empty → approved → snagged(fail) → vlm-fail → **pending** → pass.

- [ ] **Step 1: Add `'pending'` to `SlotState`**

In `src/modules/works-qa/types/works-qa.types.ts`, update the union and its doc comment (lines 93-98):

```typescript
// Per-slot review state shown as a dot on the PON overview (Works QA).
//  - 'approved' → a person approved this photo (slot_approvals.decision)   → strong green
//  - 'pass'     → has a photo, VLM-scored valid (or overridden)            → faint green
//  - 'fail'     → snagged by a person OR an un-overridden VLM failure      → red
//  - 'pending'  → has a photo but the VLM has not scored it yet            → neutral grey
//  - 'empty'    → no photo in this slot                                    → grey
export type SlotState = 'empty' | 'approved' | 'pass' | 'fail' | 'pending';
```

- [ ] **Step 2: Add `scored_slots` to the test helper defaults**

The file already has a `row(overrides)` helper (around lines 8-20) that builds a `PoleOverviewRow`. It will fail to type-check once `scored_slots` is required. Add `scored_slots: []` to the helper's default object (next to `present_slots: []`, `vlm_fail_keys: []`).

- [ ] **Step 3: Write the failing test cases**

Add these cases to `src/modules/works-qa/utils/__tests__/pole-overview.test.ts`, using the existing `row()` helper:

```typescript
it('marks a present-but-unscored slot as pending, not pass', () => {
  expect(computePoleSummary(row({ present_slots: ['civil_01'] })).civil_slots[0]).toBe('pending');
});

it('marks a scored-valid slot as pass', () => {
  expect(computePoleSummary(row({ present_slots: ['civil_01'], scored_slots: ['civil_01'] })).civil_slots[0]).toBe('pass');
});

it('marks a scored-invalid slot as fail', () => {
  expect(computePoleSummary(row({ present_slots: ['civil_01'], vlm_fail_keys: ['civil_01'], scored_slots: ['civil_01'] })).civil_slots[0]).toBe('fail');
});

it('human approval/snag still wins over pending', () => {
  const approved = row({ present_slots: ['civil_01'], slot_approvals: { civil_01: { decision: 'approved', by: 'x', at: 't' } } });
  expect(computePoleSummary(approved).civil_slots[0]).toBe('approved');
  const snagged = row({ present_slots: ['civil_01'], slot_approvals: { civil_01: { decision: 'snagged', by: 'x', at: 't' } } });
  expect(computePoleSummary(snagged).civil_slots[0]).toBe('fail');
});

it('pending slots are not counted as vlm_failures', () => {
  expect(computePoleSummary(row({ present_slots: ['civil_01', 'civil_02'] })).vlm_failures).toBe(0);
});

it('a fully-photographed pole is NOT ready while any slot is still unscored', () => {
  // ALL_KEYS present + tray but scored_slots empty → pending, so not "ready".
  expect(computePoleSummary(row({ present_slots: ALL_KEYS, tray_count: 2 })).status).toBe('in_progress');
});
```

- [ ] **Step 4: Fix the existing "derives ready" test for the new no-pending rule**

The existing test (around line 68) asserts a pole with `present_slots: ALL_KEYS, tray_count: 2` is `'ready'`. Under the new rule, "ready" requires every slot to be scored-and-clean, so this test must mark the pole fully scored. Update that one case to add `scored_slots: ALL_KEYS`:

```typescript
    expect(computePoleSummary(row({ present_slots: ALL_KEYS, tray_count: 2, scored_slots: ALL_KEYS })).status).toBe('ready');
```

(`ALL_KEYS` is already defined in this test file.)

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run src/modules/works-qa/utils/__tests__/pole-overview.test.ts`
Expected: FAIL — `pending` cases currently derive to `'pass'`; also a TS error because `PoleOverviewRow` has no `scored_slots`.

- [ ] **Step 6: Thread `scored_slots` through the derivation**

In `src/modules/works-qa/utils/pole-overview.ts`:

Add to `PoleOverviewRow` (after `vlm_fail_keys`, around line 24):

```typescript
  /** Slot keys whose vlm_results entry has a boolean `valid` (i.e. VLM-scored). */
  scored_slots: string[];
```

Update `deriveSlotState` (lines 31-43) to take and use a `scored` set:

```typescript
function deriveSlotState(
  slotKey: string,
  present: Set<string>,
  vlmFails: Set<string>,
  approvals: Record<string, SlotApproval>,
  scored: Set<string>,
): SlotState {
  if (!present.has(slotKey)) return 'empty';
  const decision = approvals[slotKey]?.decision;
  if (decision === 'approved') return 'approved';
  if (decision === 'snagged') return 'fail';
  if (vlmFails.has(slotKey)) return 'fail';
  if (!scored.has(slotKey)) return 'pending';
  return 'pass';
}
```

In `computePoleSummary` (lines 45-57), build the set and pass it:

```typescript
  const present = new Set(row.present_slots ?? []);
  const vlmFails = new Set(row.vlm_fail_keys ?? []);
  const approvals = row.slot_approvals ?? {};
  const scored = new Set(row.scored_slots ?? []);

  const statesFor = (d: Discipline): SlotState[] =>
    SLOT_META.filter(s => s.discipline === d).map(s =>
      deriveSlotState(s.key, present, vlmFails, approvals, scored),
    );
```

In `plantedOnlyPoleSummary` no change is needed (it emits all `'empty'`).

Preserve the meaning of `'ready'` (fully scored + clean, never "ready with unvalidated photos"). Update `deriveStatus` (lines 136-149) to also require no pending slots. Change its signature and the `ready` check:

```typescript
function deriveStatus(
  row: PoleOverviewRow,
  present: Set<string>,
  vlmFailures: number,
  hasPending: boolean,
): PoleSummary['status'] {
  if (row.approved_at) return 'approved';
  if (row.outstanding_snag_count > 0) return 'snagged';

  const allSlotsFilled = SLOT_META.every(s => present.has(s.key));
  if (allSlotsFilled && row.tray_count >= 1 && vlmFailures === 0 && !hasPending) return 'ready';

  const anyContent = present.size > 0 || row.tray_count >= 1;
  return anyContent ? 'in_progress' : 'empty';
}
```

And update its call site inside `computePoleSummary` (line 81). Compute `hasPending` from the present-but-unscored slots:

```typescript
  const hasPending = SLOT_META.some(s => present.has(s.key) && !scored.has(s.key));
  // …
    status: deriveStatus(row, present, vlm_failures, hasPending),
```

- [ ] **Step 7: Add `scored_slots` to the overview SQL**

In `pages/api/works-qa/poles.ts`, after the `vlm_fail_keys` sub-select (lines 71-74), add a `scored_slots` column. Use `jsonb_exists` (not the `?` operator) to avoid any driver placeholder ambiguity:

```sql
        COALESCE(ARRAY(
          SELECT e.key FROM jsonb_each(COALESCE(vlm_results, '{}'::jsonb)) AS e(key, value)
           WHERE jsonb_exists(e.value, 'valid')
        ), '{}'::text[]) AS scored_slots,
```

No JS mapping change is needed: `poles.ts:118` does `photoResult.rows.map(r => computePoleSummary(r as PoleOverviewRow))` — it casts the raw query row straight to `PoleOverviewRow`, so the new `scored_slots` column flows through automatically once the SELECT returns it.

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/modules/works-qa/utils/__tests__/pole-overview.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-vlm-scoring && git add src/modules/works-qa/types/works-qa.types.ts pages/api/works-qa/poles.ts src/modules/works-qa/utils/pole-overview.ts src/modules/works-qa/utils/__tests__/pole-overview.test.ts && git commit -m "feat(works-qa): pending slot state in PON overview"
```

---

### Task 3: Detail card renders a neutral "Awaiting AI" badge

The right-panel `PhotoSlotCard` must show a pending photo as neutral, not red "VLM fail", and hide the Override button (nothing to override until scored). Extract the status logic into a pure, testable function.

**Files:**
- Create: `src/modules/works-qa/utils/slot-card-status.ts`
- Create: `src/modules/works-qa/utils/__tests__/slot-card-status.test.ts`
- Modify: `src/modules/works-qa/components/PhotoSlotCard.tsx:59-64,110-129,331-338` (use the function; add pending badge; guard Override)

**Interfaces:**
- Consumes: `VlmSlotResult` (with `scored?`).
- Produces: `deriveSlotCardStatus(photoKey: string | null, vlm: VlmSlotResult | undefined): 'empty' | 'pass' | 'fail' | 'overridden' | 'pending'`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/works-qa/utils/__tests__/slot-card-status.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { deriveSlotCardStatus } from '../slot-card-status';

describe('deriveSlotCardStatus', () => {
  it('empty when no photo', () => {
    expect(deriveSlotCardStatus(null, undefined)).toBe('empty');
  });
  it('pending when photo present but vlm entry is a pending marker', () => {
    expect(deriveSlotCardStatus('k', { scored: false } as never)).toBe('pending');
  });
  it('pending when photo present but no vlm entry at all', () => {
    expect(deriveSlotCardStatus('k', undefined)).toBe('pending');
  });
  it('overridden takes precedence', () => {
    expect(deriveSlotCardStatus('k', { valid: false, confidence: 0, feedback: '', overridden_by: 'u' })).toBe('overridden');
  });
  it('pass when scored valid', () => {
    expect(deriveSlotCardStatus('k', { valid: true, confidence: 0.9, feedback: '' })).toBe('pass');
  });
  it('fail when scored invalid', () => {
    expect(deriveSlotCardStatus('k', { valid: false, confidence: 0.2, feedback: '' })).toBe('fail');
  });
});
```

Note the third case is a deliberate behavior change: a photo present with **no** VLM entry now reads as `pending` ("Awaiting AI"), where the old inline logic showed no badge. This is correct — a photo that exists but was never scored is pending.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/works-qa/utils/__tests__/slot-card-status.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the pure function**

Create `src/modules/works-qa/utils/slot-card-status.ts`:

```typescript
import type { VlmSlotResult } from '../types/works-qa.types';

export type SlotCardStatus = 'empty' | 'pass' | 'fail' | 'overridden' | 'pending';

/**
 * Status for a single PhotoSlotCard. A slot is "scored" only when its VLM entry
 * carries a boolean `valid`; a photo present without a real score (pending
 * marker `{scored:false}`, or no entry yet) is 'pending' ("Awaiting AI"), never
 * a red 'fail'. Human approve/snag is handled separately by slotApproval.
 */
export function deriveSlotCardStatus(
  photoKey: string | null,
  vlm: VlmSlotResult | undefined,
): SlotCardStatus {
  if (!photoKey) return 'empty';
  if (vlm?.overridden_by) return 'overridden';
  if (typeof vlm?.valid !== 'boolean') return 'pending';
  return vlm.valid ? 'pass' : 'fail';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/works-qa/utils/__tests__/slot-card-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the function + add the pending badge in `PhotoSlotCard`**

In `src/modules/works-qa/components/PhotoSlotCard.tsx`:

Add the import near the top (with the other local imports):

```typescript
import { deriveSlotCardStatus } from '../utils/slot-card-status';
```

Replace the inline `status` derivation (lines 59-64) with:

```typescript
  const status = deriveSlotCardStatus(photoKey, vlm);
```

Add a `pending` colour to `borderColor` (lines 66-70) and `bgColor` (lines 72-76) — insert a neutral case before the fallback:

```typescript
  const borderColor =
    status === 'pass' ? 'border-green-500/40' :
    status === 'overridden' ? 'border-amber-500/40' :
    status === 'fail' ? 'border-red-500/40' :
    status === 'pending' ? 'border-sky-500/30' :
    'border-zinc-700 border-dashed';

  const bgColor =
    status === 'pass' ? 'bg-green-500/5' :
    status === 'overridden' ? 'bg-amber-500/5' :
    status === 'fail' ? 'bg-red-500/5' :
    status === 'pending' ? 'bg-sky-500/5' :
    'bg-zinc-900';
```

Add the pending badge alongside the others (after the `status === 'fail'` badge, ~line 116):

```typescript
              {status === 'pending' && <span className="text-xs text-sky-400">⏳ Awaiting AI</span>}
```

The Override button block (lines 331-338) is already gated on `status === 'fail'`, so pending correctly shows no Override button — no change needed there. The `vlm?.feedback` line (217-219) is safe: a pending marker has no `feedback`, so nothing renders.

- [ ] **Step 6: Run the broader works-qa test group to confirm nothing regressed**

Run: `npx vitest run src/modules/works-qa`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-vlm-scoring && git add src/modules/works-qa/utils/slot-card-status.ts src/modules/works-qa/utils/__tests__/slot-card-status.test.ts src/modules/works-qa/components/PhotoSlotCard.tsx && git commit -m "feat(works-qa): PhotoSlotCard shows Awaiting AI for unscored photos"
```

---

### Task 4: `absolutePhotoUrl` helper

The VLM (on the velo host) needs an absolute photo URL to fetch. Add a helper that mirrors the existing relative `photoUrl(key)` but returns an absolute URL, appending `&vlm=true` for the proxy path (the localhost-VLM auth bypass in `photo-proxy.ts`).

**Files:**
- Modify: `src/modules/works-qa/utils/photo-url.ts`
- Create: `src/modules/works-qa/utils/__tests__/photo-url.test.ts`

**Interfaces:**
- Produces: `absolutePhotoUrl(key: string, appBase?: string): string`. Default `appBase = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.fibreflow.app'`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/works-qa/utils/__tests__/photo-url.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { absolutePhotoUrl } from '../photo-url';

const BASE = 'https://app.fibreflow.app';

describe('absolutePhotoUrl', () => {
  it('serves works-qa uploads from /storage/ absolutely', () => {
    expect(absolutePhotoUrl('works-qa/p/pole/civil/x.jpg', BASE)).toBe(`${BASE}/storage/works-qa/p/pole/civil/x.jpg`);
  });
  it('serves qfield photos via the proxy with source=qfield and vlm=true', () => {
    const url = absolutePhotoUrl('projects/abc/files/DCIM/y.jpg', BASE);
    expect(url.startsWith(`${BASE}/api/construction-qa/photo-proxy?`)).toBe(true);
    expect(url).toContain('source=qfield');
    expect(url).toContain('vlm=true');
    expect(url).toContain(`key=${encodeURIComponent('projects/abc/files/DCIM/y.jpg')}`);
  });
  it('sharepoint keys map to source=sharepoint', () => {
    expect(absolutePhotoUrl('sharepoint:drive/item', BASE)).toContain('source=sharepoint');
  });
  it('everything else maps to source=local', () => {
    expect(absolutePhotoUrl('lawley/old/z.jpg', BASE)).toContain('source=local');
  });
  it('returns empty string for empty key', () => {
    expect(absolutePhotoUrl('', BASE)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/works-qa/utils/__tests__/photo-url.test.ts`
Expected: FAIL — `absolutePhotoUrl` is not exported.

- [ ] **Step 3: Implement the helper**

Append to `src/modules/works-qa/utils/photo-url.ts`:

```typescript
/**
 * Absolute variant of photoUrl() for server-side consumers that hand the URL to
 * the VLM (which runs on the velo host and cannot resolve a relative path). The
 * proxy path carries `&vlm=true` — photo-proxy.ts allows that from localhost so
 * the VLM can fetch without a session (same path construction-qa's VLM uses).
 */
export function absolutePhotoUrl(
  key: string,
  appBase: string = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.fibreflow.app',
): string {
  if (!key) return '';
  const base = appBase.replace(/\/$/, '');
  if (key.startsWith('works-qa/')) return `${base}/storage/${key}`;
  const source = key.startsWith('projects/')   ? 'qfield'
              : key.startsWith('sharepoint:') ? 'sharepoint'
              :                                 'local';
  return `${base}/api/construction-qa/photo-proxy?key=${encodeURIComponent(key)}&source=${source}&vlm=true`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/works-qa/utils/__tests__/photo-url.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-vlm-scoring && git add src/modules/works-qa/utils/photo-url.ts src/modules/works-qa/utils/__tests__/photo-url.test.ts && git commit -m "feat(works-qa): absolutePhotoUrl helper for VLM photo fetch"
```

---

### Task 5: Scoring eligibility (pure) + the scorer script

The pure eligibility predicate is unit-tested; the script wires it to the DB, the VLM, and bounded concurrency.

**Files:**
- Create: `src/modules/works-qa/services/worksQaScoreEligibility.ts`
- Create: `src/modules/works-qa/services/__tests__/worksQaScoreEligibility.test.ts`
- Create: `scripts/works-qa-vlm-score.ts`

**Interfaces:**
- Consumes: `SLOT_META`, `getSlotMeta` (`slot-keys.ts`); `validatePhotoWithVlm` (`worksQaVlmService.ts`); `absolutePhotoUrl` (Task 4); `VlmSlotResult` (Task 1).
- Produces: `eligibleSlotsForRow(row: ScorableRow): Array<{ slotKey: string; photoKey: string }>`.

- [ ] **Step 1: Write the failing test for eligibility**

Create `src/modules/works-qa/services/__tests__/worksQaScoreEligibility.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { eligibleSlotsForRow, type ScorableRow } from '../worksQaScoreEligibility';

function row(overrides: Partial<ScorableRow>): ScorableRow {
  return {
    id: 'r1',
    civil_step_01_key: null, civil_step_02_key: null, civil_step_03_key: null, civil_step_04_key: null,
    civil_step_05_key: null, civil_step_06_key: null, civil_step_07_key: null, civil_step_08_key: null,
    optical_dome_01_key: null, optical_dome_02_key: null, optical_dome_03_key: null, optical_dome_04_key: null,
    optical_dome_05_key: null, optical_dome_06_key: null, optical_dome_07_key: null, optical_dome_08_key: null,
    main_joint_11_key: null, main_joint_12_key: null, main_joint_13_key: null,
    main_joint_14_key: null, main_joint_15_key: null, main_joint_16_key: null,
    vlm_results: {}, slot_approvals: null,
    civil_approved: false, dome_approved: false, joint_approved: false,
    ...overrides,
  };
}

describe('eligibleSlotsForRow', () => {
  it('includes a slot with a photo and no score and no human decision', () => {
    const r = row({ civil_step_01_key: 'k1' });
    expect(eligibleSlotsForRow(r)).toEqual([{ slotKey: 'civil_01', photoKey: 'k1' }]);
  });
  it('excludes a slot without a photo', () => {
    expect(eligibleSlotsForRow(row({}))).toEqual([]);
  });
  it('excludes an already-scored slot (entry has boolean valid)', () => {
    const r = row({ civil_step_01_key: 'k1', vlm_results: { civil_01: { valid: true, confidence: 0.9, feedback: '' } } });
    expect(eligibleSlotsForRow(r)).toEqual([]);
  });
  it('includes a slot whose entry is a pending marker (scored:false, no valid)', () => {
    const r = row({ civil_step_01_key: 'k1', vlm_results: { civil_01: { scored: false } as never } });
    expect(eligibleSlotsForRow(r)).toEqual([{ slotKey: 'civil_01', photoKey: 'k1' }]);
  });
  it('excludes a slot with a per-slot human decision', () => {
    const r = row({ civil_step_01_key: 'k1', slot_approvals: { civil_01: { decision: 'approved', by: 'u', at: 't' } } });
    expect(eligibleSlotsForRow(r)).toEqual([]);
  });
  it('excludes all civil slots when the civil discipline is human-approved', () => {
    const r = row({ civil_step_01_key: 'k1', civil_approved: true });
    expect(eligibleSlotsForRow(r)).toEqual([]);
  });
  it('excludes dome slots when dome_approved, main_joint slots when joint_approved', () => {
    const dome = row({ optical_dome_01_key: 'd1', dome_approved: true });
    expect(eligibleSlotsForRow(dome)).toEqual([]);
    const mj = row({ main_joint_11_key: 'm1', joint_approved: true });
    expect(eligibleSlotsForRow(mj)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/works-qa/services/__tests__/worksQaScoreEligibility.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the eligibility module**

Create `src/modules/works-qa/services/worksQaScoreEligibility.ts`:

```typescript
import { SLOT_META, type Discipline } from '../utils/slot-keys';
import type { VlmSlotResult, SlotApproval } from '../types/works-qa.types';

/** The pole_qa_photos columns the scorer needs to decide what to score. */
export interface ScorableRow {
  id: string;
  civil_step_01_key: string | null; civil_step_02_key: string | null;
  civil_step_03_key: string | null; civil_step_04_key: string | null;
  civil_step_05_key: string | null; civil_step_06_key: string | null;
  civil_step_07_key: string | null; civil_step_08_key: string | null;
  optical_dome_01_key: string | null; optical_dome_02_key: string | null;
  optical_dome_03_key: string | null; optical_dome_04_key: string | null;
  optical_dome_05_key: string | null; optical_dome_06_key: string | null;
  optical_dome_07_key: string | null; optical_dome_08_key: string | null;
  main_joint_11_key: string | null; main_joint_12_key: string | null;
  main_joint_13_key: string | null; main_joint_14_key: string | null;
  main_joint_15_key: string | null; main_joint_16_key: string | null;
  vlm_results: Record<string, VlmSlotResult> | null;
  slot_approvals: Record<string, SlotApproval> | null;
  civil_approved: boolean;
  dome_approved: boolean;
  joint_approved: boolean;
}

function disciplineApproved(row: ScorableRow, d: Discipline): boolean {
  if (d === 'civil') return row.civil_approved;
  if (d === 'dome') return row.dome_approved;
  return row.joint_approved; // main_joint
}

/**
 * Slots that should be VLM-scored on this row: has a photo, not already scored
 * (no boolean `valid` in its vlm_results entry), and not humanly decided (no
 * per-slot approval/snag, and the slot's discipline is not human-approved).
 */
export function eligibleSlotsForRow(row: ScorableRow): Array<{ slotKey: string; photoKey: string }> {
  const vlm = row.vlm_results ?? {};
  const approvals = row.slot_approvals ?? {};
  const out: Array<{ slotKey: string; photoKey: string }> = [];

  for (const meta of SLOT_META) {
    const photoKey = (row as unknown as Record<string, string | null>)[meta.dbColumn];
    if (!photoKey) continue;                                   // no photo
    if (typeof vlm[meta.key]?.valid === 'boolean') continue;   // already scored
    if (approvals[meta.key]) continue;                         // per-slot human decision
    if (disciplineApproved(row, meta.discipline)) continue;    // discipline approved
    out.push({ slotKey: meta.key, photoKey });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/works-qa/services/__tests__/worksQaScoreEligibility.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the eligibility core**

```bash
cd /home/hein/Workspace/FF_Next.js-vlm-scoring && git add src/modules/works-qa/services/worksQaScoreEligibility.ts src/modules/works-qa/services/__tests__/worksQaScoreEligibility.test.ts && git commit -m "feat(works-qa): pure slot-scoring eligibility predicate"
```

- [ ] **Step 6: Write the scorer script**

Create `scripts/works-qa-vlm-score.ts`. This is a headless CLI (console logging is the established script pattern). It scores in two phases (fresh window unbounded, backlog oldest-first up to `--limit`) with bounded concurrency. On a VLM fallback it leaves the slot unscored so it retries next run.

```typescript
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
import { validatePhotoWithVlm } from '@/modules/works-qa/services/worksQaVlmService';
import { eligibleSlotsForRow, type ScorableRow } from '@/modules/works-qa/services/worksQaScoreEligibility';
import { absolutePhotoUrl } from '@/modules/works-qa/utils/photo-url';
import { getSlotMeta } from '@/modules/works-qa/utils/slot-keys';

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// The pending marker feedback returned by worksQaVlmService on any VLM error.
// A fallback must NOT be persisted as a real score — leave the slot unscored so
// it retries next run instead of sticking as a red fail.
const FALLBACK_FEEDBACK = 'VLM validation failed — manual review required';

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
      photoUrl: absolutePhotoUrl(task.photoKey),
      slotKey: task.slotKey,
      stepLabel: meta.label,
      vlmCheck: meta.vlmCheck,
    });
    // Fallback sentinel → leave unscored (retry next run).
    if (result.confidence === 0 && result.feedback === FALLBACK_FEEDBACK) {
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
    console.error(`  score failed row=${task.rowId} slot=${task.slotKey}: ${err instanceof Error ? err.message : String(err)}`);
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
  if (!dbUrl) { console.error('ERROR: DATABASE_URL not set'); process.exit(1); }

  const limit = Number(argVal('--limit') ?? 500);
  const concurrency = Number(argVal('--concurrency') ?? 4);
  const freshHours = Number(argVal('--fresh-hours') ?? 3);
  const project = argVal('--project');
  const projFilter = project ? 'AND project_id = $1::uuid' : '';
  const projParams = project ? [project] : [];

  const pool = new Pool({ connectionString: dbUrl });
  try {
    // Phase 1 — fresh: everything synced in this run's window.
    const fresh = await pool.query<ScorableRow>(
      `SELECT ${SCORABLE_COLUMNS} FROM pole_qa_photos
        WHERE updated_at > NOW() - ($${projParams.length + 1} || ' hours')::interval ${projFilter}`,
      [...projParams, String(freshHours)],
    );
    const freshTasks = tasksForRows(fresh.rows);
    console.log(`Phase 1 (fresh <${freshHours}h): ${fresh.rows.length} rows, ${freshTasks.length} eligible slots`);
    const freshRes = await runPool(pool, freshTasks, concurrency);
    console.log(`  fresh: scored=${freshRes.scored} errored=${freshRes.errored} skipped=${freshRes.skipped}`);

    // Phase 2 — backlog: oldest first, capped at --limit eligible slots.
    const backlog = await pool.query<ScorableRow>(
      `SELECT ${SCORABLE_COLUMNS} FROM pole_qa_photos
        WHERE updated_at <= NOW() - ($${projParams.length + 1} || ' hours')::interval ${projFilter}
        ORDER BY updated_at ASC
        LIMIT $${projParams.length + 2}`,
      [...projParams, String(freshHours), limit],
    );
    const backlogTasks = tasksForRows(backlog.rows).slice(0, limit);
    console.log(`Phase 2 (backlog): ${backlog.rows.length} rows scanned, scoring ${backlogTasks.length} slots (limit ${limit})`);
    const backRes = await runPool(pool, backlogTasks, concurrency);
    console.log(`  backlog: scored=${backRes.scored} errored=${backRes.errored} skipped=${backRes.skipped}`);

    const totalErr = freshRes.errored + backRes.errored;
    console.log(`TOTAL: scored=${freshRes.scored + backRes.scored} errored=${totalErr}`);
    if (totalErr > 0) process.exitCode = 1; // cron logs a WARNING
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('works-qa-vlm-score failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 7: Type-check the script compiles against the aliases**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "works-qa-vlm-score|worksQaScoreEligibility" || echo "no type errors in new files"`
Expected: `no type errors in new files`. (If `@/` alias isn't picked up in scripts, match the import style of `scripts/works-qa-sync.ts`, which already uses `@/…` imports under `tsx`.)

- [ ] **Step 8: Commit the script**

```bash
cd /home/hein/Workspace/FF_Next.js-vlm-scoring && git add scripts/works-qa-vlm-score.ts && git commit -m "feat(works-qa): headless VLM scoring script (fresh + backlog drain)"
```

---

### Task 6: Wire the scorer into the ingest cron

Add the scoring step after sync so freshly-synced photos get scored the same run.

**Files:**
- Modify: `scripts/cron/worksqa-qfield-ingest.sh`

- [ ] **Step 1: Read the current cron script to match its `run_tsx` + step-numbering style**

Run: `sed -n '1,80p' scripts/cron/worksqa-qfield-ingest.sh`
Expected: you see `[1/3] extract`, `[2/3]` sync, `[3/3]` coverage using `run_tsx`/`$PYTHON`.

- [ ] **Step 2: Insert the scoring step between sync and coverage**

Renumber to 4 steps. After the `works-qa-sync.ts --all-active` line and before the coverage step, add:

```bash
echo "[3/4] works-qa-vlm-score.ts (fresh + up to 500 backlog)"
run_tsx scripts/works-qa-vlm-score.ts --limit 500 --concurrency 4 --fresh-hours 3 \
  || echo "  WARNING: vlm-score step failed (continuing)"
```

Update the existing sync line's label to `[2/4]` and the coverage line's label to `[4/4]`. Keep the `|| echo "WARNING…"` non-fatal convention so a scoring hiccup never blocks the pipeline.

- [ ] **Step 3: Syntax-check the shell script**

Run: `bash -n scripts/cron/worksqa-qfield-ingest.sh && echo "shell OK"`
Expected: `shell OK`.

- [ ] **Step 4: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-vlm-scoring && git add scripts/cron/worksqa-qfield-ingest.sh && git commit -m "feat(works-qa): add VLM scoring step to ingest cron"
```

---

### Task 7: Full verification + smoke run

- [ ] **Step 1: Run the full works-qa test group**

Run: `npx vitest run src/modules/works-qa pages/api/works-qa`
Expected: PASS.

- [ ] **Step 2: Lint gate**

Run: `npm run ci:quick`
Expected: PASS (fix any lint/type issues surfaced before opening the PR).

- [ ] **Step 3: One-project smoke run against dev DB (bounded)**

Score a small slice for the project from the original report and confirm rows get real scores. Use the connection string from `.claude/credentials.local.md` (never inline the password in a tracked file).

Run:
```bash
cd /home/hein/Workspace/FF_Next.js-vlm-scoring && DATABASE_URL="$WORKS_QA_DB_URL" npx tsx scripts/works-qa-vlm-score.ts --project 7794d0ba-95c9-491b-8cb5-7f300c61aa23 --limit 10 --concurrency 2
```
Expected: log shows `scored=N` with N>0, `errored=0` (or few). Then verify in the DB that `pole_qa_photos.vlm_results` for a scored pole now has entries with a boolean `valid` and `scored:true`, and that a humanly-approved slot (if any) was skipped.

- [ ] **Step 4: Push + open PR**

```bash
cd /home/hein/Workspace/FF_Next.js-vlm-scoring && git push -u origin feature/works-qa-vlm-scoring
```
Then open the PR with `gh pr create` summarising: root cause (Works-QA never scored QField photos; `vlm_confidence` NULL since 2026-03-03), the new scoring step, and the pending-state UX. Do NOT deploy to prod during business hours; dev deploy via `bash scripts/deploy-local.sh dev`.

---

## Notes / follow-ups (out of scope here)

- Prod cron wiring for the whole ingest pipeline is still pending per `project_worksqa_qfield_ingest_automation` — the new step ships with the code but prod's crontab must be wired separately.
- `qfield_photo_validations.vlm_confidence` remains NULL by design; nothing critical for Works-QA reads it after this change.
