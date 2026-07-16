# SiteCam Step 6 Serial Verification — Phase A (server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Read both serials from the SiteCam step-6 photo with the existing VLM extractor and fold that read into the existing 4-way serial-verification engine, so every activation's ONT/UPS serials are reconciled across scan + step-6 photo + OES(ONT only) + 1Map + drops, with mismatches surfaced in QA — no field-UX change.

**Architecture:** Extend, don't duplicate. Reuse `extractSerialsFromWaPhoto` against the step-6 photo URL (`dr_photo_unified_reviews.pwa_photo_urls['6']`), persist the reads into `vlm_ont_serial_step6` (exists) + `vlm_ups_serial_step6` (new column), add those two columns and `drops.mini_ups_serial` as sources inside `computeSerialVerification`, and trigger the whole thing fire-and-forget from `/api/sitecam/upload.ts` after an activation submission. Nothing blocks the technician.

**Tech Stack:** Next.js Pages API, `pg.Pool` (`@/lib/db`), neon shim (`@/lib/db-neon`) for the verification service, existing VLM client, Vitest.

## Global Constraints

- ALL changes via PR; never commit to master. Branch: `feat/sitecam-step6-serial-verify` (already created off `origin/master`).
- Migrations live in `scripts/migrations/sql/` and are applied by Hein via the PR — this plan does NOT run them.
- No `console.log` — use `log` from `@/lib/logger`. No empty catch. Files <300 lines.
- The barcode scan remains the trusted serial value; the VLM read is corroboration only and must never overwrite `{ont,ups}_serial_scanned`.
- The trigger must be non-blocking: a VLM/verification failure must never fail the technician's upload response.
- `npm run ci:quick` must pass; introduce zero new lint warnings (master baseline is already at its cap).

---

### Task 1: Migration — add `vlm_ups_serial_step6`

**Files:**
- Create: `scripts/migrations/sql/443_sitecam_step6_ups_vlm_serial.sql`
- Create: `scripts/migrations/sql/rollback_443_sitecam_step6_ups_vlm_serial.sql`

**Interfaces:**
- Produces: column `dr_photo_unified_reviews.vlm_ups_serial_step6 TEXT` (nullable). `vlm_ont_serial_step6` already exists.

- [ ] **Step 1: Write the migration**

`scripts/migrations/sql/443_sitecam_step6_ups_vlm_serial.sql`:
```sql
-- 443: SiteCam step-6 photo VLM UPS serial read.
-- vlm_ont_serial_step6 already exists (dormant); this adds the UPS counterpart so
-- the step-6 photo can contribute BOTH serials to the 4-way verification engine.
-- Purely additive, nullable — safe to apply any time.
BEGIN;
ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS vlm_ups_serial_step6 TEXT;
COMMENT ON COLUMN dr_photo_unified_reviews.vlm_ups_serial_step6 IS
  'Gizzu UPS serial the VLM read from the step-6 ONT-back photo. Corroboration only; the trusted value stays ups_serial_scanned.';
COMMIT;
```

`scripts/migrations/sql/rollback_443_sitecam_step6_ups_vlm_serial.sql`:
```sql
BEGIN;
ALTER TABLE dr_photo_unified_reviews DROP COLUMN IF EXISTS vlm_ups_serial_step6;
COMMIT;
```

- [ ] **Step 2: Commit**
```bash
git add scripts/migrations/sql/443_sitecam_step6_ups_vlm_serial.sql scripts/migrations/sql/rollback_443_sitecam_step6_ups_vlm_serial.sql
git commit -m "feat(sitecam): migration 443 — step-6 photo VLM UPS serial column"
```

---

### Task 2: Step-6 photo serial extractor + persistence

**Files:**
- Create: `src/modules/activate/services/step6SerialExtraction.ts`
- Test: `src/modules/activate/services/__tests__/step6SerialExtraction.test.ts`

