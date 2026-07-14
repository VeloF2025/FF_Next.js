# SiteCam step 10 — customer sign-off

**Date:** 2026-07-14 · **Status:** approved, implemented

## Problem

SiteCam wizard step 10 ("Signature") was a photo step — the tech photographed a
signature on paper (or uploaded one). The customer should sign on the device
instead.

## Approved design

Step 10 becomes an on-device **customer sign-off**:

- **Printed name** (text input, required)
- **Consent checkbox**, statement: *"I confirm the fibre installation at my premises is complete and working."* (required)
- **Signature pad** — the customer signs with finger/stylus (required, non-empty)
- **"Confirm sign-off"** button, disabled until all three are present

On confirm, the name + consent + drawn signature are composited into a **single
image** that is handed to the wizard's existing `onCapture` callback. Because
step 10 is now `hasVlm:false`, the image flows through the normal
downscale → watermark (DR + timestamp) → upload path and lands in
`dr_photo_unified_reviews.pwa_photo_urls` as step 10, exactly like any other
step. **No DB or storage change.**

### Where SiteCam photos are stored (verified 2026-07-14)

`POST /api/sitecam/upload` → `uploadToVfStorage` → VF Storage
`http://100.96.203.105:8091/upload/sitecam/photos` → physically
`/srv/storage/fibreflow-storage/sitecam/photos/<ms>-<hash>.jpg` on velo. The
returned `/storage/sitecam/photos/…` path is stored per step in
`pwa_photo_urls` (JSON `{stepNumber → url}`) and served same-origin via the
`/storage/` proxy (`https://app.fibreflow.app/storage/…`). The sign-off image
uses this identical path as step 10.

## Components / changes

- `SignaturePad` (field-stock-pwa) — reused; added optional `label`/`hint` props (defaults unchanged, so field-stock is unaffected).
- `lib/signoff.ts` — `SIGNOFF_CONSENT_TEXT` + pure `canSubmitSignoff()` gate (name + consent + signature).
- `lib/buildSignoffImage.ts` — composites name + consent + signature into a dark-theme JPEG `File` (DR/time deliberately left to the pipeline watermark).
- `SiteCamSignatureStep` — the UI; on confirm builds the image and calls `onSigned`.
- `StepCapture` — new `isSignature` prop; renders `SiteCamSignatureStep` in place of the camera for the signature step (mirrors the serial-scan branch).
- `SiteCamWizard` — passes `isSignature` from step config.
- `sitecamSteps` — step 10 → `hasVlm:false, signature:true` (label stays `'Signature'` to match the ~10 activate-module step-label maps).

VLM: step 10 is no longer VLM-graded — a drawn signature isn't a gradeable photo; it passes on confirm and advances via the existing non-VLM path.

## Testing

- Unit: `canSubmitSignoff` truth table; step-10 config (signature/no-VLM/no-upload); `SiteCamSignatureStep` disabled-state gating.
- The composite (canvas) and full confirm→upload path aren't unit-testable in jsdom → verified E2E on dev (drive to step 10, sign, submit, confirm the composite lands in `/storage/sitecam/photos/` and renders).

## Out of scope

- No "photograph a paper signature" fallback (the pad replaces it).
- Dark-theme signature (matches existing signatures), not a white print background.
- Structured name/consent DB columns — only needed if the values must be *queried* later; a follow-up if so.
- Surfacing SiteCam photos in the Activate QA Centre ("SiteCam Photos" bucket) is a **separate** follow-up PR.
