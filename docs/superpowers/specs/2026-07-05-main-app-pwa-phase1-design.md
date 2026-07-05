# Main App PWA — Phase 1: Offline Photo / Large-Blob Capture

**Status:** ✅ APPROVED (Hein, 2026-07-05). O1 surface = **Snags photo**; O2–O4 accepted per recommendation (§8). Ready for implementation — start with PR-1 (lib). Implementation deferred to a fresh session by Hein's request.
**Author:** Claude (Opus), 2026-07-05. Produced via brainstorming → grill-me → spec.
**Predecessor:** Phase 0 (PR #2115, merged 2026-07-04) — installable shell + app-wide offline read + reusable offline-write queue `src/lib/offline-queue/` + Snags `complete_step` (JSON) pilot. Phase-0 polish (neutral offline page) shipped as PR #2121 (2026-07-05).

---

## 1. Problem & Goal

Phase 0 proved the offline-write queue on a **small JSON** payload: a subcontractor can tap "Mark Complete" on a non-photo verification step while offline, and it flushes on reconnect. The queue library (`src/lib/offline-queue/`) is generic over its payload type, but it was only ever exercised with a few hundred bytes of JSON.

The field reality Phase 0 deferred: **photos**. Most snag verification steps are *photo-slot* steps — the technician must capture one or more photos into named slots, and the photo upload itself is what completes the step. Today `handlePhotoUpload` (`src/modules/noc/snag-resolve/useSnagResolve.ts`) POSTs a multipart `FormData` synchronously; **if the device is offline, the upload just fails** and the technician is blocked. The Phase-0 offline affordance covers `complete_step` but not the photo path that most steps actually depend on.

**Goal:** let a subcontractor capture snag verification-step photos **while offline**, have them stored durably on-device, and flush automatically on reconnect — reusing the Phase-0 queue, and adding the one genuinely new mechanic: **safe on-device storage of large binary blobs** (byte-aware quota, image downscaling, blob-safe IndexedDB) plus **idempotent** replay.

### Program shape (recap)
- **Phase 0** ✅ installable shell + offline read + queue lib + Snags `complete_step` pilot.
- **Phase 1** ← *this doc* — offline **photo** capture. Recommended surface: extend the same Snags snag-resolve page (already offline-capable). See §5.
- **Phase 2+** — Activations/DR offline capture, NOC ticket updates. Each consumes the (now blob-capable) queue.

---

## 2. Goals & Non-Goals

### Goals (Phase 1)
1. Extend `src/lib/offline-queue/` with **byte-aware quota validation** (surface-agnostic): reject an enqueue that would exceed a per-queue byte budget or the browser's storage estimate, with a typed error the UI must handle — mirroring the existing `QueueFullError` count cap.
2. A shared **image-downscale util** applied before enqueue, bounding each stored photo to a predictable size (~200–500 KB) so the quota math is stable and uploads are fast on 3G.
3. A **Snags photo offline queue** consumer: capture → downscale → store the JPEG **Blob** in IndexedDB → on reconnect, rebuild the exact multipart `FormData(action=upload_photo, …)` and POST to `/api/snags/shared/[token]`.
4. **Idempotent replay**: a photo whose server commit succeeded but whose 2xx was lost must NOT create a duplicate `maintenance_attachments` row or double-increment `attachments_count` on retry (see §3.5).
5. **UI**: an offline "photo queued" affordance on the resolve page (mirrors Phase-0 `PendingSyncIndicator`), plus emphatic "not saved" copy when the quota/queue is full (mirrors attendance's `not_saved` semantics — a tired tech must not mistake a hard failure for auto-retry).
6. Page-context flush only (online edge + mount + 60s poll + manual), **not** SW Background Sync — consistent with Phase 0.

### Non-Goals (explicitly deferred — YAGNI)
- **Activations/DR offline capture** — that is Phase 2 (unless Hein reverses the surface decision in §5).
- Offline capture of **video** or non-image blobs.
- **Background Sync API** / periodic sync.
- Editing/re-ordering queued photos beyond the dropped-store visibility the lib already provides.
- Multi-photo-per-slot beyond what the online flow already supports.
- Any change to the QA-wizard / VLM pipeline.
- Retroactive offline support for the legacy single-photo (non-slot) step path beyond what falls out for free (see §8 open question O3).

---

## 3. Architecture

Four units, smallest-blast-radius first. Units 3.1–3.2 are **surface-agnostic** (in `src/lib/`) so Phase 2 inherits them unchanged; 3.3–3.5 are the Snags-specific consumer.

### 3.1 Byte-aware quota (extend `src/lib/offline-queue/`)
The lib today caps by **item count** (`maxQueueSize`, default 50) in `OfflineQueueStore.enqueue`. That is correct for JSON but unsafe for photos: 50 × 3 MB = 150 MB would silently blow past a mobile browser's IndexedDB quota. Add a **byte budget** alongside the count cap:

- `OfflineQueueConfig` gains optional `maxQueueBytes?: number` and `sizeOf?: (payload) => number`.
- `OfflineQueueStore` tracks a running `pendingBytes` (persisted in a tiny `meta` store, or summed from a `byteSize` field written on each pending row — decision D-store below).
- `enqueue` throws a new typed `QuotaExceededError(currentBytes, addBytes, budget)` when `pendingBytes + addBytes > maxQueueBytes`, **and** consults `navigator.storage.estimate()` — if `usage/quota` would exceed a safety fraction (e.g. 0.8) it also throws. `navigator.storage.estimate` is best-effort (absent/loose on some browsers): treat "unavailable" as *pass the byte-budget check only* (never as a hard block that strands a legitimate photo).
- Count cap and byte cap coexist; whichever trips first wins.

**D-store (resolved):** store a `byteSize: number` on each `QueuedItem` and sum via an IndexedDB `count`/cursor on enqueue. Avoids a second source of truth that could drift from the actual rows. `pendingBytes` is derived, never authoritative.

### 3.2 Image downscale util (`src/lib/images/downscaleImage.ts` — new, shared)
`downscaleImage(file: File, opts): Promise<Blob>` — canvas-based: draw the source into a canvas capped at a max long-edge (default **1600 px**), export JPEG at quality **0.8**. Strips EXIF orientation by honoring it during draw (mobile cameras rotate via EXIF). Returns a `Blob`. Bounds each photo to roughly 200–500 KB regardless of the 5–12 MB camera original — this is what makes the §3.1 quota math tractable and 3G uploads viable. Pure, unit-testable with a synthetic `ImageBitmap`/canvas stub. (Attendance already downscales its selfie at capture; this generalises that so Phase 2 reuses it.)

### 3.3 Snags photo queue consumer (`src/modules/noc/snag-resolve/offline/`)
- `photoQueueDb` config: `queueName: 'SnagPhotoDB:<token>'` (per-token DB, mirroring the Phase-0 `SnagCompleteDB:<token>` isolation so two share links can't collide).
- `PendingSnagPhoto` payload: `{ token, stepId, slotKey?, actorId, clientUploadId, photoBlob: Blob, filename, mimeType, byteSize, capturedAt }`. The `Blob` is stored **natively** (IndexedDB structured-clone handles Blobs; the lib never JSON-serialises payloads — verified in `store.ts`). See D-format below.
- `submitSnagPhoto(payload)`: rebuild `FormData` exactly as the online path does — `action=upload_photo`, `file` (from the stored Blob), `stepId`, `actorId`, optional `slotKey`, **plus** `clientUploadId` (new; see §3.5) — and POST to `/api/snags/shared/${token}`. Throw with `.status` on non-2xx so the lib's `defaultClassify` drains 400/409 and keeps 5xx/network.

**D-format (resolved): store the `Blob`, not base64.** Base64 (the attendance selfie precedent) costs +33 % size — wasteful against the scarce quota that is the whole problem here. Blobs survive IndexedDB structured clone natively and append directly to `FormData`. The attendance selfie is a single tiny image where JSON-uniformity mattered more than bytes; field photos invert that trade. (Fallback if a target browser mishandles IDB Blobs — historically old iOS Safari — is base64; flagged as impl-time device-verify risk R2.)

### 3.4 Wire offline fallback into `useSnagResolve.handlePhotoUpload`
Mirror the attendance `submitClockEventWithOfflineFallback` state machine: if `!navigator.onLine` OR the fetch throws a network error → downscale → `enqueue` → return a `queued` result; on `QuotaExceededError`/`QueueFullError` → return an emphatic `not_saved` result the UI renders as a hard failure (never a green check). Keep the decision logic **outside** React (pure, unit-testable), matching Phase 0's `offlineComplete.ts` / attendance's `submitClockEvent.ts`.

### 3.5 Idempotent replay (server + schema — REQUIRED for retry safety)
Verified in the handler: the slot write `INSERT … maintenance_step_photos … ON CONFLICT (step_id, slot_key) DO UPDATE` is **idempotent**, and the step auto-complete is a concurrency-safe conditional UPDATE. **But** the same action also runs a plain `INSERT INTO maintenance_attachments …` and `attachments_count = attachments_count + 1` with **no idempotency guard**. A lost-ack retry (server committed, 2xx never reached the client) therefore duplicates the attachment row and inflates the counter — exactly the failure the offline queue's at-least-once retry makes *likely*, not rare.

**Fix:** carry a client-generated `clientUploadId` (UUID, minted at capture, stored on the queued item so retries reuse the same value). Server:
- add a nullable `client_upload_id uuid` column to `maintenance_attachments` + a partial unique index `WHERE client_upload_id IS NOT NULL` (migration `scripts/migrations/sql/NNN_*.sql` — the runner-tracked numbered path, per [[feedback_dual_migration_trackers_drift]]);
- make the attachment INSERT `ON CONFLICT (client_upload_id) DO NOTHING` and only bump `attachments_count` when a row was actually inserted (guard on `INSERT … RETURNING` / `ROW_COUNT`).
Online uploads pass `clientUploadId` too (harmless, and closes the same double-tap gap that exists today). This is **in Phase-1 scope** — retry safety is the entire point of an offline queue; shipping the queue without it would bank a data-integrity regression.

### 3.6 What is NOT needed — cross-queue ordering (verified, de-risked)
The feared dependency between the Phase-0 `complete_step` queue and this photo queue **does not exist**: `complete_step` guards only ticket status (never `photo_required`), photo/slot steps are auto-completed *by the photo upload itself*, and the UI gates the "Mark Complete" (complete_step) affordance on `step.photo_slots.length === 0`. The two queues therefore target **mutually exclusive** step types. No ordering coordination, no shared transaction, no sequencing logic. (Recorded so a future reader doesn't re-introduce coupling.)

---

## 4. Data Flow

**Offline capture:**
`<input type=file capture>` → `File` (5–12 MB) → `downscaleImage` → `Blob` (~300 KB) → mint `clientUploadId` → `photoQueue.enqueue({…, photoBlob, clientUploadId})` → byte-quota check → IndexedDB `SnagPhotoDB:<token>.pending` → UI shows "1 photo queued".

**Reconnect flush** (page-context, via `useOfflineQueue`):
`online` edge / 60s poll → `listPending` → for each: rebuild `FormData(action=upload_photo, file=Blob, stepId, slotKey?, actorId, clientUploadId)` → POST → 2xx → `deletePending`; 400/409 → `drop` (dropped store, user-visible); 5xx/network → `bumpAttempts` + keep (stop the batch). Server upserts the slot (idempotent), inserts the attachment guarded by `clientUploadId` (idempotent), auto-completes the step when required slots fill.

---

## 5. Approach Decision — Surface (✅ RESOLVED: Option B, Hein 2026-07-05)

The one decision that changes the shape of everything downstream. **Hein confirmed Option B (Snags photo).** Original framing kept below for the record.

- **Option B — Extend the Snags pilot (RECOMMENDED).** Add offline photo upload to the snag-resolve page Phase 0 already made offline-capable. Smallest new surface, so the work concentrates on the genuinely new mechanic (blob + quota + downscale + idempotent replay). De-risks that mechanic on a proven surface before the large Activations/DR surface. Lower blast radius; faster to ship. Activations/DR becomes Phase 2 with the pattern battle-tested.
- **Option A — Activations/DR (the originally-agreed decomposition).** Higher user value (activation photo capture is the core field workflow) but introduces the new blob mechanic **and** a large, complex surface (5-phase QA wizard, VLM categorisation, multi-photo DR) simultaneously — bigger scope, higher risk for a first offline-photo implementation.

**Recommendation: B.** If Hein picks A, §3.1–3.2 (lib quota + downscale) and §3.5 (idempotency principle) transfer unchanged; only §3.3–3.4 (the consumer + wiring) get rewritten against the Activations endpoints, and §3.5's concrete table becomes the Activations photo table.

---

## 6. Testing & Verification

- **Unit (Vitest, jsdom + fake-indexeddb):** quota math (under/at/over budget; storage-estimate unavailable → pass; count vs byte trip order); `downscaleImage` (dimension cap, quality, EXIF orientation) with a canvas stub; `submitSnagPhoto` (FormData shape incl. `clientUploadId`; status→classify mapping); offline-fallback state machine (`online`/network-error → queued; quota/queue full → `not_saved`); idempotent server handler (same `clientUploadId` twice → one attachment row, counter +1 once) via the existing snag API test harness.
- **Regression:** Phase-0 `complete_step` queue and the SW scope guard untouched — re-run their suites.
- **Browser (playwriter, per Phase-0 learnings):** drive offline via dispatched `offline`/`online` events (CDP `setOffline` is a no-op; `page.route` doesn't reach the SW). Capture a photo offline → assert it lands in `SnagPhotoDB:<token>.pending`; dispatch `online` → assert flush POSTs and the slot row + step completion appear in the DB, pending→0. Fill the byte budget → assert the emphatic `not_saved` copy, not a green check.
- **Real-device (impl-time):** verify IDB Blob storage + quota on a real mid-range Android + iOS Safari (R2).

---

## 7. Decisions — resolved in self-grill (2026-07-05)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Byte quota is mandatory**, added to the shared lib (not the consumer) | Photos break the count-only cap; Phase 2 inherits it |
| D2 | **Store `Blob`, not base64** | −33 % size vs base64 against scarce quota; native IDB + FormData |
| D3 | **Downscale at capture** (1600 px / q0.8) before enqueue | Bounds per-item size → stable quota math + fast 3G upload |
| D4 | **`clientUploadId` idempotency key** + guarded attachment INSERT (schema + handler) | Slot upsert is safe but the attachment ledger + counter are not; at-least-once retry makes duplicates likely |
| D5 | **No cross-queue ordering** | `complete_step` (non-photo steps) and photo upload (photo steps) are mutually exclusive — verified |
| D6 | **Page-context flush, not Background Sync** | Consistent with Phase 0; deliberate |

---

## 8. Decisions (✅ RESOLVED — Hein accepted the recommendations, 2026-07-05)

- **O1 — Surface:** ✅ **B (Snags photo).** §5.
- **O2 — Quota budget:** ✅ `maxQueueBytes = 40 MB`, `maxQueueSize` stays 50 (≈ 50 × ~500 KB downscaled, with headroom). Tunable at impl time if real-device testing warrants — treat 40 MB as the default, not a contract.
- **O3 — Idempotency migration:** ✅ **IN scope** (§3.5) — ship the `client_upload_id` migration + guarded handler together with the queue (PR-2 before PR-3), so the offline queue never lands ahead of its retry-safety.
- **O4 — Legacy single-photo steps:** ✅ **Cover both** — the `clientUploadId` fix is shared, so the non-slot path (`maintenance_verification_steps.photo_url`) gets the same idempotency guard.

---

## 9. Risks

| # | Risk | Mitigation |
|---|------|------------|
| R1 | Byte-quota heuristic still lets IDB throw `QuotaExceededError` under real pressure | Catch IDB quota errors in `enqueue` and surface the same emphatic `not_saved`; never a silent drop |
| R2 | iOS Safari IDB Blob quirks / PWA storage eviction | Real-device test (§6); base64 fallback documented (D2) |
| R3 | `clientUploadId` migration on the shared prod DB | Additive, idempotent, numbered runner path per [[feedback_dual_migration_trackers_drift]]; applied via runner only |
| R4 | Downscale on a low-end phone is slow / OOM on a huge image | Cap source dimension before draw; do it off the main paint where possible; test on a mid-range device |
| R5 | A photo that legitimately 400s (bad slot key) strands the tech | Drains to the dropped store (user-visible) with clear copy, per the lib's existing contract |

---

## 10. File-Level Change Map (Phase 1, Option B)

**Surface-agnostic (shared lib):**
- `src/lib/offline-queue/types.ts` — add `maxQueueBytes`, `sizeOf`, `QuotaExceededError`, `byteSize` on `QueuedItem`.
- `src/lib/offline-queue/store.ts` — byte-sum + budget check in `enqueue`.
- `src/lib/offline-queue/useOfflineQueue.ts` — thread `sizeOf`/`maxQueueBytes`; expose `quotaExceeded`/bytes in the result if the UI needs it.
- `src/lib/images/downscaleImage.ts` (new) + test.

**Snags consumer:**
- `src/modules/noc/snag-resolve/offline/photoQueue.ts` (new) — config + `PendingSnagPhoto`.
- `src/modules/noc/snag-resolve/offline/submitSnagPhoto.ts` (new) — FormData rebuild.
- `src/modules/noc/snag-resolve/offline/submitPhotoWithOfflineFallback.ts` (new) — pure state machine.
- `src/modules/noc/snag-resolve/useSnagResolve.ts` — call the fallback from `handlePhotoUpload`; surface queued/not_saved.
- `src/modules/noc/snag-resolve/VerificationStepList.tsx` / `PendingSyncIndicator.tsx` — queued-photo affordance + not_saved copy.

**Server + schema (idempotency):**
- `scripts/migrations/sql/NNN_maintenance_attachments_client_upload_id.sql` (+ rollback) — column + partial unique index.
- `pages/api/snags/shared/[token].ts` — accept `clientUploadId`; guarded attachment INSERT + counter.

---

## 11. Definition of Done (Phase 1)

1. Offline photo capture on the snag-resolve page: captured → downscaled → stored as a Blob in `SnagPhotoDB:<token>`; UI shows a queued count.
2. Reconnect flushes every queued photo; slot row + step completion + attachment appear exactly once (idempotent under a forced double-flush).
3. Byte budget enforced: over-budget capture yields an emphatic `not_saved`, never a green check.
4. Phase-0 `complete_step` queue + SW scope guard regressions green.
5. `npm run ci:quick` green; blind `/review` APPROVED; CI green on the self-hosted runner.
6. Browser-verified on dev via dispatched offline/online events; real-device blob/quota check recorded.
