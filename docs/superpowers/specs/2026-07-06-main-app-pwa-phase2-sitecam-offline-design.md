# Main App PWA — Phase 2: Offline Photo Capture on SiteCam (Activations + Civils)

**Status:** DRAFT for Hein's review (2026-07-06). Produced via brainstorming → grill-me → spec (Opus), continuing the main-app PWA program.
**Author:** Claude (Opus), 2026-07-06.
**Predecessor:** Phase 1 (offline SNAG photo) — PRs #2124 (lib byte-quota + `downscaleImage`), #2125 (server `client_upload_id` idempotency), #2126 (consumer+UI), #2127 (attachments_count double-count fix). Shipped to dev (`9fc0b03e0`); not promoted to prod. Spec: `docs/superpowers/specs/2026-07-05-main-app-pwa-phase1-design.md`.

---

## 0. Surface decision (RESOLVED with Hein, 2026-07-06)

The Phase-1 spec deferred "Activations/DR offline capture" to Phase 2 (§2 non-goals, §5). Investigation of the actual code found that **"Activations/DR" contains two different surfaces, and only one is a photo-_capture_ surface:**

| | `/activate` **QA Centre** (5-phase wizard) | **SiteCam** (`/my/sitecam/[siteId]`) |
|---|---|---|
| What it is | Desk **review** — reviewers approve VLM-categorised photos that arrived via WhatsApp/1Map/BOSS | Field **capture** — technician's 12-step activation / 8-step civil photo wizard |
| Photo capture? | **No** (only Excel/text imports; reviewers reassign steps + decide PASS/FAIL) | **Yes** (`<input capture>` → watermark → base64 → VF Storage) |
| Offline value | ~none (desk, connected) | High (techs lose signal inside buildings mid-job) |

The goal named the QA Centre by vocabulary ("5-phase QA wizard") but "offline **photo capture**" only maps to **SiteCam**. **Hein confirmed: Phase 2 = SiteCam field wizard, both job types (activations + civils).**

Consequently, several Phase-1 "inherit unchanged" assumptions do **not** hold for SiteCam and are re-scoped here (§6 Decisions). What genuinely transfers: the byte-aware quota lib + the Blob storage discipline from `src/lib/offline-queue/` and `src/lib/images/`.

---

## 1. Problem & Goal

SiteCam is the field technician's structured photo-capture wizard (adopted in-app 2026-06-02, PR #1886). For each install the tech walks a fixed checklist — **12 steps for activations, 8 for civils** — capturing one photo per step. Each photo is watermarked (site-id + timestamp burned into the pixels), downscaled to 1600 px, and VLM-validated per step; when all steps pass/escalate, `submitAll` POSTs every photo to `/api/sitecam/upload`, which uploads to VF Storage and writes a JSONB URL map onto the DR/pole record.

**The field reality:** activations happen in new-build areas and *inside* customer premises, where signal routinely drops **mid-job**. Today that produces two failures:

1. **Lost work on reload.** Captured photos live in React state and are mirrored to a `localStorage` draft — but that draft is ~5 MB-budgeted and a 12-step job is 5–10 MB of base64, so `saveDraft` **degrades to progress-only, stripping the photos** (`sitecamDraft.ts`). A PWA reload / service-worker update / tab crash mid-job therefore dumps the tech back with their step positions but **no photos** → re-capture.
2. **Blocked submit.** `submitAll` requires connectivity. Offline, it throws and sets `uploadError`; the tech cannot complete the job and is stranded holding an hour of work.

**Goal:** make an *already-open* SiteCam job resilient to signal loss — capture never blocks, in-progress photos survive a reload, and completion is deferred-and-guaranteed (queued offline, auto-flushed on reconnect) — by reusing Phase 1's byte-aware IndexedDB Blob queue and leaving the per-step VLM gate and the server upload contract untouched.

### Program shape (recap)
- **Phase 0** ✅ installable shell + offline read + reusable offline-write queue `src/lib/offline-queue/`.
- **Phase 1** ✅ offline photo capture on the Snags snag-resolve page (proved the Blob + quota + idempotency mechanic).
- **Phase 2** ← *this doc* — offline photo capture on the SiteCam field wizard.

---

## 2. Goals & Non-Goals

