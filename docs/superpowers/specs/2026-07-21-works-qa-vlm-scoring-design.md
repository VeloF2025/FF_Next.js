# Works-QA VLM Scoring + Honest "Pending" State — Design

**Date:** 2026-07-21
**Branch:** `feature/works-qa-vlm-scoring`
**Author:** Hein (with Claude)

## Problem

Every QField-synced photo on the Works-QA page (`/field-ops/works-qa`) renders a red
**"⚠ VLM fail"** badge. Investigation showed the VLM is not failing — it is **never run**
on these photos.

Evidence chain (top → bottom):

| Layer | Finding |
|-------|---------|
| VLM service | Healthy — `Qwen3-VL-30B-A3B-Instruct-AWQ` up on `:8100`, HTTP 200 |
| UI (`PhotoSlotCard.tsx`) | Renders `⚠ VLM fail` whenever a `vlm` result exists with `valid=false` |
| Sync (`syncQfieldCore.ts`) | Derives `valid = (vlm_confidence >= 0.6)`; NULL → `0` → `valid:false`, feedback defaults to `"Synced from QField"` |
| Data (`qfield_photo_validations`) | `vlm_confidence` is **NULL for 100% of rows since 2026-03-03** (~49k rows) |
| Ingest (`extract-gpkg-photos.py`) | INSERT omits `vlm_confidence` (→ NULL) and never calls the VLM |
| Automation (`worksqa-qfield-ingest.sh`) | Steps: extract → sync → coverage-check. **No VLM scoring step exists** |

The separate **construction-qa** module runs a live VLM successfully (83k photos scored,
last run today) but has not ingested these projects, so it does not cover the Works-QA surface.

Two independent defects:
1. **No scoring** — the Works-QA ingest pipeline has no step that runs the VLM.
2. **Dishonest UX** — an *unscored* photo is rendered identically to a *failed* one (red "VLM fail").

## Goals

- Run the VLM on Works-QA photos so `vlm_results` carries real pass/fail scores.
- Only score photos that are **not yet scored** and **not yet humanly decided** (approved/snagged).
- Score **all newly-synced** photos each run **plus drain the historical backlog** in bounded batches.
- Render an *unscored* photo as a neutral **Pending** state, never as a red failure.

## Non-Goals

- Touching `qfield_photo_validations.vlm_confidence` (dead column; nothing critical reads it for Works-QA).
- Changing the construction-qa VLM (already working).
- Re-scoring photos a human already approved or snagged.
- Backfilling scores for photos that are no longer surfaced in `pole_qa_photos`.

## Architecture

**Score at the `pole_qa_photos` level (after sync), not at `qfield_photo_validations` (before sync).**

Rationale: the photo key, the current VLM result (`vlm_results`), and the human decision
(`slot_approvals`, `civil_approved`/`dome_approved`/`joint_approved`) all live in one
`pole_qa_photos` row. Scoring here makes "skip humanly-decided and already-scored slots" a
local filter with no cross-table join, writes directly to the column the UI reads, and reuses
the exact function already used for manual uploads.

New pipeline: **extract → sync → `vlm-score` (NEW) → coverage-check**.

### Components

#### 1. Reuse existing scorer — `worksQaVlmService.validatePhotoWithVlm()`
Already scores one photo against a slot's `vlmCheck` and is what `pole-assign` runs on manual
uploads. The new batch step calls the same function so synced photos are scored identically to
uploaded ones. No new VLM-calling code.

Photo is fetched by the VLM via an **absolute** `photo-proxy` URL with `&vlm=true`. The proxy
(`pages/api/construction-qa/photo-proxy.ts`) already allows `vlm=true` requests from localhost
(the VLM server on the same host) — the proven path construction-qa uses. A small
`absolutePhotoUrl(key)` helper produces the absolute form of the existing relative `photoUrl(key)`
(works-qa/ → `${APP_BASE}/storage/...`; everything else → `${APP_BASE}/api/construction-qa/photo-proxy?...&vlm=true`).

#### 2. New batch step — `scripts/works-qa-vlm-score.ts`
Headless, pool-injected (same pattern as `scripts/works-qa-sync.ts`). Selection: for each
`pole_qa_photos` row, for each of the 22 known slots (8 civil, 8 dome, 6 main-joint), a slot is
**eligible for scoring** when:
- the slot's `*_key` column is non-null (photo present), **and**
- `vlm_results[slot]` is absent OR `vlm_results[slot].scored === false` (no real score yet), **and**
- `slot_approvals[slot]` is absent (no per-slot human decision), **and**
- the slot's discipline is not human-approved (`civil_approved` for civil slots, etc.).