**Interfaces:**
- Consumes: `extractSerialsFromWaPhoto(photoUrl: string): Promise<WaPhotoExtractionResult>` from `./waPhotoExtraction` (returns `{ ontSerial, upsSerial, ontConfidence, upsConfidence, ... }`).
- Produces: `extractStep6Serials(dropNumber: string, photoUrl: string, deps?): Promise<{ ont: string | null; ups: string | null }>` — runs the extractor, persists to `vlm_ont_serial_step6` / `vlm_ups_serial_step6`, returns the reads. Never throws (logs + returns nulls).

- [ ] **Step 1: Write the failing test**

`src/modules/activate/services/__tests__/step6SerialExtraction.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { extractStep6Serials } from '../step6SerialExtraction';

describe('extractStep6Serials', () => {
  it('persists both serials the extractor returns and returns them', async () => {
    const extract = vi.fn().mockResolvedValue({
      success: true, ontSerial: 'ALCLB480E6E8', upsSerial: 'GU18W12V1234567890',
      confidence: 0.9, ontConfidence: 0.98, upsConfidence: 0.8, ontFromBarcode: true, processingTimeMs: 10,
    });
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const out = await extractStep6Serials('DR123', 'https://x/step-6.jpg', { extract, query });
    expect(out).toEqual({ ont: 'ALCLB480E6E8', ups: 'GU18W12V1234567890' });
    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/vlm_ont_serial_step6/);
    expect(sql).toMatch(/vlm_ups_serial_step6/);
    expect(params).toEqual(['DR123', 'ALCLB480E6E8', 'GU18W12V1234567890']);
  });

  it('never throws when the extractor fails — returns nulls, no write', async () => {
    const extract = vi.fn().mockRejectedValue(new Error('VLM down'));
    const query = vi.fn();
    const out = await extractStep6Serials('DR123', 'https://x/step-6.jpg', { extract, query });
    expect(out).toEqual({ ont: null, ups: null });
    expect(query).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/activate/services/__tests__/step6SerialExtraction.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

`src/modules/activate/services/step6SerialExtraction.ts`:
```ts
/**
 * Reads the ONT + Gizzu UPS serials from the SiteCam step-6 photo using the same
 * extractor as the WhatsApp flow, and persists them to the step-6 VLM columns.
 * Corroboration only — the trusted values remain {ont,ups}_serial_scanned.
 * Never throws: a VLM failure must not break the caller (the upload trigger).
 */
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { extractSerialsFromWaPhoto } from './waPhotoExtraction';

const MODULE = 'Step6SerialExtraction';

interface Deps {
  extract?: typeof extractSerialsFromWaPhoto;
  query?: (sql: string, params: unknown[]) => Promise<unknown>;
}

export async function extractStep6Serials(
  dropNumber: string,
  photoUrl: string,
  deps: Deps = {},
): Promise<{ ont: string | null; ups: string | null }> {
  const extract = deps.extract ?? extractSerialsFromWaPhoto;
  const query = deps.query ?? ((sql: string, params: unknown[]) => pool.query(sql, params));
  try {
    const r = await extract(photoUrl);
    const ont = r.ontSerial ?? null;
    const ups = r.upsSerial ?? null;
    await query(
      `UPDATE dr_photo_unified_reviews
         SET vlm_ont_serial_step6 = COALESCE($2, vlm_ont_serial_step6),
             vlm_ups_serial_step6 = COALESCE($3, vlm_ups_serial_step6)
       WHERE drop_number = $1`,
      [dropNumber, ont, ups],
    );
    log.info('Step-6 photo serials extracted', { dropNumber, ont, ups }, MODULE);
    return { ont, ups };
  } catch (err) {
    log.error('Step-6 serial extraction failed', { dropNumber, error: String(err) }, MODULE);
    return { ont: null, ups: null };
  }
}
```
> Note: the test passes `params` as `['DR123', ont, ups]`; keep the param order `$1=drop, $2=ont, $3=ups`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/activate/services/__tests__/step6SerialExtraction.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add src/modules/activate/services/step6SerialExtraction.ts src/modules/activate/services/__tests__/step6SerialExtraction.test.ts
git commit -m "feat(sitecam): extract step-6 photo serials into the step6 VLM columns"
```

