# SiteCam VLM: Actionable Fail Reasons + Gallery Test Harness

**Date:** 2026-06-11
**Status:** Approved by Zander

## Problem

1. The step-quality VLM prompt (`stepQualityCriteria.ts`) forces the model to
   return a fixed per-step fail reason ("If it fails, the reason must be
   exactly: …"). Technicians see "Full property not in view" for *every*
   possible failure — including re-photographed screens, wrong subject, or
   framing — so the message gives no usable direction and is often factually
   wrong.
2. QA testers are not on site and cannot produce real captures; re-photographing
   gallery photos off a monitor introduces artifacts that cause false rejects.
   There is no desk-testing path to measure whether the VLM accepts QA-approved
   photos.

## Scope

Activations only. The civils prompt builder (`civilStepCriteria.ts`) is untouched.

### A. Free-text actionable fail reasons

In `buildMessageContent` (`src/modules/activate/services/stepQualityCriteria.ts`),
both the few-shot and text-only branches:

- Replace the "reason must be exactly" instruction with: on fail, return
  `fail_reason` as ONE short sentence (max ~140 chars) that tells the
  technician what is wrong **and** what to do to pass (e.g. "Only the top
  floor is in frame — step back so the roof and both building edges are
  visible.").
- Explicitly instruct: if the image appears to be a photo of a screen,
  monitor, or printed photo (moiré patterns, screen bezels, glare, visible
  pixels), the fail_reason must say that instead of a framing complaint.
- The JSON contract is unchanged: `{"passes": false, "fail_reason": "<text>"}`.

Fallbacks (canned `criteria.failReason` is kept as the safety net):

- `pages/api/sitecam/validate.ts`: when the VLM fails a photo but returns an
  empty/missing `fail_reason`, use `STEP_CRITERIA[step].failReason` (or the
  civil equivalent for civils) instead of an empty reasons array.
- `src/modules/activate/services/stepQualityValidationService.ts`: same — when
  `!passes` and no usable `fail_reason`, fall back to
  `STEP_CRITERIA[step].failReason` so auto-QA comments are never empty.

Consumers need no changes: SiteCam (`StepCapture`) and auto-QA
(`autoQaPhotoQualityChecks`) already display `failReason` as opaque text;
nothing in the codebase string-matches the canned reasons.

### B. Gallery test harness

New script `scripts/sitecam/vlm-gallery-check.ts`, run via
`npx tsx scripts/sitecam/vlm-gallery-check.ts --step 1 [--job activation] [--label positive|negative|both] [--limit 20]`.

- Loads gallery photos for the step/job/label from `vlm_visual_photo_examples`
  (newest first, up to `--limit`, default 20, default label `both`).
- For each photo: fetch via `fetchPhotoAsBase64`, build the prompt with the
  same `loadGalleryExamples` + `buildMessageContent` path the validate
  endpoint uses, call the VLM chat endpoint, parse `{passes, fail_reason}`.
- Prints a per-photo table (label, photo URL tail, PASS/FAIL, fail_reason) and
  a summary: positives accepted x/y, negatives rejected x/y.
- Marks rows that are among the 6 newest per label — those are injected into
  the prompt as examples, so their result is trivial and excluded from an
  additional "non-example" summary line.
- Read-only: no writes to `pwa_photo_hashes`, `pwa_escalations`, or any table.
- Requires `DATABASE_URL` env var; VLM endpoint/model come from `@/lib/vlm`
  constants. Exits non-zero on no rows or total VLM failure.

## Error handling

- Script: per-photo VLM/network errors are reported as `ERROR` rows and
  excluded from rates; the run continues.
- App: parsing fallbacks unchanged (fail-open semantics in validate.ts remain).

## Testing

- Unit tests for the prompt builder: instruction text no longer demands the
  exact canned string; includes the actionable-direction instruction and the
  photo-of-screen instruction; JSON contract examples still present.
- Unit tests for both fallbacks (validate.ts via API test mocking the VLM
  response with `fail_reason: ""`; service via its existing test seam).
- Harness: tested by running it for real against step 1 (manual, documented
  output in PR), plus a unit test for its arg parsing / row-classification
  helper if extracted.

## Out of scope

- Civils prompt changes.
- Any UI changes (SiteCam already renders whatever reason it receives).
- VLM model/temperature tuning; criteria text changes for specific steps.
