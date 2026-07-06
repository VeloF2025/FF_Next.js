# Main App PWA — Phase 2 Implementation Plan (Offline Photo Capture on SiteCam)

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Spec:** `docs/superpowers/specs/2026-07-06-main-app-pwa-phase2-sitecam-offline-design.md`
**Status:** DRAFT for Hein's approval (2026-07-06). O-decisions landed: surface = **SiteCam** (both job types); **warm-start** only; **explicit "saved offline"** UX; **handler-side idempotency, no migration**.

**Goal:** Make an already-open SiteCam job survive signal loss — durable in-progress photos (Blob in IndexedDB), offline reload-restore, and deferred submit that auto-flushes on reconnect — reusing Phase-1's byte-quota + Blob discipline, leaving per-step VLM and the `/api/sitecam/upload` contract untouched.

**Architecture:** A new per-job keyed IndexedDB store (`SiteCamJobDB:<jobType>:<siteId>`) holds watermarked photo **Blobs** + a job-meta record (SiteInfo, `clientSubmissionId`, `submitState`). `watermarkPhoto` gains a Blob output. `useSiteCamCapture` upserts on capture, restores on mount, and flushes queued jobs page-context on reconnect (Blob→base64 at flush → unchanged upload contract). The one non-idempotent server op (`resetPriorQaCycleForResubmission`) is made once-per-`clientSubmissionId` via its own `submission_history` snapshot — no migration.

**Tech Stack:** Next.js Pages Router, TypeScript, IndexedDB (native + `fake-indexeddb` in tests), Vitest (jsdom), `pg` on the shared Supabase DB, `withMySession` auth, playwriter for browser verification.

## Global Constraints
- **TDD**: failing test first, then minimal implementation, every task. `superpowers:test-driven-development`.
- Worktree `FF_Next.js-pwa-phase2` off `origin/master` (already created at `31bef3721`; `node_modules` symlinked, `.env.local` copied). Every change via PR; never edit master/main tree. Branch per PR.
- **No schema migration** (spec D5). The only DB change is the body of `resetPriorQaCycleForResubmission` + its call site.
- Files < 300 lines, components < 200. No `console.log` (use `log` from `@/lib/logger`). 100 % types. `apiResponse` helpers for API returns.
- Reuse, don't re-implement: `QuotaExceededError`, `QueuedItem.byteSize`, byte-budget discipline from `src/lib/offline-queue/` (barrel exports `QuotaExceededError`, `QuotaExceededKind`). SiteCam uses a **keyed** store (mutable job doc), **not** the FIFO `OfflineQueueStore` (spec §3.1 / D8).
- **Preserve the clean/watermarked contract** in `watermarkPhoto`: the VLM must never receive the banner. Keep base64 for the online path; only the offline (IDB-restore + queued-flush) paths depend on the new Blob output.
- `npm run ci:quick` before every PR; blind `/review` (single sonnet; `review-team` if a diff crosses 500 lines across lib+consumer+server); CI green on the self-hosted runner; author cannot self-approve; reviewer diffs use three dots (`git diff origin/master...branch`).
- Vitest skips `tsc` — run `npx tsc --noEmit` on changed files separately. New `src/modules/sitecam/offline/` dir may need a vitest alias if imports fail. [[feedback_vitest_new_lib_alias]] [[feedback_vitest_skips_tsc]]
- After each dev deploy verify **dev HEAD == origin/master** (health 200 can mask a stale/parallel deploy — [[feedback_parallel_deploy_stale_commit_rollback]]).

---

## PR Decomposition (mirror Phase 1: lib → server → consumer)
- **PR-1 (sitecam offline lib):** Tasks 1–3 — `watermarkPhoto` Blob output + `photoStore` + `submitSiteCamJob`. Pure, no surface change. Safe to merge alone.
- **PR-2 (server guard):** Task 4 — `resetPriorQaCycleForResubmission` once-per-`clientSubmissionId` + `upload.ts` wiring. No migration. Merge before PR-3.
- **PR-3 (consumer + UI):** Tasks 5–9 — durability/restore/offline-submit/flush in `useSiteCamCapture` + wizard UI + verification.

---