### Goals (Phase 2)
1. **Durable in-progress photos.** Persist each captured (watermarked) photo as a **Blob** in IndexedDB as it is taken, so a mid-job reload restores the wizard — photos included — **offline**, without a re-fetch.
2. **Offline-restorable wizard state.** Persist enough to rebuild the wizard offline: `SiteInfo` (jobType, siteId, step list determinant, planned coords) + per-step status/attempt metadata + the photo Blobs. (Metadata may remain in `localStorage`; photos move to IDB.)
3. **Deferred submit.** When the tech completes all steps offline (or `submitAll` hits a network error), queue the completed submission durably and **auto-flush on reconnect** (page-context: online edge + poll + mount + manual), reusing the Phase-1 flush pattern.
4. **Byte-aware quota.** Guard IDB writes with the Phase-1 `QuotaExceededError` / byte-budget so an over-budget job yields an emphatic **"not saved"**, never a silent drop.
5. **Idempotent flush (handler-side, no migration).** A queued submission carries a `clientSubmissionId`; a lost-ack retry must not double-run `resetPriorQaCycleForResubmission` (the only non-idempotent op). `pwa_photo_urls` is already last-write-wins.
6. **Explicit offline-submit UX.** A distinct "Saved offline — will submit when you're back online" state; a real "Submitted ✓" only after the queued job actually flushes. Never show success for a merely-queued job.
7. Cover **both** job types (activations → `dr_photo_unified_reviews`; civils → `pole_install_sessions`).

### Non-Goals (explicitly deferred — YAGNI)
- **Cold-start offline.** Opening the app / a specific job with *zero prior connectivity* is out of scope. It requires precaching `/my/sitecam` + its `/_next` chunks + `SiteInfo` into the **shared `sw-my.js`** (which controls the entire `/my` portal). Phase 2 makes **zero `sw-my.js` changes** and supports **warm-start** only: open the job online, then capture/submit offline. (Documented boundary; revisit only if techs routinely start jobs in dead zones.)
- **Any change to the per-step VLM gate.** `/api/sitecam/validate` already **fail-opens** on network error (`status:'pass', needsManualReview:true`) — offline capture already flows through it. VLM is never run offline; server-side VLM is not introduced (SiteCam has no server-side VLM on upload — see §3.5).
- **A schema migration.** No new DB column (§6 D5).
- **Offline appeals.** The 3-strike appeal flow (submit + supervisor poll) is inherently an online supervisor-in-the-loop interaction. Offline, a tech simply cannot appeal until reconnected; escalation still records locally and uploads at flush.
- **Offline capture of video / non-image blobs; multi-photo-per-step beyond today; Background Sync API.**
- **Serial cross-reference offline.** Barcode *scanning* is client-side (works offline); the async server cross-ref runs post-submit as today.

---

## 3. Architecture

Reuse the Phase-1 **surface-agnostic** primitives (`src/lib/offline-queue/` byte-quota + `QuotaExceededError`; Blob-in-IDB discipline). The **new** work is a SiteCam-specific offline store + wizard wiring + a small handler guard. Five units, smallest-blast-radius first.

### 3.1 SiteCam offline photo store (`src/modules/sitecam/offline/photoStore.ts` — new)
An IndexedDB store, per job, holding the in-progress capture durably.

- **DB name:** `SiteCamJobDB:<jobType>:<siteId>` (namespaced by job type + site, mirroring the existing draft key `sitecam:draft:v1:<jobType>:<siteId>` so activations vs civils of the same site cannot collide).
- **Record shape (one per captured step):** `{ siteId, jobType, stepNumber, photoBlob: Blob, byteSize, needsManualReview, capturedAt }`. Keyed by `stepNumber` (a re-capture **upserts** the same key — natural overwrite, no orphan blobs).
- **A single job-meta record:** `{ siteInfo, clientSubmissionId, submitState: 'capturing' | 'queued', queuedAt? }`. `clientSubmissionId` is a UUID minted once when the job's IDB store is first created; it is the idempotency key for the eventual flush.
- **Byte-quota guard on write:** reuse `src/lib/offline-queue` byte-budget math — sum stored photo `byteSize` + incoming vs `maxJobBytes` (default ~20 MB, tunable; one job ≈ 3.6–7.5 MB of Blobs, generous headroom) and consult `navigator.storage.estimate()` (best-effort). Over-budget throws `QuotaExceededError` → the wizard renders an emphatic "photo not saved on device" (never a green step). `navigator.storage.estimate` unavailable → byte-budget-only (never a hard block that strands a legitimate photo).

