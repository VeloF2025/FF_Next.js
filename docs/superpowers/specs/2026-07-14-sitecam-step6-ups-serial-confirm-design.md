# SiteCam step 6 — dual serial scan (ONT + Gizzu UPS) with confirm gate

**Date:** 2026-07-14 · **Status:** approved (design), implementing
**Scope:** `/my/sitecam` PWA wizard, activation job type only.

## Goal

At step 6 the technician must scan **two** serials, each with an explicit
"is this correct?" confirmation before it is saved:

- **6a** — ONT serial (`ALCL…`) → `ont_serial_scanned`
- **6b** — Gizzu UPS serial (`GU18W…`) → `ups_serial_scanned`

Both are **mandatory**. Step 6 keeps its single ONT-back photo and its step
number (no renumbering — `pwa_photo_urls` keys, `STEP_LABELS`, and the Activate
DR-review bucket are untouched). No DB migration — `ups_serial_*` columns and
the UPS branch of `verify-serial` already exist.

## Field flow

```
Step 6: ONT Back After Install
  1. Take ONT-back photo                         (unchanged)
  2. serial_scan · 6a (1 of 2) — ONT Serial
       scan/type ALCL… → [confirm card] → Confirm → POST device=ont → saved
  3. serial_scan · 6b (2 of 2) — Gizzu UPS Serial
       scan/type GU18W… → [confirm card] → Confirm → POST device=ups → saved
  4. serial_pending → advance to step 7
```

Rescan/Edit on the confirm card discards the candidate (nothing saved) and
returns to the scan/manual UI. A rejected candidate never POSTs, so it never
consumes a serial attempt.

## Changes

### 1. Step model — `lib/sitecamSteps.ts`
- Add `interface SerialSpec { device: 'ont' | 'ups'; label: string }`.
- `SiteCamStep` gains `serials?: readonly SerialSpec[]`.
- Step 6: `serials: [{ device:'ont', label:'ONT Serial' }, { device:'ups', label:'Gizzu UPS Serial' }]`
  (keep `hasSerialScan:true`; drop the single `serialDevice/serialLabel` on step 6).

### 2. StepState — `lib/sitecamTypes.ts`
- Add `serials: SerialSpec[]` (empty for non-serial steps) and `serialIndex: number`.
- `serialDevice`/`serialLabel`/`serialAttempts`/`serialScanned` stay, but now
  mirror the **current** serial (`serials[serialIndex]`), updated as the index
  advances. Keeps `SerialScanStep` props stable.

### 3. State machine — `hooks/useSiteCamCapture.ts`
- `initStepStates`: build `serials` from `step.serials` (fallback: single-element
  list from legacy `serialDevice/serialLabel` if present, else `[]`); `serialIndex:0`;
  `serialDevice/serialLabel` = `serials[0]` when present.
- `handleSerialSaved(idx, serial)`:
  - **not last serial** (`serialIndex+1 < serials.length`): stay `serial_scan`,
    `serialIndex++`, set `serialDevice/serialLabel` to the next serial,
    reset `serialAttempts:0`, `serialScanned:null`. **Do not advance.**
  - **last serial**: `status:'serial_pending'`, `serialScanned:serial`,
    `serialAttempts++`, then `advanceStep(1500)`.
  - Decide last-vs-not from the current snapshot (`stepStates[idx]`) at call time
    (add `stepStates` to the callback deps) so advance fires exactly once.
- `skipSerialStep` (dev test-only): skip the **current** serial — advance the
  index like a save, or complete+advance if it was the last.

### 4. Confirm gate — `components/SerialScanStep.tsx` + new `SerialConfirmCard.tsx`
- New `pendingSerial` state. Capturing a candidate (camera `onScan` OR manual
  "Review" button) normalises + format-checks locally and sets `pendingSerial`
  instead of POSTing.
- Render `SerialConfirmCard` when `pendingSerial` (before the saved card):
  "Is this {serialLabel} correct?" + big mono serial + **Confirm** / **Rescan / Edit**.
  - Confirm → `submitScan(pendingSerial)` (the existing POST) → saved flow.
  - Rescan/Edit → clear `pendingSerial`, keep `manualSerial` for editing.
- Header shows the sub-step: e.g. "Serial 1 of 2 — ONT Serial" via new
  `serialPosition?: { index: number; total: number }` prop.
- `submitScan` POST body gains `device: serialDevice`.
- Extract the confirm card into `SerialConfirmCard.tsx` to keep `SerialScanStep`
  under the 200-line component limit.

### 5. Render wiring — `components/StepCapture.tsx`
- Pass current serial to `SerialScanStep` (`serialDevice/serialLabel/serialAttempts`
  already reflect the current serial) + `serialPosition`.
- Add `key={step.serialIndex}` on `SerialScanStep` so it remounts with clean
  internal state for 6b.

### 6. API — `pages/api/my/sitecam/verify-serial.ts`
- Accept optional `device: 'ont' | 'ups'` in the body; prefer it over the
  step-number inference (step 6 now carries both serials). Fall back to the
  existing `step===6?ont:ups` when `device` absent (back-compat).
- Column selection keys off the resolved device (unchanged otherwise).

### 7. Draft — `lib/sitecamDraft.ts`
- Persisted `StepState` now carries `serials`/`serialIndex`. On restore, default
  a missing `serialIndex` to 0 and rebuild `serials` from the step config so a
  pre-change draft (mid-job deploy) is never stranded.

## Tests
- `sitecamSteps.test`: step 6 has `serials:[ont,ups]`; steps 1–5,7–12 have none.
- `useSiteCamCapture` serial-sequence: first save → `serial_scan`, `serialIndex 1`,
  no advance; second save → `serial_pending` + advance; per-serial attempts reset.
- `SerialScanStep.test`: scan → confirm card (no auto-save); Confirm → POST(device);
  Rescan → back; manual → Review → confirm. Update existing auto-save assumptions.
- `verify-serial`: `device:'ups'` writes UPS columns even when `step===6`.

## Verify (E2E on dev)
Drive the SiteCam PWA to step 6, scan/confirm 6a (ONT) then 6b (UPS), confirm
both `ont_serial_scanned` and `ups_serial_scanned` land in
`dr_photo_unified_reviews` for a test DR; clean up any test row.
