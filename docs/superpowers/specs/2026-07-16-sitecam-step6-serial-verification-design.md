# SiteCam Step 6 — One-Scan Serial Capture, Legible Photo, Photo↔Scan Verification

**Date:** 2026-07-16
**Status:** Design approved (brainstorm), pending spec review
**Scope:** Activation SiteCam, step 6 ("ONT Back After Install"). No civil-flow change.

---

## 1. Problem

At step 6 the technician scans the serials on the back of the ONT. Today that is **two
separate barcode scans in sequence** — 6a ONT (`ALCL…`), 6b Gizzu UPS (`GU18W…`) — each with
its own confirm gate. The scanned values are stored and cross-referenced against 1Map, but:

1. The technician experiences it as two scans; the ask is **one scan** that confirms both.
2. Nothing binds the scanned serial to the **photo** actually taken — a serial could be scanned
   off any unit. There is no proof the scanned serial belongs to the device in the step-6 photo.
3. The step-6 photo is not quality-gated, so a blurry photo (serials unreadable) is accepted.

## 2. Goal

- One scan session captures **both** serials.
- The step-6 photo is **legible** (sharpness-gated at capture).
- The scanned serials are **cross-checked against the VLM read of that same photo**, and
  reconciled against the DR's records (OES / 1Map / drops), automatically.
- A mismatch **flags for QA — it does not block the technician in the field.**

## 3. What already exists (reuse, do not rebuild)

This is the load-bearing finding from the codebase survey. The reconciliation layer is largely
built; this design **extends** it rather than adding a parallel one.

| Capability | Where | Reuse |
|---|---|---|
| Step 6 already captures ONT **and** UPS serials | `sitecamSteps.ts` (`serials: [ont, ups]`) | Keep; change only the capture UX |
| Scan → save + 1Map cross-ref (best-effort, non-blocking, `pending` when no reference) | `verify-serial.ts`, `serialCrossRef.ts` | Keep as the trusted-value path |
| 4-way serial reconciliation (ONT: OES + 1Map + offline + photo-VLM; UPS: 1Map + photo-VLM), badge + persistence | `serialVerificationService.ts` (`computeAndPersistVerification`) | **Extend**: add the SiteCam step-6 photo as a VLM source |
| VLM serial extraction from a photo (ONT + UPS + confidence + from-barcode) | `extractSerialsFromWaPhoto` (`waPhotoExtraction`) | Reuse the extractor against the step-6 photo |
| Per-device status + scanned columns | `dr_photo_unified_reviews.{ont,ups}_serial_scanned/_status` | Keep |
| Dormant column `vlm_ont_serial_step6` | schema (merge migration) | Populate it (currently unused) |

The existing service already encodes the fact that **OES does not track the UPS serial** — the
UPS reconciliation sources are 1Map + drops only. This design keeps that.

## 4. What is new

1. **One scan session, both serials** (field UX). Replace the two confirm-per-serial cycles with
   a single continuous scan pass: the camera stays live, captures the ONT then the UPS barcode,
   shows each as read, and a single confirm gates the pair. Manual entry remains the per-serial
   fallback. **The barcode remains the trusted serial value** — the VLM never overwrites it.
2. **Legibility gate** on the step-6 photo. A client-side sharpness check at capture; if the
   frame is too blurry to read text, the technician is prompted to retake before advancing.
   This is a hard, cheap gate (a bad photo is always retaken) — distinct from the VLM check.
3. **VLM reads the step-6 photo for both serials.** Run the existing extractor on the step-6
   photo. Store the ONT read in the existing `vlm_ont_serial_step6`; add
   `vlm_ups_serial_step6` (new column; migration via PR for Hein to deploy).
4. **Photo↔scan cross-check + records reconciliation, wired into the existing engine.** Feed the
   step-6 photo-VLM read into `serialVerificationService` as an additional source so ONT and UPS
   each reconcile across scan + photo-VLM + OES(ONT only) + 1Map + drops, producing the existing
   badge. Include **drops** (`drops.mini_ups_serial` / `drops_serial`) as a UPS source.
5. **QA surface.** A photo↔scan or records mismatch is recorded and surfaced in the existing
   SiteCam QA review UI (the scanned ONT/UPS, the legible photo, VLM agreement, records verdict).
   It never blocks field submission.

## 5. Data flow

```
FIELD (SiteCam wizard, step 6)
  one scan session ─► ONT barcode + UPS barcode (exact) ─► verify-serial (save + 1Map cross-ref)
  step-6 photo ─► sharpness gate (retake if blurry) ─► uploaded (this IS the OneMap photo)

SERVER (async, after submit — never blocks the technician)
  step-6 photo ─► extractSerialsFromWaPhoto(photoUrl) ─► vlm_ont_serial_step6, vlm_ups_serial_step6
  computeAndPersistVerification(dr) ─► reconciles per device:
      ONT: scan ∩ photo-VLM ∩ OES ∩ 1Map ∩ drops
      UPS: scan ∩ photo-VLM ∩ 1Map ∩ drops        (OES has no UPS)
    ─► badge (gold/…/warning) + serial_verification_* ; mismatch ─► QA surface
```

## 6. Failure & edge handling

- **Blurry photo** → retake (blocking at capture; cheap and reliable).
- **VLM can't read / disagrees** → flag for QA; never block the field. A wrong VLM read must
  not strand a technician who did everything right (consistent with prior auto-QA lessons).
- **Reference data absent** (OES/1Map/drops not landed yet) → `pending`, rechecked later by the
  existing recompute path — same semantics as today's cross-reference.
- **Manual serial entry** still available; a manually-entered serial is photo-verified and
  reconciled identically.

## 7. Explicitly out of scope (YAGNI / guardrails)

- Not replacing the barcode scan with VLM-as-primary (honours the standing "keep the dedicated
  scan" decision; the barcode stays the trusted value).
- Not blocking technicians on VLM or reconciliation mismatches.
- Not adding the UPS serial into OES (separate field/OES-team question).
- No civil-flow change.

## 8. Delivery phases (each independently shippable)

Sized so no single PR both changes the daily technician flow **and** touches the shared
verification service.

- **Phase A — server/verification (no field UX change):** add `vlm_ups_serial_step6` (migration
  PR for Hein); run the extractor on the step-6 photo; extend `serialVerificationService` to
  include the step-6 photo-VLM read and drops; surface the result in QA. Fully back-end; safe to
  ship and observe before touching the field app.
- **Phase B — field UX:** one-scan-both-serials session + the sharpness gate. Touches a
  daily-use flow; requires on-device browser verification (cannot be fully verified on the
  Windows workstation — Playwright/Claude-in-Chrome or field/QA sign-off needed).

Phase A first de-risks the change: the reconciliation is proven on real data before the
technician-facing capture is altered.

## 9. Success criteria

- Step 6 photo-VLM populates `vlm_ont_serial_step6` and `vlm_ups_serial_step6` on real DRs.
- `serial_verification_*` reflects scan ∩ photo ∩ records for both devices, drops included.
- A deliberately mismatched scan vs photo surfaces in QA without blocking submission.
- (Phase B) One scan session captures both serials; a blurry photo is rejected at capture.
- `npm run ci:quick` green; new logic unit-tested; no regression to the WhatsApp verification path.
