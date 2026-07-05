# Main App PWA — Phase 1 Implementation Plan (Offline Photo Capture)

**Spec:** `docs/superpowers/specs/2026-07-05-main-app-pwa-phase1-design.md`
**Status:** ✅ APPROVED (Hein, 2026-07-05) — O1 = **Snags photo**; O2 budget 40 MB (tunable); O3 idempotency migration IN scope; O4 cover both photo paths. Implementation deferred to a fresh session by Hein's request. Start with **PR-1 (Tasks 1–4, pure lib)** off a fresh worktree from `origin/master`.

---

## Global Constraints
- TDD: write the failing test first, then the implementation, every task. `superpowers:test-driven-development`.
- Worktree off `origin/master` (fetch first); every change via PR; never edit master/main tree. Symlink `node_modules`, copy `.env.local`.
- `npm run ci:quick` before every PR; blind `/review` (single sonnet — or `review-team` if the diff crosses 500 lines across lib+consumer+server); CI green on the self-hosted runner; author cannot self-approve.
- Files < 300 lines, components < 200. No `console.log` (use `@/lib/logger`). 100 % types.
- Migrations: numbered `scripts/migrations/sql/NNN_*.sql` **only** (the runner-tracked path) + matching `rollback_NNN_*.sql`; version = current MAX + 1; verify live schema with `\d maintenance_attachments` before writing. [[feedback_dual_migration_trackers_drift]] [[feedback_migration_version_collision]]
- Vitest skips `tsc` — run type-check separately. New lib dirs may need a vitest alias. [[feedback_vitest_new_lib_alias]] [[feedback_vitest_skips_tsc]]

## Suggested PR decomposition
Three reviewable PRs, in order (each independently green + shippable):
- **PR-1 (lib):** Tasks 1–4 — byte-quota + `downscaleImage`. Pure, no surface change. Safe to merge alone.
- **PR-2 (server):** Tasks 5–6 — `client_upload_id` migration + guarded handler. Idempotency for online too; merge before PR-3.
- **PR-3 (consumer):** Tasks 7–11 — Snags offline photo path + UI + verification.

---

## Task 1 — Lib: byte-quota types
- **Produces:** `maxQueueBytes?`, `sizeOf?` on `OfflineQueueConfig`; `byteSize: number` on `QueuedItem`; `QuotaExceededError` class — in `src/lib/offline-queue/types.ts`.
- **Test first** (`types.test.ts` additions): `QuotaExceededError` message includes current/add/budget; is `instanceof Error` with `name==='QuotaExceededError'`.
- **Acceptance:** type-check green; existing type tests unchanged.

## Task 2 — Lib: store byte-budget enforcement
- **Consumes:** Task 1. **Produces:** byte accounting in `OfflineQueueStore.enqueue` (`src/lib/offline-queue/store.ts`).
- **Test first** (`store.test.ts`, fake-indexeddb): enqueue under budget passes; at/over budget throws `QuotaExceededError`; count cap still trips independently; `byteSize` persisted on the row; running sum derived by cursor (no drift after a delete). Stub `navigator.storage.estimate` → over-fraction throws; `undefined` (unavailable) → byte-budget-only, never a hard block.
- **Implementation:** sum `byteSize` over `pending` (cursor) + incoming vs `maxQueueBytes`; then best-effort `storage.estimate()`. Keep the existing count check.
- **Acceptance:** new + existing store tests green.

## Task 3 — Lib: thread quota through `useOfflineQueue`
- **Consumes:** Tasks 1–2. **Produces:** `sizeOf`/`maxQueueBytes` passed to the store; optional `quotaExceeded`/bytes in `UseOfflineQueueResult` if the UI reads it. (`src/lib/offline-queue/useOfflineQueue.ts`)
- **Test first** (`useOfflineQueue.test.ts`): enqueue over byte budget rejects and does not increment `pendingCount`; stable-identity deps preserved (no idle re-render loop — guard the existing regression).
- **Acceptance:** hook tests green; no new render-loop.

## Task 4 — `downscaleImage` util
- **Produces:** `src/lib/images/downscaleImage.ts` + `__tests__/downscaleImage.test.ts`.
- **Test first:** a synthetic large canvas/`ImageBitmap` stub → output long-edge ≤ 1600; output is a JPEG `Blob`; EXIF-orientation input drawn upright; quality param respected (smaller blob at lower q). Guard the environment-unavailable path (no `document`/canvas → reject clearly, not silently).
- **Acceptance:** util tests green; pure, < 120 lines.

## Task 5 — Migration: `maintenance_attachments.client_upload_id`
- **Pre-work:** `\d maintenance_attachments` on the live shared DB (via velo, read-only) to confirm columns + current MAX(version). [[feedback_query_schema_before_migration]]
- **Produces:** `scripts/migrations/sql/NNN_maintenance_attachments_client_upload_id.sql` — `ADD COLUMN IF NOT EXISTS client_upload_id uuid;` + `CREATE UNIQUE INDEX IF NOT EXISTS … ON maintenance_attachments (client_upload_id) WHERE client_upload_id IS NOT NULL;` (partial unique for nullable — [[postgresql-gotchas]] §27) + the standard `INSERT INTO migrations`. Matching `rollback_NNN_*.sql`.
- **Test/verify:** dry-run through the runner on a scratch DB / verification harness before the shared DB; additive + idempotent.
- **Acceptance:** runner reports applied; `\d` shows the column + index.

