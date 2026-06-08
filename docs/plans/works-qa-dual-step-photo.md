# Works QA — Reuse one photo for two steps (dual-step linking)

**Status:** Built · **Branch:** `feat/works-qa-dual-step-photo` · **Date:** 2026-06-08

## Problem
Sometimes one photo legitimately satisfies two approvable steps in the same
discipline — e.g. a pole lying on its side showing the **depth** (tape measure)
*also* clearly shows the **end-plates**. Today there's no way to point a second
slot at an existing photo: photos only enter a slot via QField sync or a new
file upload (`pole-assign`), and a slot that already holds a (wrong) photo has no
reuse affordance. Drag-and-drop (`move-photo`) *moves* a photo — it can't put the
same photo in two slots.

## Solution
Let a reviewer reuse an existing same-discipline photo for another step, marked
as a **dual-step override**.

- **API:** `POST /api/works-qa/link-photo` `{pole_id, source_slot, target_slot, reason?}`
  — modeled on `move-photo` but **copies** (source keeps its photo). Validates
  same discipline; if the target already held a different photo it's pushed back
  to the unassigned bucket (not discarded). Sets
  `vlm_results[target] = {valid:true, overridden_by, override_reason, dual_step:true, source_slot}`.
  Auth: `construction-qa.works-qa.override` (edit), same as move/override.
- **UI:** "⧉ Use existing photo" on each `PhotoSlotCard` opens `SlotPhotoPicker`,
  which lists same-discipline photos via `getLinkCandidates()`. Selecting one
  links it and marks the slot dual-step. A "⧉ Same photo as another step" badge
  shows on linked slots.

## Decisions (Hein, 2026-06-08)
1. **Exclude from VLM training** — dual-step links do **NOT** write
   `qa_correction_examples`. A depth photo standing in for end-plates is not a
   VLM misclassification; logging it would teach the model the wrong association.
   The `dual_step` flag keeps it auditable and filterable.
2. **Same discipline only** — picker is restricted to civil↔civil, dome↔dome,
   main_joint↔main_joint. Matches the real cases and avoids cross-discipline errors.

## Why no migration
Rides entirely on existing schema: each slot is an independent TEXT column, so
the same `photo_key` can live in two columns; the flag is JSONB in `vlm_results`.
The approval gate (`disciplineGatesPass`) already passes a slot whose vlm entry
has `overridden_by` set.

## Files
- `pages/api/works-qa/link-photo.ts` (new)
- `src/modules/works-qa/utils/link-candidates.ts` (new, unit-tested)
- `src/modules/works-qa/components/SlotPhotoPicker.tsx` (new)
- `PhotoSlotCard.tsx` (+ `onLinkExisting` prop + button + dual_step badge)
- `PoleDetailPanel.tsx` (picker state + `linkPhoto` wiring)
- `pole-detail-api.ts` (+ `linkPhoto` helper) · `works-qa.types.ts` (+ `dual_step`, `source_slot`)

## Validation
- Unit: `link-candidates.test.ts` (same-discipline filter, target exclusion, unknown slot).
- `tsc` clean · eslint clean · `ci:quick`.
- UI: dev — open a pole, "Use existing photo" on end-plates, pick the depth shot,
  confirm slot fills + dual_step badge + discipline can be approved.
