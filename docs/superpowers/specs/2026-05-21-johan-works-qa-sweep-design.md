# Johan Works QA Sweep — Epic Design

**Date:** 2026-05-21
**Author:** Hein (brainstormed via Claude)
**Driver:** Johan Scott — WhatsApp 2026-05-21 19:04 + 19:05 (Afrikaans)
**Status:** Approved for implementation
**Module:** `src/modules/works-qa/`

## 1. Why

Johan flagged five concrete works-qa pain points on the Lawley + Thembisa POP 1 sweeps. The slow part of his workflow is dragging optical photos one-by-one out of the per-pole **Unassigned Photos** bucket and into the right slot. He also asked for an AI auto-classifier, bulk manual upload, ZIP coverage of unassigned photos, and called out one PON he believed had no photos in FibreFlow.

Investigation showed item #5 ("Thembisa PON 206 not pulling from QField") is not a bug — the 8 poles with QField photos for that PON do sync into `civil_step_07_key` (work_type `pole_installation`, step 7 "After Photo"). Johan was expecting optical photos that have not been collected yet. Memory note saying "Thembisa = SharePoint" was wrong; Thembisa POPs 1/2/3 are all linked to QField (3 links in `qfield_project_links`, 605 photos in `qfield_photo_validations` for Thembisa POP 1).

## 2. Scope

Four PRs + one tracked follow-up + one Johan reply + one memory correction.

| # | Surface | Estimated effort | Risk |
|---|---|---|---|
| PR 1 | `pon-zip.ts` includes unassigned bucket | <100 LOC | Low |
| PR 2 | Per-pole bulk upload drop zone | ~150 LOC + new component | Med |
| PR 3 | AI auto-sort classifier (multi-class VLM) | ~400 LOC + migration | Med-High |
| PR 4 | NOC ticket only — upstream QField VLM investigation | 0 LOC (tracked work) | n/a |
| Reply | WhatsApp Johan re #5 (Afrikaans) | — | — |
| Memory | `feedback_tonga_qfield.md` correction | — | — |

Items #1, #2, #3 from Johan's message collapse into PR 3 (the classifier). #4 is PR 1. #5 needs only a reply.

## 3. PR 1 — ZIP includes unassigned photos

**File:** `pages/api/works-qa/pon-zip.ts` (current 135 lines → ~165).

**Changes:**

- New query param `include_unapproved=true` opts out of the `WHERE approved_at IS NOT NULL` filter. Default keeps current approved-only behaviour for any downstream consumers that rely on it.
- Add an unassigned block to the per-pole loop:
  ```ts
  const unassignedKeys: string[] = Array.isArray(pole.unassigned_photo_keys)
    ? pole.unassigned_photo_keys : [];
  const unassignedFolder = zip.folder(`${ponLabel}/${pole_label}/unassigned`);
  const unassignedPromises = unassignedKeys.map(async (key, i) => {
    const buf = await fetchPhoto(photoUrl(key), cookie);
    if (buf) unassignedFolder.file(`photo_${String(i + 1).padStart(2, '0')}.jpg`, buf);
  });
  ```
- Front-end: add a second download affordance in `WorksQAPage.tsx` — "Download ZIP (including in-progress)". Calls the same endpoint with `include_unapproved=true`.

**RBAC:** unchanged. Still `construction-qa.works-qa.export:view`.

**Tests:** unit test that builds a ZIP from a fixture pole with 2 unassigned photos; assert both file paths exist in the archive; assert approved-only default still excludes in-progress poles.

**Acceptance:** `/api/works-qa/pon-zip?project_id=<Thembisa POP 1>&pon_no=206&include_unapproved=true` produces a ZIP with `PON_206/TEM.P.C200/unassigned/photo_01.jpg` etc.

## 4. PR 2 — Per-pole bulk upload drop zone

**Files:**

- New: `src/modules/works-qa/components/BulkUnassignedUpload.tsx` (~80 lines)
- Edit: `src/modules/works-qa/components/UnassignedBucket.tsx` — header gets a `[+ Bulk upload]` button when not disabled (~25 line delta)
- Edit: `pages/api/works-qa/pole-assign.ts` — extend the existing `slot=tray` branch with a new `slot=unassigned` value that appends to `unassigned_photo_keys[]` instead of `main_joint_tray_keys[]` (~15 line delta)