**Why a keyed store, not the Phase-1 FIFO `OfflineQueueStore`:** SiteCam's in-progress capture is a **mutable job document** (steps upserted, re-captured, then batch-submitted), not an append-only FIFO of independent items. The keyed store fits that access pattern and handles re-capture cleanly, while reusing the lib's **byte-quota + Blob** building blocks. The FIFO queue's flush *pattern* (online-edge + poll, page-context) is reused in §3.4.

### 3.2 Blob capture pipeline (`src/modules/sitecam/lib/watermarkPhoto.ts` — extend)
`prepareCapturePhotos` today returns `{ clean, watermarked }` as **base64** (downscale 1600 px → `canvas.toDataURL('image/jpeg', 0.85)`). Extend it to also yield the **watermarked** copy as a **`Blob`** (`canvas.toBlob(..., 'image/jpeg', 0.85)`) for durable storage. The **clean** copy stays base64 (it is consumed synchronously by the per-step VLM call and never stored). The base64 watermarked copy is retained for the in-session React state + the online-submit path (see §3.4 D-format). Pure; unit-tested with a canvas stub; the existing clean/watermarked contract is preserved (VLM never sees the banner).

*(Note: SiteCam already downscales to 1600 px in `watermarkPhoto`, so Phase-1's `downscaleImage` is not re-invoked here — the reusable transfer is the Blob-encoding + byte-sizing discipline, not the function.)*

### 3.3 Wizard durability wiring (`src/modules/sitecam/hooks/useSiteCamCapture.ts` — extend)
- On each successful capture (`captureAndValidate`), after producing the watermarked Blob, **upsert it into the §3.1 store** (byte-quota guarded). This is what survives a reload.
- On mount, if no live React state, **restore from IDB**: read the job-meta (`siteInfo`, `submitState`) + all step blobs, rebuild `stepStates` (hydrating `photoBase64` from the Blob only where the in-session path still needs base64; see D-format), and resume at the right step. This makes an **offline reload** fully restorable without hitting `/api/sitecam/site/:id`.
- Keep the existing `localStorage` draft for **step metadata only** (statuses, positions, attempt counts, `appealedIndex`) — small, already proven, and its "lite draft strips photos" fallback becomes the *intended* design (photos now live in IDB, not localStorage).
- On confirmed flush success, **clear** the IDB store + the localStorage draft (mirrors the existing `clearDraft` on `uploadResult`).

### 3.4 Offline-aware submit + flush (`src/modules/sitecam/offline/submitSiteCamJob.ts` + hook wiring — new/extend)
Mirror the Phase-1 / attendance state machine, pure and outside React where possible:

- **`submitAll` becomes offline-aware:** if `!navigator.onLine` OR the POST throws a network error → mark the job `submitState:'queued'` in IDB and return a **`queued`** result (UI: "Saved offline — will submit when online"). A `2xx` → `submitted` (clear stores). A `QuotaExceededError` earlier at capture already surfaced `not_saved`.
- **Flush loop (page-context):** a `useOfflineQueue`-style effect (online edge + mount + ~60 s poll + manual) scans for `submitState:'queued'` jobs, rebuilds the exact `/api/sitecam/upload` payload (`jobType, siteId, photos[{stepNumber, stepLabel, filename, base64, needsManualReview}], geofence`, **plus** `clientSubmissionId`), POSTs, and on `2xx` clears the store; on 5xx/network keeps + retries; on a definitive 4xx drops to a user-visible "couldn't submit" state (never a silent loss). Geofence `submitLat/Lon` are stamped at *submit-tap* time (may be null if offline — acceptable, matches today's null-tolerant columns).

**D-format (Blob at rest, base64 on the wire):** photos are stored as **Blobs** in IDB (−33 % vs base64, honoring the program's Blob decision). At flush, each Blob is converted to base64 (`FileReader`/`blob.arrayBuffer` → base64) to satisfy the **unchanged** `/api/sitecam/upload` JSON+base64 contract. The in-session (online) submit path may continue to use the base64 already in React state; only the *restored-from-IDB* and *queued-flush* paths convert Blob→base64. This keeps `upload.ts` and VF-Storage upload byte-for-byte unchanged.

### 3.5 Idempotent flush — handler guard (`pages/api/sitecam/upload.ts` — extend, NO migration)
Verified against the live handler + schema:
- `pwa_photo_urls` write is a **last-write-wins** UPDATE keyed on `drop_number`/`pole_number` → **idempotent** on retry (same URLs overwrite).
- `dr_photo_unified_reviews` has **no counter trigger** (live `\d`: only `updated_at` + `set_auto_qa_eligible_at` BEFORE triggers); `pole_install_sessions` has **zero triggers**. So there is **no double-count class** (unlike Phase 1).
- The **only** non-idempotent op is `resetPriorQaCycleForResubmission(drNum)` (bumps `submission_count`, archives a cycle). It is **already self-idempotent under a fast lost-ack retry** because its body clears the exact flags (`feedback_sent`/`qa_decision IS NOT NULL`/`auto_qa_processed`) that its own `WHERE` guard tests → the retry no-ops. Residual risk: a full QA cycle (auto-QA cron) interleaving *between* the first flush and its retry re-arms the guard → one spurious `submission_count++` (cosmetic; no data loss, no dup photo). Civils never call the reset.

**Guard (handler-side, no schema change):** `upload.ts` accepts an optional `clientSubmissionId`. Before running `resetPriorQaCycleForResubmission`, treat the reset as a **once-per-submission** action: skip it when this exact submission has already been recorded on the row this cycle. Concretely, gate the reset so a replay is a no-op — e.g. record the `clientSubmissionId` in the existing `submission_history` snapshot and skip the reset when the most recent snapshot already carries it, **or** short-circuit when `pwa_submission_at` is very recent AND the incoming `clientSubmissionId` matches a value echoed back on the row. (Exact mechanism finalised in the plan; the invariant: **the reset runs at most once per `clientSubmissionId`.**) No new column; the guarantee is provable via a rolled-back dry-run against the real function (§5).

### 3.6 What is NOT touched (verified, de-risked)
- **`sw-my.js`** — no changes (warm-start; §2 non-goal). The `/my` portal shell, attendance queue, and SW update-prompt are untouched.
- **`/api/sitecam/validate`** — unchanged; already fail-opens offline.
- **VF-Storage upload + `upload.ts` request/response contract** — unchanged (Blob→base64 at flush).
- **Appeals / escalate endpoints** — escalate remains best-effort (its offline failure is already logged non-fatal; the escalated photo still uploads at flush because `submitAll` includes `status:'escalated'` photos).

---

## 4. Data Flow

**Offline capture (per step):**
`<input capture>` → `File` (5–12 MB) → `prepareCapturePhotos` → `{clean(base64), watermarked(base64+Blob)}` → per-step VLM POST (`/api/sitecam/validate`; **offline → fail-open pass + needsManualReview**) → **upsert watermarked Blob into `SiteCamJobDB:<jobType>:<siteId>`** (byte-quota guarded) → step advances. Reload mid-job → **restore from IDB** (SiteInfo + blobs) → resume, still offline.

**Completion offline:**
all steps pass/escalate → tap Submit → `!onLine` → job marked `submitState:'queued'` in IDB → UI: **"Saved offline — will submit when online."**

**Reconnect flush (page-context):**
`online` edge / mount / ~60 s poll → find `queued` job → convert step Blobs → base64 → POST `/api/sitecam/upload` (with `clientSubmissionId`) → `2xx` → clear IDB + draft, show **"Submitted ✓"**; 5xx/network → keep + retry; definitive 4xx → user-visible "couldn't submit". Server: uploads to VF Storage, writes `pwa_photo_urls` (idempotent), runs `resetPriorQaCycleForResubmission` **at most once per `clientSubmissionId`**.

---

## 5. Testing & Verification

- **Unit (Vitest, jsdom + fake-indexeddb):**
  - `photoStore`: upsert/read/clear; byte-quota under/at/over budget; `storage.estimate` unavailable → pass; re-capture overwrites same `stepNumber` (no orphan); job-meta `clientSubmissionId` stable across upserts.
  - `watermarkPhoto`: Blob output is `image/jpeg`, long-edge ≤ 1600, **clean copy has no banner** (regression-guard the VLM-cleanliness invariant), quality respected; canvas-unavailable fallback.
  - `submitSiteCamJob` state machine: offline/network-error → `queued`; `2xx` → `submitted`; quota → `not_saved`; definitive 4xx → dropped/visible.
  - Blob→base64 conversion at flush round-trips the bytes.
  - Handler idempotency: same `clientSubmissionId` twice → `resetPriorQaCycleForResubmission` effects applied **once** (`submission_count` +1 once), `pwa_photo_urls` set once; missing `clientSubmissionId` (legacy/online) still works.
- **Regression:** existing sitecam suites (89+ tests — draft, geofence, steps, serial, appeals) green; per-step VLM fail-open unchanged; Phase-0/1 queues untouched.
- **SQL dry-run (rolled back):** against the **real** `resetPriorQaCycleForResubmission` on the shared DB — forced double-flush with the same `clientSubmissionId` → `submission_count` unchanged on the second call; nothing persisted (`ROLLBACK`). Mirrors the Phase-1 proof method.
- **Browser (playwriter on dev, dispatched `offline`/`online` — CDP `setOffline` is a no-op for the SW):** open a throwaway job online → dispatch `offline` → capture a step → assert the watermarked **Blob** lands in `SiteCamJobDB:<jobType>:<siteId>` (isBlob, byteSize) → **reload** offline → assert the wizard restores the photo + step position (no `/api/sitecam/site` call) → complete + Submit offline → assert "Saved offline" (not green) + `submitState:'queued'` → dispatch `online` → assert flush POSTs and the store clears. **Do not pollute a real in-progress DR** — verify the client mechanic without a real server write, or use a throwaway/test site id.
- **Real-device (impl-time, manual — flag Hein):** IDB Blob storage + quota on a mid-range Android + iOS Safari (R2; old iOS Safari has historically mishandled IDB Blobs — base64-at-rest fallback documented if needed).

---

## 6. Decisions (resolved in brainstorming + grill-me, 2026-07-06)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Surface = SiteCam** (both activations + civils) | The only in-app field photo-*capture* for activations/DR; QA Centre is desk review (Hein confirmed) |
| D2 | **Warm-start only**; cold-start = non-goal | Field reality is signal-loss *mid-job*; cold-start needs risky shared-`sw-my.js` precache. Zero SW changes |
| D3 | **Store watermarked photo as Blob** in IDB; base64 only at flush | −33 % at rest; `upload.ts` base64 contract untouched |
| D4 | **Durable photos + SiteInfo in IDB**; step metadata stays in localStorage | Closes the "reload drops photos" gap; minimal change to the proven draft/restore code |
| D5 | **Handler-side idempotency guard, NO migration** | No attachments table / counter trigger; reset already self-idempotent under fast retry; residual is cosmetic — a `clientSubmissionId` handler guard is provable without a shared-DB schema change |
| D6 | **Explicit "Saved offline" UX**, never green until flushed | Safety: a tech must not leave site believing a merely-queued job is final |
| D7 | **Per-step VLM untouched** (already fail-opens offline) | Offline photos flow through the existing `needsManualReview` fail-open path |
| D8 | **Keyed job store, not Phase-1 FIFO queue** | SiteCam capture is a mutable job document (upsert/re-capture/batch-submit), reusing the lib's byte-quota + Blob primitives + flush pattern |

---

## 7. Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | IDB `QuotaExceededError` under real pressure despite the byte heuristic | Catch IDB quota errors in the store → same emphatic `not_saved`; never a silent drop |
| R2 | iOS Safari IDB-Blob quirks / PWA storage eviction | Real-device test (§5); base64-at-rest fallback documented (D3) |
| R3 | Watermark→Blob change destabilises the **live** capture pipeline | Pure lib change, unit-tested; preserve the clean/watermarked contract exactly; keep base64 for the online path so only the offline path depends on the new Blob output |
| R4 | Offline reload can't fetch `/_next` chunks / `SiteInfo` → wizard won't restore | Warm-start scope; persist `SiteInfo` in IDB so restore needs no `/api/sitecam/site`; the page bundle is browser/runtime-cached from the online open. Documented boundary (cold-start = non-goal) |
| R5 | Rare QA-cycle interleave on retry → spurious `submission_count++` | Handler guard makes reset once-per-`clientSubmissionId`; residual is cosmetic; proven by rolled-back dry-run |
| R6 | A queued job legitimately 4xxs on flush (e.g. DR not found) and strands the tech | Definitive 4xx drains to a user-visible "couldn't submit" state (never silent), mirroring the lib's dropped-store contract |

---

## 8. File-Level Change Map (Phase 2)

**Reused unchanged (Phase-1 shared lib):** `src/lib/offline-queue/` byte-quota + `QuotaExceededError`; Blob-in-IDB discipline.

**SiteCam lib + offline (new/extend):**
- `src/modules/sitecam/lib/watermarkPhoto.ts` — add Blob output for the watermarked copy (+ tests).
- `src/modules/sitecam/offline/photoStore.ts` (new) — keyed IDB job store + byte-quota guard (+ tests).
- `src/modules/sitecam/offline/submitSiteCamJob.ts` (new) — pure offline-submit state machine + Blob→base64 flush payload builder (+ tests).

**Wizard wiring:**
- `src/modules/sitecam/hooks/useSiteCamCapture.ts` — upsert Blob on capture; restore from IDB on mount; offline-aware `submitAll`; page-context flush; clear stores on success.
- `src/modules/sitecam/components/SiteCamWizard.tsx` / `StepCapture.tsx` / `SiteCamSuccess.tsx` — "Saved offline / will submit when online" + `not_saved` affordances (never green for queued). Keep components < 200 lines.
- `pages/my/sitecam/[siteId].tsx` — allow the wizard to render from an IDB-restored job when the `SiteInfo` fetch is offline (warm-start restore path).

**Server (no migration):**
- `pages/api/sitecam/upload.ts` — accept `clientSubmissionId`; run `resetPriorQaCycleForResubmission` at most once per submission (+ handler tests).

---

## 9. PR Decomposition (mirror Phase 1: lib → server → consumer)

Three reviewable PRs, each independently green + shippable + deployed to dev:
- **PR-1 (sitecam offline lib):** `watermarkPhoto` Blob output + `photoStore` + `submitSiteCamJob` state machine + Blob↔base64. Pure, no wiring, no surface change. TDD.
- **PR-2 (server guard):** `upload.ts` `clientSubmissionId` once-per-submission idempotency guard. No migration. TDD + rolled-back SQL dry-run. (Small — could fold into PR-3 if review prefers, but kept separate for a clean idempotency review.)
- **PR-3 (wizard consumer + UI + verification):** wire durability/restore/offline-submit/flush into `useSiteCamCapture` + wizard UI; playwriter offline verification on dev.

Each: `npm run ci:quick` green; blind `/review` (single sonnet; `review-team` if a diff crosses 500 lines across lib+consumer+server) APPROVED; CI green on the self-hosted runner; author cannot self-approve; three-dot reviewer diffs. Fresh worktree off `origin/master` (fetch first; symlink `node_modules`, copy `.env.local`); after each dev deploy verify **dev HEAD == origin/master** (health 200 can mask a stale/parallel deploy).

---

## 10. Definition of Done (Phase 2)

1. Offline capture on the SiteCam wizard: each watermarked photo stored as a Blob in `SiteCamJobDB:<jobType>:<siteId>` (byte-quota guarded), for both activations and civils.
2. A mid-job **reload offline** restores the wizard — photos + step position + SiteInfo — with no network fetch.
3. Completing all steps offline queues the submission; UI shows an explicit "Saved offline" state (never green); reconnect **auto-flushes** and shows "Submitted ✓".
4. Flush is idempotent: a forced double-flush with the same `clientSubmissionId` runs `resetPriorQaCycleForResubmission` at most once (SQL-proven, rolled back) and writes `pwa_photo_urls` once.
5. Over-budget capture yields an emphatic `not_saved`, never a green step.
6. Per-step VLM fail-open + existing sitecam suites regress green; `sw-my.js` untouched.
7. `npm run ci:quick` green; blind `/review` APPROVED; CI green on the self-hosted runner; browser-verified on dev via dispatched offline/online; real-device Blob/quota check recorded (R2).