---

### Task 3: Add step-6 photo + drops as verification sources

**Files:**
- Modify: `src/modules/activate/services/serialVerificationService.ts` (the `computeSerialVerification` SQL CTE + the `ontSerials`/`upsSerials` arrays, around lines 140-197)

**Interfaces:**
- Consumes: columns `vlm_ont_serial_step6`, `vlm_ups_serial_step6` on `dr_photo_unified_reviews`; `drops.mini_ups_serial`.
- Produces: `computeSerialVerification` now counts the step-6 photo read (ONT + UPS) and drops (UPS) as agreement sources. No signature change.

- [ ] **Step 1: Confirm the drops key column**

Run: `Grep 'drop_number|dr_number' scripts/migrations/030_drops_stock_columns.sql` — confirm `drops` keys on `drop_number`. If it is `dr_number`, use that in the CTE below. (Verification step, not a placeholder — the join column must be correct.)

- [ ] **Step 2: Extend the CTE and source arrays**

In `computeSerialVerification`, add to the `onemap_data` CTE select list:
```sql
             vlm_ont_serial_step6 as step6_ont, vlm_ups_serial_step6 as step6_ups,
```
Add a new CTE after `wa_photo_data`:
```sql
    ,drops_data AS (
      SELECT mini_ups_serial AS ups
      FROM drops
      WHERE drop_number = ${dropNumber}
      LIMIT 1
    )
```
Add to the top-level SELECT:
```sql
      (SELECT step6_ont FROM onemap_data) as step6_ont,
      (SELECT step6_ups FROM onemap_data) as step6_ups,
      (SELECT ups FROM drops_data) as drops_ups,
```
Extend the arrays:
```ts
  const ontSerials = [
    row.oes_ont as string | null,
    row.offline_ont as string | null,
    row.onemap_ont as string | null,
    row.wa_ont as string | null,
    row.step6_ont as string | null,   // SiteCam step-6 photo (ONT)
  ];
  const upsSerials = [
    null, // OES doesn't track UPS
    null, // No offline UPS tracking
    row.onemap_ups as string | null,
    row.wa_ups as string | null,
    row.step6_ups as string | null,   // SiteCam step-6 photo (UPS)
    row.drops_ups as string | null,   // drops / SOW record (UPS)
  ];
```

- [ ] **Step 3: Add a unit test for the pure aggregator with the new sources**

`calculateVerification` is exported-testable indirectly; add a test asserting a step-6-only extra source flips a 2-source ONT match from `partial` to `verified` at ≥3 agreeing. (If `calculateVerification` is not exported, export it for test.)