**UX:** two entry points — clicking `[+ Bulk upload]` opens a multi-file picker (`accept="image/*"`, `multiple`), AND the existing `UnassignedBucket` drop zone accepts dragged image files (matching the pattern already in `TrayBucket.tsx`). Selected/dropped files upload concurrently with per-file progress chips. On completion, refresh the bucket via existing SWR mutate. No folder picker (browsers don't expose folder paths reliably) — multi-file selection and drag-drop of selected files cover Johan's use case (he drops "X selected" from his file manager onto the bucket).

**VLM:** existing `validatePhotoWithVlm` in `pole-assign.ts` runs per file (already does for `slot=tray`). VLM result stored under `vlm_results[unassigned_<uuid>]` — same pattern as tray, distinct namespace.

**Permissions:** reuse `construction-qa.works-qa:create`.

**Risk:** medium. New UI component (kept in its own file to respect the 200-line component cap — `PoleDetailPanel.tsx` is already at 359 lines, so we do not grow it further). Server change is a small extension of existing branching.

**Acceptance:** open Thembisa POP 1 PON 206 / TEM.P.C200 in dev, click `[+ Bulk upload]`, select 5 photos from local disk, all 5 appear as thumbnails in the unassigned bucket within ~10s.

## 5. PR 3 — AI auto-sort classifier

**New endpoint:** `POST /api/works-qa/auto-sort`

```ts
body: { pole_id: string }
response: {
  auto_placed: number,
  suggested: number,
  leftover: number,
  results: Array<{
    photo_key: string,
    predicted_slot: string,
    confidence: number,
    action: 'auto-placed' | 'suggested' | 'leftover',
  }>
}
```

Handler iterates over `pole.unassigned_photo_keys`. For each photo, runs a single multi-class VLM call (sequential — single RTX5090 GPU). Result triaged into the three tiers:

| Confidence | Target slot empty? | Action |
|---|---|---|
| ≥ 0.95 | yes | Auto-place: write slot column, remove from `unassigned_photo_keys`, write `qa_correction_examples` row with `correction_reason='auto_sort_placed'` |
| ≥ 0.95 | no (slot already filled) | Stay in bucket. Write suggestion at full confidence. UX surfaces it identically to the 0.6–0.95 tier so Johan sees the same `Accept` mini-button; clicking Accept calls `move-photo` which will surface the slot-already-filled conflict to him. |
| 0.6 – 0.95 | n/a | Suggestion: write `unassigned_suggestions[photo_key] = { suggested_slot, confidence, generated_at }`. Photo stays. |
| < 0.6 | n/a | No-op. |

**New VLM service method** in `src/modules/works-qa/services/worksQaVlmService.ts`:

```ts
export async function classifyPhotoToSlot(photoUrl: string): Promise<{
  slot_key: string | null;
  confidence: number;
  reasoning: string;
}>
```

The prompt enumerates all 21 slots from `SLOT_META` with `vlmCheck` descriptions and asks for top-1 slot key + confidence in strict JSON. Malformed responses → return `{slot_key: null, confidence: 0, reasoning: 'parse_failed'}` (treated as <0.6 leftover).

**Migration:** `scripts/migrations/sql/<next>_works_qa_unassigned_suggestions.sql`

```sql
ALTER TABLE pole_qa_photos
  ADD COLUMN unassigned_suggestions JSONB NOT NULL DEFAULT '{}';
```

Pick the migration version from `SELECT MAX(version) FROM migrations` at PR time, not from `ls scripts/migrations/sql/` (per feedback_migration_version_collision — side branches collide on shared DB).

Shape of `unassigned_suggestions`:

```json
{
  "<photo_key>": {
    "suggested_slot": "civil_03",
    "confidence": 0.87,
    "generated_at": "2026-05-21T19:30:00Z"
  }
}
```

**UI changes** — `src/modules/works-qa/components/UnassignedBucket.tsx`:

- New button at top: `[🧠 Auto-sort with AI]`. Disabled and shows `Sorting 3 of 7…` while running.
- After response, suggestion-tier photos render a badge overlay `→ civil_03 · 87%` plus a small `Accept` button.
- `[Accept all suggestions]` button appears at top if any suggestions exist. Each accept fires the existing `/api/works-qa/move-photo` endpoint (which already writes `qa_correction_examples`).

**Training data:** `qa_correction_examples` table — same table `move-photo.ts` already writes to. Its `(vlm_predicted_step, vlm_predicted_category)` columns match the classifier's prediction shape, and `workflow_type='works_qa'` keeps these rows distinct from DR-photo corrections. (`works_qa_corrections` is a separate concept — slot-approval overrides — and is not the right table here.) Over time these rows become the fine-tuning corpus for the upstream QField VLM (handed off in PR 4).

**Concurrency:** sequential VLM calls per pole. Multiple users on different poles can run auto-sort simultaneously — each request serialises its own GPU work, GPU saturation is fine.

**File-size discipline:** `UnassignedBucket.tsx` is 92 lines today; the auto-sort button + badge logic will push it past 200. Factor the badge into a separate `UnassignedSuggestionBadge.tsx` component. Keep `UnassignedBucket.tsx` ≤200 lines per `feedback_file_size_limit_strict`.

**RBAC:** new permission `construction-qa.works-qa.auto-sort:create`, granted to roles that already have `construction-qa.works-qa:create`. Seed via the access-control skill at PR time.

**Acceptance:** on a fixture pole with 5 unassigned photos representative of multiple slots, the response contains expected `action` breakdown (e.g. 2 auto-placed, 2 suggested, 1 leftover). On a dev pole (Thembisa POP 1 / TEM.P.C200, 1 unassigned photo today), the classifier returns a slot prediction. Johan signs off via WhatsApp in Afrikaans after testing on Lawley.

## 6. PR 4 — Upstream QField VLM investigation (tracked, no code)

A NOC/devops ticket tracks the question raised by the #5 diagnostic: `vlm_confidence` is NULL for all 8 sampled Thembisa POP 1 PON 206 step-7 photos despite `checklist_step` being populated. Possible causes:

- VLM-on-ingest disabled for some `work_type` values
- VLM never wired for `pole_installation` step 7 specifically
- Recent regression in the qfield-sync VLM pipeline

Outcomes feed back into the classifier training corpus from PR 3. Linked to this epic but does not block PRs 1-3.

Owner: TBD (qfield-sync module owner). Filed as a NOC ticket via `/noc-team` skill once PRs 1-3 are merged.

## 7. Reply to Johan (Afrikaans, for #5)

> Hi Johan — Thembisa POP 1 PON 206 trek wel deur. Ek het 'n vinnige DB kyk gedoen en 8 van die 9 paaltjies (TEM.P.C200..C208) het civil foto's gesync (na "Civil Step 7 / After Photo"). Daar's egter nog GEEN optical/dome foto's vir hierdie PON in QField nie — lyk asof daai werk nog nie gedoen is by Thembisa POP 1 nie. Kan jy bevestig of optical werk reeds by PON 206 gedoen is, of of dit nog uitstaande is? As dit gedoen is, gaan ek dieper kyk waarom dit nie deur QField pull nie.

(Send via WhatsApp manually — not automated.)

## 8. Memory correction

`~/.claude/projects/.../memory/feedback_tonga_qfield.md` says "Tonga=QField, Etwatwa=OneDrive, Thembisa=SharePoint". Confirmed wrong: Thembisa POPs 1/2/3 are linked in `qfield_project_links` and have 605+ photos in `qfield_photo_validations`. Update memory to reflect Thembisa = QField (Etwatwa/Tonga unchanged unless those also need re-checking — out of scope for this epic).

## 9. Sequencing

```
PR 1 (ZIP)         → fastest win, ships standalone
  └─→ PR 2 (bulk upload)  → depends on nothing in PR 1
        └─→ PR 3 (classifier)   → depends on PR 2's bulk-upload column shape being final
              └─→ PR 4 follow-up ticket filed once PRs 1-3 merged
                    └─→ Johan reply + memory correction can ship anytime
```

Each PR ships under the standard `/review` → `/pr` → merge → `bash scripts/deploy-local.sh dev` flow.

## 10. Validation gates

| PR | Check |
|---|---|
| 1 | Unit test asserts unassigned/ folder exists in fixture ZIP. Manual: hit endpoint with Thembisa POP 1 PON 206, confirm 8 photos in unassigned/. |
| 2 | Dev sanity: open TEM.P.C200, drop 5 photos, all 5 land in unassigned bucket within 10s. |
| 3 | Unit test on fixture pole; manual auto-sort on a real pole; Johan WhatsApp sign-off. |
| 4 | Ticket filed and visible in NOC backlog. |

## 11. Out of scope (explicit)

- Multi-pole bulk upload (folder dump spanning many poles via filename convention). Per Johan's reply on phone-call sequencing: per-pole is enough for now.
- Auto-sort running automatically on QField sync (button-triggered only per Johan's exact ask).
- Multi-pole "Auto-sort all poles in PON" batch button. Not asked for; can be a fast follow-up if Johan needs it after using PR 3.
- Replacing `qa_correction_examples` writes — `move-photo.ts` continues to write there in parallel with new `works_qa_corrections` writes. Resolve the two-table redundancy in a separate cleanup PR if/when it becomes a real problem.
- Tonga / Etwatwa photo-source memory verification (only fixing Thembisa).

## 12. Open questions to firm up at PR-writing time

1. Confidence threshold values (0.95 / 0.6) are first-pass guesses. Revisit after 1 week of real classifier output if too many suggestions are wrong, or too few photos are auto-placed.
2. Bulk upload batch cap — start unbounded; if Johan hits perf issues at >50 files, introduce a 50-file chunk cap with a "continue" prompt.
3. Whether to also write the auto-place row into `qa_correction_examples` (alongside `works_qa_corrections`) for compatibility with any downstream report — TBD when the PR is open.