## Task 1 — `watermarkPhoto`: add watermarked-Blob output
**Files:** modify `src/modules/sitecam/lib/watermarkPhoto.ts`; test `src/modules/sitecam/lib/__tests__/watermarkPhoto.test.ts`.
**Interfaces — Produces:** `CapturePhotos` gains `watermarkedBlob: Blob` (the same 1600 px / q0.85 JPEG as `watermarked`, encoded via `canvas.toBlob`). `clean` and `watermarked` (base64) unchanged.
- **Test first:** with a canvas stub returning a known blob — `prepareCapturePhotos` resolves `watermarkedBlob` as a `Blob` of `type==='image/jpeg'`; the **`clean` copy still has no banner** (assert the banner is drawn only after `clean` is captured — existing regression, keep it); canvas-unavailable fallback returns the original for `watermarked` and a base64→Blob of it for `watermarkedBlob` (never throws — a failed encode must not block a tech).
- **Implementation:** after `const watermarked = toRawJpeg(canvas, rawBase64);`, add a `canvasToJpegBlob(canvas)` helper (`new Promise<Blob>((res) => canvas.toBlob((b) => res(b ?? base64ToBlob(watermarked)), 'image/jpeg', 0.85))`); return it as `watermarkedBlob`. In the catch/fallback, derive the blob from the fallback base64. Add a small `base64ToBlob` (mirror `savePhotoToDevice.ts`'s private one — or export+reuse it; prefer reuse to stay DRY).
- **Acceptance:** util tests green; `clean`-cleanliness regression intact; `< 200` lines; `npx tsc --noEmit` clean on the file.

## Task 2 — `photoStore`: keyed IndexedDB job store + byte-quota
**Files:** create `src/modules/sitecam/offline/photoStore.ts`; test `src/modules/sitecam/offline/__tests__/photoStore.test.ts` (fake-indexeddb).
**Interfaces — Produces:**
- `sitecamJobDbName(jobType, siteId): string` → `` `SiteCamJobDB:${jobType}:${siteId}` ``.
- `interface StoredStepPhoto { stepNumber: number; photoBlob: Blob; byteSize: number; needsManualReview: boolean; capturedAt: string }`.
- `interface SiteCamJobMeta { siteInfo: SiteInfo; clientSubmissionId: string; submitState: 'capturing' | 'queued'; queuedAt?: string }`.
- `SITECAM_JOB_MAX_BYTES = 20 * 1024 * 1024` (tunable; one job ≈ 3.6–7.5 MB Blob).
- `class SiteCamPhotoStore` with: `constructor(jobType, siteId)`; `putStepPhoto(photo: StoredStepPhoto): Promise<void>` (upsert keyed by `stepNumber`; byte-quota guarded → throws `QuotaExceededError` from `@/lib/offline-queue`); `listStepPhotos(): Promise<StoredStepPhoto[]>`; `putMeta(meta) / getMeta(): Promise<SiteCamJobMeta | null>`; `clear(): Promise<void>`.
- **Test first (fake-indexeddb):** put two steps → list returns both; re-put same `stepNumber` → list still length 1 with the new blob (upsert, no orphan); putting a photo whose `byteSize` pushes `sum + incoming > SITECAM_JOB_MAX_BYTES` throws `QuotaExceededError` (kind `'queue'`); `navigator.storage.estimate` stubbed unavailable → put passes (byte-budget-only, never a hard block); `getMeta` before any `putMeta` → `null`; `putMeta` then `getMeta` round-trips `clientSubmissionId`/`submitState`; `clear` empties both stores.
- **Implementation:** two object stores in one DB — `photos` (keyPath `stepNumber`) and `meta` (fixed key `'job'`). Byte-sum via a cursor over `photos` (derive, never a second source of truth — mirror the lib's `store.ts`). Guard: `if (sum + byteSize > SITECAM_JOB_MAX_BYTES) throw new QuotaExceededError(sum, byteSize, SITECAM_JOB_MAX_BYTES, 'queue')`; then best-effort `navigator.storage.estimate()` → `'device'` kind if over the 0.8 fraction. Blobs stored natively (structured clone).
- **Acceptance:** store tests green; `< 300` lines; tsc clean.

## Task 3 — `submitSiteCamJob`: pure offline-submit state machine + flush payload
**Files:** create `src/modules/sitecam/offline/submitSiteCamJob.ts`; test `.../__tests__/submitSiteCamJob.test.ts`.
**Interfaces — Produces:**
- `blobToBase64(blob: Blob): Promise<string>` (raw base64, no `data:` prefix — mirror `readFileAsBase64`).
- `buildUploadPayload(meta: SiteCamJobMeta, photos: StoredStepPhoto[], geofence): Promise<UploadBody & { clientSubmissionId: string }>` — converts each Blob→base64, shapes the exact existing `/api/sitecam/upload` body (`jobType, siteId, photos:[{stepNumber, stepLabel, filename:'step-<n>.jpg', base64, needsManualReview}], geofence`) **plus** `clientSubmissionId`. `stepLabel` comes from the SiteInfo step list (or a passed label map).
- `type SubmitOutcome = 'submitted' | 'queued' | 'not_saved' | 'error'`.
- `classifySubmit(online: boolean, err: unknown): SubmitOutcome` — pure: `!online` OR network-error → `queued`; `QuotaExceededError`/`QueueFullError` → `not_saved`; a definitive 4xx (has `.status` 400–499) → `error`; else (5xx/unknown throw while online) → `queued` (retry). 2xx path handled by caller (`submitted`).
- **Test first:** `blobToBase64` round-trips known bytes; `buildUploadPayload` emits every field incl. `clientSubmissionId` and correct `filename`; `classifySubmit(false, …) → 'queued'`; network `TypeError` → `'queued'`; `QuotaExceededError` → `'not_saved'`; `{status:404}` → `'error'`; `{status:503}` while online → `'queued'`.
- **Acceptance:** state-machine + payload tests green; pure (no React, no direct `fetch` in the classifier); tsc clean.

## Task 4 — Server: once-per-`clientSubmissionId` reset (no migration)
**Files:** modify `src/modules/sitecam/services/resubmissionReset.ts`; modify `pages/api/sitecam/upload.ts`; tests `src/modules/sitecam/services/__tests__/resubmissionReset.test.ts` (+ existing `pages/api/sitecam/__tests__/` upload harness if present).
**Pre-work:** none new — live schema already verified (`dr_photo_unified_reviews`: no counter trigger; `submission_history` jsonb exists; no `client_submission_id` column — intentionally not adding one).
**Interfaces — Produces:**
- `resetPriorQaCycleForResubmission(dropNumber: string, clientSubmissionId?: string): Promise<void>` — (a) record `'client_submission_id', $2` inside the `jsonb_build_object` snapshot; (b) add to the `WHERE`: `AND COALESCE(submission_history -> -1 ->> 'client_submission_id', '') <> $2` so a replay of the same submission is a **strict, atomic no-op** (guard already self-clears its other flags; this closes the interleave edge too). When `clientSubmissionId` is undefined (legacy/online callers), pass `''` — the extra clause is then `<> ''`, i.e. behaves exactly as today.
- `upload.ts` reads `clientSubmissionId` from the body (optional string) and passes it to `resetPriorQaCycleForResubmission(drNum, clientSubmissionId)`. Everything else (VF-Storage upload, `pwa_photo_urls` UPDATE — already last-write-wins) unchanged.
- **Test first (unit, mocked `pool.query`):** calling `resetPriorQaCycleForResubmission('DR1', 'uuid-A')` issues an UPDATE whose params include `'uuid-A'` and whose SQL contains the `<> $2` guard + the snapshot `client_submission_id` key; legacy call (no id) passes `''`.
- **SQL dry-run (rolled back, real DB) — verification step, not committed:** on a scratch/throwaway `dr_photo_unified_reviews` row seeded with a prior cycle (`feedback_sent=true`), run `BEGIN; SELECT resetPriorQaCycle-equivalent UPDATE with id=X; SELECT submission_count; -- repeat same X; SELECT submission_count; ROLLBACK;` → `submission_count` bumps once, second call no-ops. Record the transcript in the PR. (Mirrors Phase-1's mig-438 proof.)
- **Acceptance:** service + handler tests green; existing sitecam upload/handler tests green; SQL dry-run transcript posted; tsc clean.

## Task 5 — Wire durability into `useSiteCamCapture` (upsert + restore)
**Files:** modify `src/modules/sitecam/hooks/useSiteCamCapture.ts`; tests `.../__tests__/useSiteCamCapture.test.ts` (extend).
**Interfaces — Consumes:** Tasks 1–2. **Produces:** on each successful `captureAndValidate`, after producing `watermarkedBlob`, `await store.putStepPhoto(...)` (catch `QuotaExceededError` → set a `photoNotSaved` state, mark the step not-captured, never green). On mount, if `initialDraft()` metadata exists but React photo state is empty (post-reload), **restore** step blobs from `SiteCamPhotoStore` (hydrate `photoBase64` via `blobToBase64` only where needed) and `submitState`. Mint `clientSubmissionId` into meta when the store is first created. Keep the localStorage draft for **metadata only** (statuses/positions/attempts) — its existing "lite (photos stripped)" branch is now the intended path.
- **Test first:** offline capture → `putStepPhoto` called with the blob + correct `stepNumber`; a `QuotaExceededError` from the store → `photoNotSaved` surfaced, step not marked pass; a simulated remount reads blobs back and rebuilds `stepStates` with the photo present; `clientSubmissionId` stable across captures. Per-step VLM fail-open path unchanged (regression).
- **Acceptance:** hook tests green; existing sitecam hook/draft tests green; component still mounts client-side only (no SSR hydration mismatch).

## Task 6 — Offline-aware `submitAll` + page-context flush
**Files:** modify `src/modules/sitecam/hooks/useSiteCamCapture.ts`; optional small `src/modules/sitecam/offline/useSiteCamFlush.ts`; tests extend.
**Interfaces — Consumes:** Tasks 2–3, 5. **Produces:** `submitAll` becomes offline-aware — build the payload from the store, POST `/api/sitecam/upload` with `clientSubmissionId`; on `!onLine`/network throw → `store.putMeta({submitState:'queued'})` and return `queued` (do **not** set `uploadResult`); on `2xx` → `store.clear()` + `clearDraft()` + `uploadResult` (existing success). A flush effect (online edge + mount + ~60 s poll + manual) checks for a `queued` job and retries the POST; on `2xx` clears + surfaces "Submitted ✓"; definitive 4xx → a visible "couldn't submit" state; 5xx/network → keep + retry. Reuse the online/poll trigger shape from `useOfflineQueue` (don't reinvent the cadence).
- **Test first:** offline `submitAll` → `submitState:'queued'`, no `uploadResult`, returns `queued`; online `submitAll` 2xx → store cleared, `uploadResult` set; a `queued` job + dispatched `online` → flush POSTs with `clientSubmissionId` and clears on 2xx; flush 503 → job kept; flush 404 → visible error, not silent. Geofence stamped at submit-tap (may be null offline).
- **Acceptance:** hook tests green; no idle re-render loop (stable deps — guard like Phase 1); tsc clean.

## Task 7 — UI: "Saved offline" + not-saved affordances + offline restore page
**Files:** modify `src/modules/sitecam/components/SiteCamWizard.tsx`, `StepCapture.tsx`, `SiteCamSuccess.tsx`; modify `pages/my/sitecam/[siteId].tsx`; component tests.
**Interfaces — Consumes:** Tasks 5–6. **Produces:** a distinct **"Saved offline — will submit when you're back online"** state on submit-while-offline (NOT the green `SiteCamSuccess`); an emphatic **"Photo not saved on this device — reconnect to free space"** banner on `photoNotSaved` (step stays un-captured, never green — [[feedback_verify_before_confirm]]); a small "will sync N photos" indicator. `[siteId].tsx`: when `getSession` resolves (session runtime-cached by sw-my) but the `/api/sitecam/site/:id` fetch fails **and** an IDB job exists for the route params, render the wizard from the **restored** `SiteInfo` (warm-start reload path) instead of the error state.
- **Test first:** wizard renders the "saved offline" state for a `queued` result (asserts it is NOT the success screen); renders the not-saved banner as a failure (not a check); renders nothing offline-specific when idle/online-success; `[siteId]` page renders the wizard from a restored job when the site fetch fails but IDB has the job.
- **Acceptance:** component tests green; each component `< 200` lines (extract if needed); tsc clean.

## Task 8 — Regression gate + browser verification (dev)
- Re-run all sitecam suites (`src/modules/sitecam/**`, `pages/api/sitecam/**`) + confirm per-step VLM fail-open unchanged + Phase-0/1 queues untouched; `npm run ci:quick` green.
- Deploy PR-3 branch's merge to **dev** (`bash scripts/deploy-local.sh dev`); verify **dev HEAD == origin/master** (not just health 200).
- **Browser (playwriter on dev, dispatched `offline`/`online`):** on a **throwaway/test site id** (never a real in-progress DR) — open the wizard online → dispatch `offline` → capture a step → assert a watermarked **Blob** with `byteSize` lands in `SiteCamJobDB:<jobType>:<siteId>.photos` → **reload** offline → assert the wizard restores the photo + step (no `/api/sitecam/site` call succeeds) → complete + Submit → assert the "Saved offline" state (NOT green) + `meta.submitState==='queued'` → dispatch `online` → assert the flush POSTs `clientSubmissionId` and the store clears. **Zero pollution:** no real DR write; delete test IDBs after.
- **Real-device (manual — flag Hein):** IDB Blob + quota on a mid-range Android + iOS Safari (R2). Record result.

---

## Self-Review (author checklist)
- **Spec coverage:** §3.1→T2; §3.2→T1; §3.3→T5; §3.4→T3+T6; §3.5→T4; §5 UI→T7; §6 verification→T8. Non-goals honoured (no `sw-my.js` change, no migration, no VLM change, no offline appeals).
- **Type consistency:** `watermarkedBlob` (T1) consumed by `putStepPhoto` (T2) + capture (T5); `StoredStepPhoto`/`SiteCamJobMeta`/`clientSubmissionId` defined in T2, consumed T3/T5/T6; `buildUploadPayload` output matches `upload.ts`'s `UploadBody` + `clientSubmissionId` (T4); `resetPriorQaCycleForResubmission(dropNumber, clientSubmissionId?)` signature consistent T4↔caller.
- **Placeholder scan:** idempotency mechanism pinned (submission_history snapshot + `-> -1 ->> 'client_submission_id'` guard) — no TBD.
- **Gated:** all tasks assume Hein's approval of this plan + the spec. PR-1 (lib) can start the moment approved.