Ordering & bounds — two phases, matching "score all new ingests + drain backlog N-per-run":
- **Phase 1 (fresh):** score **all** eligible slots on rows with `updated_at > now() - '3 hours'`.
  The `vlm-score` step runs immediately after sync in the same cron invocation (cron cadence is
  every 4h), so this window captures exactly the slots this run's sync just filled. This set is
  naturally small, so it is unbounded.
- **Phase 2 (backlog drain):** score up to **N = 500** eligible slots with
  `updated_at <= now() - '3 hours'`, **oldest `updated_at` first**.

Bounded concurrency (default 4 in flight) protects the GPU across both phases. For each eligible
slot the step calls `validatePhotoWithVlm({ photoUrl: absolutePhotoUrl(key), slotKey, stepLabel,
vlmCheck })` and merges `{ ...result, scored: true }` into `vlm_results[slot]` via
`vlm_results = vlm_results || jsonb_build_object(slot, result)`.

The freshness window (`3 hours`), backlog limit (`--limit`, default 500), concurrency
(`--concurrency`, default 4), and an optional `--project` filter are configurable via flags. The
step logs counts (fresh scored, backlog scored, skipped, errored) so a run is diagnosable.

#### 3. Honesty change — distinct Pending state
- **`VlmSlotResult` type** (`works-qa.types.ts`): add optional `scored?: boolean`. Absent/false = not
  yet scored (pending). Existing scored results are `scored: true`.
- **`syncQfieldCore.ts`**: when upstream `vlm_confidence` is NULL, write `{ scored: false }` (pending
  marker) instead of `{ valid:false, confidence:0, feedback:'Synced from QField' }`. When a real
  upstream confidence exists (legacy rows), keep current behaviour with `scored: true`.
- **`SlotState`** union: add `'pending'`. Derivation precedence (unchanged where noted):
  human-approved → `'approved'`; human-snagged → `'fail'`; VLM scored valid or overridden → `'pass'`;
  VLM scored invalid → `'fail'`; **has photo but unscored → `'pending'`**; no photo → `'empty'`.
- **`PhotoSlotCard.tsx`**: `status` gains `'pending'` → neutral badge "⏳ Awaiting AI" (grey), not red.
  No Override button for pending (nothing to override yet). Human Approve/Snag still available.
- **`vlm_failures` count / overview dots**: pending slots are excluded from the failure count and
  rendered as neutral (grey) dots, not red.

## Data flow

```
QField MinIO GPKG
  → extract-gpkg-photos.py        (rows in qfield_photo_validations, vlm_confidence NULL)
  → works-qa-sync.ts              (fills pole_qa_photos slot keys; unscored → vlm_results[slot]={scored:false})
  → works-qa-vlm-score.ts  (NEW)  (eligible slots → validatePhotoWithVlm → vlm_results[slot]={valid,confidence,feedback,scored:true})
  → works-qa-coverage-check.py    (unchanged)

UI reads pole_qa_photos.vlm_results + slot_approvals → SlotState → badges/dots
```

## Error handling

- `validatePhotoWithVlm` already returns a `FALLBACK_RESULT` on fetch/timeout/parse errors. The
  batch step must NOT persist a fallback as a real score: on fallback (its sentinel feedback), leave
  the slot **unscored** (`scored:false`) so it is retried next run rather than sticking as a red fail.
- One slot's failure never aborts the batch; errors are counted and logged.
- The step is idempotent: already-scored and humanly-decided slots are filtered out, so re-runs are safe.
- Cron step failure is non-fatal to the pipeline (same `|| echo WARNING` convention as the extract step).

## Testing

Unit tests (VLM call mocked, per existing `worksQaVlmService` test pattern):
- **Selection logic**: eligible only when photo present AND unscored AND not humanly-decided AND
  discipline not approved — one case per exclusion reason.
- **Sync pending marker**: NULL upstream confidence → `{scored:false}`; non-null → scored result.
- **`SlotState` derivation**: pending ≠ fail; human decision and VLM-scored precedence preserved.
- **Fallback handling**: a fallback VLM result leaves the slot unscored (not a persisted red fail).

## Rollout

- Merge via PR; deploy to dev via `bash scripts/deploy-local.sh dev`.
- Add the `vlm-score` step to `scripts/cron/worksqa-qfield-ingest.sh` (after sync, before coverage).
- Backlog drains over subsequent cron runs (≤500 slots/run) at bounded concurrency.
- Prod cron wiring is out of scope here (tracked separately — prod cron not yet wired per
  `project_worksqa_qfield_ingest_automation`).