## Task 6 — Server: idempotent `upload_photo`
- **Consumes:** Task 5. **Produces:** `pages/api/snags/shared/[token].ts` — read `clientUploadId` from the multipart body; attachment INSERT `ON CONFLICT (client_upload_id) DO NOTHING RETURNING id`; bump `attachments_count` **only** when a row was inserted. Slot upsert + step auto-complete unchanged.
- **Test first** (snag API harness, e.g. `pages/api/snags/__tests__/`): same `clientUploadId` twice → one `maintenance_attachments` row, `attachments_count` +1 once, slot `photo_url` set once; missing `clientUploadId` (legacy/online) still works (nullable path). Actor/slot-key guards unchanged.
- **Acceptance:** handler tests green; existing shared-token tests green.

## Task 7 — Snags photo queue + submit
- **Consumes:** Tasks 1–4. **Produces:** `src/modules/noc/snag-resolve/offline/photoQueue.ts` (`PendingSnagPhoto`, config with `queueName: 'SnagPhotoDB:<token>'`, `maxQueueBytes`, `sizeOf = p => p.byteSize`) and `offline/submitSnagPhoto.ts` (rebuild `FormData(action=upload_photo, file, stepId, slotKey?, actorId, clientUploadId)` → POST; throw with `.status`).
- **Test first:** `submitSnagPhoto` builds the exact FormData (assert every field incl. `clientUploadId`); 2xx resolves; 400/409 throws with `.status` → drains; 5xx/network throws → keeps (via `defaultClassify`).
- **Acceptance:** consumer unit tests green.

## Task 8 — Offline-fallback state machine
- **Consumes:** Tasks 4, 7. **Produces:** `src/modules/noc/snag-resolve/offline/submitPhotoWithOfflineFallback.ts` (pure, no hooks — mirrors attendance `submitClockEventWithOfflineFallback`).
- **Test first:** offline OR network-error → downscale + enqueue → `queued`; `QuotaExceededError`/`QueueFullError` → `not_saved` (emphatic copy); online 2xx → `submitted`; other 4xx → `error`.
- **Acceptance:** state-machine tests cover every branch.

## Task 9 — Wire into `useSnagResolve`
- **Consumes:** Task 8, `useOfflineQueue` (Task 3). **Produces:** `handlePhotoUpload` calls the fallback; owns the photo queue lifecycle; exposes `pendingPhotoCount` + `not_saved` state.
- **Test first** (`useSnagResolve.test.ts` additions): offline upload → queued + `pendingPhotoCount` increments, no error toast; quota full → not_saved surfaced; online path unchanged.
- **Acceptance:** hook tests green; Phase-0 `complete_step` behaviour untouched.

## Task 10 — UI affordance
- **Consumes:** Task 9. **Produces:** queued-photo indicator on the resolve page (extend `PendingSyncIndicator` or a sibling) + emphatic `not_saved` copy in `VerificationStepList`. Wait-for-confirmation before any success check on the tile (never show a green tile for a merely-queued photo — show a distinct "queued, will sync" state). [[feedback_verify_before_confirm]]
- **Test first:** component renders queued count; renders not_saved as a failure, not a check; renders nothing when idle.
- **Acceptance:** component tests green; < 200 lines each.

## Task 11 — Full verification + regression gate
- Re-run Phase-0 `complete_step` queue tests + SW `isReserved` guard test (untouched).
- Browser (playwriter, dev): capture photo offline (dispatched `offline`) → assert `SnagPhotoDB:<token>.pending` has the blob; dispatch `online` → assert flush POSTs, slot row + step complete + one attachment in the DB, pending→0; force a forced double-flush → still one attachment (idempotency live-proof). Fill byte budget → assert `not_saved`.
- Real-device note: record IDB Blob + quota behaviour on a mid-range Android + iOS Safari (R2).

---

## Self-Review (author checklist)
- **Spec coverage:** §3.1→T1–3; §3.2→T4; §3.5→T5–6; §3.3→T7; §3.4→T8–9; §5 UI→T10; §6→T11. Non-goals honoured (no Background Sync, no Activations, no video).
- **Type consistency:** `PendingSnagPhoto`/`QuotaExceededError`/`byteSize` defined in T1/T7 and consumed unchanged in T8–9; `submitSnagPhoto` matches `OfflineQueueConfig.submit` shape; `clientUploadId` produced at capture (T8), stored (T7), sent (T7), consumed server-side (T6).
- **Gated:** all tasks blocked on Hein's O1–O4 (spec §5/§8). PR-1 (lib) can proceed the moment O1=B is confirmed even if O2's exact budget is still open (default 40 MB, tunable).