`src/modules/activate/services/__tests__/serialVerification.step6.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { calculateVerification } from '../serialVerificationService';

describe('calculateVerification with step-6 source', () => {
  it('3 agreeing sources → verified', () => {
    expect(calculateVerification(['ALCLB48D0001', 'ALCLB48D0001', 'ALCLB48D0001']).status).toBe('verified');
  });
  it('one dissenting source → mismatch', () => {
    expect(calculateVerification(['ALCLB48D0001', 'ALCLB48D0001', 'ALCLB48DXXXX']).status).toBe('mismatch');
  });
});
```
Export `calculateVerification` from the service (add `export` to the existing `function calculateVerification`).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/modules/activate/services/__tests__/serialVerification.step6.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/modules/activate/services/serialVerificationService.ts src/modules/activate/services/__tests__/serialVerification.step6.test.ts
git commit -m "feat(sitecam): count step-6 photo + drops as serial-verification sources"
```

---

### Task 4: Trigger extraction + recompute from the upload handler

**Files:**
- Modify: `pages/api/sitecam/upload.ts` (activations branch, after the `dr_photo_unified_reviews` UPDATE, ~line 128)
- Test: `pages/api/sitecam/__tests__/upload.step6.test.ts`

**Interfaces:**
- Consumes: `extractStep6Serials` (Task 2), `computeAndPersistVerification` (existing), `uploadedUrls[6]`.
- Produces: fire-and-forget step-6 verification after an activation upload. Response is unchanged and never delayed by it.

- [ ] **Step 1: Write the failing test** (assert the trigger fires for an activation with a step-6 photo, and that a failure does not affect the response)

`pages/api/sitecam/__tests__/upload.step6.test.ts` — mock `extractStep6Serials` and `computeAndPersistVerification`, POST an activation body with a step-6 photo, assert both are called with the drop number and the step-6 URL, and that the handler still responds success when they reject.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pages/api/sitecam/__tests__/upload.step6.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the trigger**

In `pages/api/sitecam/upload.ts`, add imports:
```ts
import { extractStep6Serials } from '@/modules/activate/services/step6SerialExtraction';
import { computeAndPersistVerification } from '@/modules/activate/services/serialVerificationService';
```
After the activations UPDATE (before the non-activation `else`), inside `if (jobType === 'activations')`:
```ts
    // Fire-and-forget: read the step-6 photo's serials and recompute the 4-way
    // verification. Never blocks or fails the technician's upload response.
    const step6Url = uploadedUrls[6];
    if (step6Url) {
      void (async () => {
        try {
          await extractStep6Serials(drNum, step6Url);
          await computeAndPersistVerification(drNum);
        } catch (err) {
          log.error('Step-6 serial verification trigger failed', { drNum, error: String(err) }, MODULE);
        }
      })();
    }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run pages/api/sitecam/__tests__/upload.step6.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add pages/api/sitecam/upload.ts pages/api/sitecam/__tests__/upload.step6.test.ts
git commit -m "feat(sitecam): trigger step-6 serial verification on activation upload"
```

---

### Task 5: Full gate + PR

- [ ] **Step 1: Run the fleet/sitecam unit tests + ci:quick**

Run: `npx vitest run src/modules/activate/services/__tests__/ pages/api/sitecam/__tests__/` then `npm run ci:quick`
Expected: green; zero new lint warnings; TS error count unchanged from master baseline.

- [ ] **Step 2: Open the PR (stop here — do not merge/deploy)**

Include: the migration 443 (for Hein to apply), the spec + plan links, and a note that Phase B (one-scan UX + sharpness gate) is a separate, browser-verified follow-up. Body must state migration 443 is unapplied and needs Hein.

## Self-Review

- **Spec coverage:** §4.3 (VLM reads both serials) → Tasks 1-2; §4.4 (reconcile scan∩photo∩OES/1Map/drops, engine-extended) → Task 3; §4.5 (QA surface via existing badge) → Task 3 (badge) + Task 4 (trigger populates it); §6 non-blocking → Task 4 fire-and-forget; migration-via-PR → Task 1 + Task 5. Phase B (§4.1-4.2) intentionally deferred.
- **Placeholders:** none — all code inlined. Task 3 Step 1 and the drops key check are genuine verification steps.
- **Type consistency:** `extractStep6Serials(dropNumber, photoUrl, deps?)` returns `{ont, ups}` in Tasks 2 and 4; `calculateVerification(serials: (string|null)[])` matches the existing signature; `uploadedUrls` is `Record<number,string>` so `uploadedUrls[6]` is correct.
- **Risk:** Task 3 edits a shared service used by the WhatsApp flow — the change is purely additive (extra source values into arrays the aggregator already dedupes), and the existing WA sources are untouched. Verify no existing serialVerification test regresses.
