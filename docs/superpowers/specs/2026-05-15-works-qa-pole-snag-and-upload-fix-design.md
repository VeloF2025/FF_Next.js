# Works QA — Whole-Pole "Confirm Planted" Snag + Upload Fixes

**Date:** 2026-05-15
**Owner:** Hein
**Status:** Draft → pending user approval
**Scope:** Single PR. Civil/Optical QA module only. No DB migration.

---

## Problem

Three issues surfaced by Hein on 2026-05-15 (WhatsApp videos at 10:35 and 10:37) while reviewing Mawadien PON 134 in the Works QA Field App:

1. **Whole-pole verification is impossible.** When a pole isn't planted on site but the field team forgot to mark it as `pole removed` / `cancelled` in QField, the pole keeps showing up in the QA list with no civil/optical photos. There's no way to flag the whole pole for verification — the existing snag UI is photo-scoped, not pole-scoped from the QA list.
2. **Manual upload click does nothing** on empty photo slots (reproduced on Pole `MOA.P.D129` → Optical Dome → Dome Label). Files exist in OneDrive locally; QField never received them; clicking `+ Upload` in the slot produces no file picker.
3. **Drag-and-drop from Windows Explorer into photo slots doesn't work** — the user expects to drag a JPG from a folder onto a slot and have it upload.

---

## Goals

- One-click "is this pole actually planted?" on every pole row and inside the pole detail panel.
- Click `+ Upload` reliably opens the OS file picker on every empty slot (slot + tray).
- Drag-and-drop a JPG from Windows Explorer onto a slot uploads it through the same pipeline as click upload.

## Non-Goals

- Bulk-folder upload, clipboard paste, mobile camera capture into Works QA.
- Auto-creating NOC tickets from "Not planted" snags (deferred to a follow-up).
- Replacing a photo that already exists in a slot (separate UX problem).
- Changing the QField sync filter — poles marked `removed`/`cancelled` in QField stay excluded; that's correct behaviour and out of our control here.
- New RBAC permissions — existing `qa:works-qa:write` is reused.

---

## Design

### 1. Whole-pole "Confirm planted" snag

#### Data model
- Extend `SnagCategory` union in `src/modules/construction-qa/types/snag.types.ts`:
  ```ts
  export type SnagCategory =
    | 'quality'
    | 'health'
    | 'safety'
    | 'environment'
    | 'traffic'
    | 'verification';   // NEW
  ```
- No DB migration. The `snags.category` column is `text`; the union is application-level only.

#### API surface — `POST /api/snags` needs two tweaks
The current `POST /api/snags` requires `report_id` and `snag_number` because every existing snag originates from an imported field-report PDF. Verification snags don't have a report. We make both optional **only for `category = 'verification'`**:

- `report_id` becomes nullable. DB column already allows NULL (no migration); only the validation in `pages/api/snags/index.ts:154-159` rejects missing values. Drop the requirement when category is `verification`.
- `snag_number` auto-generated server-side when omitted: `VRF-{YYMMDD}-{8-char random}`. Existing PDF-import flow continues to pass its own number.
- The `total_findings` update on `snag_reports` (line 187-194) is skipped when `report_id` is null.

These changes are scoped to `pages/api/snags/index.ts:handlePost` only — no impact on existing PDF-import behaviour.

#### Snag payload (sent from `ConfirmPlantedModal`)
| Field | Value |
|---|---|
| `category` | `'verification'` |
| `severity` | `'minor'` |
| `pole_references` | `[pole.pole_label]` (single-element array) |
| `description` | `"Confirm if pole is planted on site"` (editable in modal) |
| `status` | `'open'` (set on insert by the API) |
| `project_id` | current project |
| `report_id` | omitted (null in DB) |
| `snag_number` | omitted (server-generated) |

`zone_no` / `pon_no` are NOT stored on `snags` directly — the snag-list query derives them by joining `pole_references` → poles. No extra fields needed on the payload.

#### Confirmation modal — `ConfirmPlantedModal.tsx` (new, ~60 lines)
Title: **"Confirm: Is pole {pole_label} planted on site?"**
Three actions:
- **Yes — planted** → if no open verification snag exists for this pole, `POST /api/snags` to create one. Then `PATCH /api/snags` with `status: 'verified'` and `verification_notes: "{user.email} confirmed planted at {ISO}"`. The existing PATCH handler stamps `verified_at` automatically (line 217). If a snag already exists, the PATCH alone is enough.
- **No — not planted** → if no open verification snag exists, `POST /api/snags` (stays `'open'`) with `verification_notes: "{user.email} confirmed NOT planted at {ISO}"`. If one already exists, `PATCH /api/snags` updating only `verification_notes` (append a new line). Pole row gains a red **"⚠ Not planted (verify)"** badge.
- **Cancel** → close without writing.

The modal loads existing verification-snag state (if any) via a small GET against `/api/snags?projectId=…&category=verification&pole_label=…` before rendering, so the buttons reflect the current state.

**Audit trail:** All confirmations are recorded in the snag's `verification_notes` column (existing text column, currently used for QA verification comments on standard snags). Each confirmation appends a timestamped line; the field naturally accumulates a history. The structured `verified_at` timestamp covers the most recent "Yes" decision.

#### UI placement (both, per user choice)
1. **`PoleListTable` row** — new narrow column right of the Status pill, contains a flag icon-button (`🚩` for never-asked / red `⚠` for "not planted" / green `✓` for "confirmed planted"). Tooltip: "Confirm pole planted".
2. **`PoleDetailPanel` header** — "Snag pole" button next to the close button. Opens the same modal.

#### Audit trail
(See "Audit trail" paragraph above — uses existing `snags.verification_notes` column and `verified_at` timestamp.)

### 2. Click bug fix

Replace programmatic `fileInputRef.current?.click()` with a native `<label>`-wrapped file input. Programmatic clicks on hidden file inputs can silently fail on certain browser/popup-blocker states; a `<label>` is a first-class user gesture and is the standard pattern.

```tsx
// Before (PhotoSlotCard.tsx:64)
<button onClick={() => fileInputRef.current?.click()} disabled={disabled}>+ Upload</button>
<input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={...} />

// After
<label className={`... cursor-pointer ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
  + Upload
  <input type="file" accept="image/*" className="hidden" disabled={disabled} onChange={...} />
</label>
```

Same change applied to `TrayBucket.tsx:27`.

Add `log.debug('works-qa: slot upload click', { slotKey, hasPhoto })` so future regressions leave a trace.

### 3. Drag-and-drop

Add `onDragOver`, `onDragLeave`, `onDrop` to both `PhotoSlotCard` and `TrayBucket`:

- `onDragOver`: `preventDefault()`, set local `isDragOver` state.
- `onDragLeave`: clear `isDragOver`.
- `onDrop`: `preventDefault()`, filter `e.dataTransfer.files` to `image/*` MIME types, call `onUpload(file)` (slot — first image only, toast `"Only first image used for slot"` if multiple) or `onUpload(files)` (tray — all images).
- Drag highlight: outer border switches to `border-teal-500 border-solid`, bg to `bg-teal-500/10` while `isDragOver`.
- Disabled (discipline-approved) slots never set `isDragOver` and never call `onUpload`.

No backend changes. Routes through existing `/api/works-qa/pole-assign`.

### 4. Pole list aggregate — surface verification state

`pages/api/works-qa/poles.ts` query: add two subselect columns to each pole row:

```sql
EXISTS (
  SELECT 1 FROM snags s
  WHERE s.project_id = p.project_id
    AND s.category = 'verification'
    AND s.status = 'open'
    AND s.pole_references @> ARRAY[p.pole_label]
) AS has_open_verification_snag,
EXISTS (
  SELECT 1 FROM snags s
  WHERE s.project_id = p.project_id
    AND s.category = 'verification'
    AND s.status = 'verified'
    AND s.pole_references @> ARRAY[p.pole_label]
) AS has_verified_planted
```

Surface both flags in `PoleSummary` type → `PoleListTable` reads them to choose flag icon colour (red / green / neutral).

---

## File Inventory

**Modified:**
- `src/modules/construction-qa/types/snag.types.ts` — add `'verification'` to `SnagCategory` union (1 line)
- `src/modules/works-qa/components/PhotoSlotCard.tsx` — `<label>` swap + drag-drop (~30 lines net)
- `src/modules/works-qa/components/TrayBucket.tsx` — `<label>` swap + drag-drop (~25 lines net)
- `src/modules/works-qa/components/PoleListTable.tsx` — flag column + badge wiring (~30 lines)
- `src/modules/works-qa/components/PoleDetailPanel.tsx` — header "Snag pole" button (~15 lines)
- `src/modules/works-qa/types/works-qa.types.ts` — `PoleSummary` gains `has_open_verification_snag` + `has_verified_planted` (2 lines)
- `pages/api/works-qa/poles.ts` — two `EXISTS` subselects (~10 lines)
- `pages/api/snags/index.ts` — `handlePost` accepts null `report_id` + auto-generates `snag_number` for `category='verification'`; skips `total_findings` update when `report_id` is null (~15 lines)

**New:**
- `src/modules/works-qa/components/ConfirmPlantedModal.tsx` (~60 lines)

**Estimated diff:** ~170 lines net. Single-domain.

---

## Testing

### Local CI gates (must pass before PR)
- `npm run ci:quick` — lint ratchets unchanged (77 / ~1833 / 94 baseline).
- `npm run antihall` — no hallucinated symbols.

### Browser smoke (Claude-in-Chrome / Playwright on `dev.fibreflow.app`)
1. **Click upload (regression fix):** Mawadien → PON 134 → Pole `MOA.P.D129` → Optical Dome → click `+ Upload` on Dome Label. File picker opens. Pick image. Slot fills, VLM badge appears.
2. **Drag-and-drop:** Same slot, drag a JPG from desktop. Teal highlight appears. Drop. Slot fills, VLM runs.
3. **Confirm planted (Yes path):** PON 134 list → click 🚩 on a clean pole row → modal opens → "Yes — planted" → row shows green `✓` flag, snag is resolved (verifiable in `/snags` page).
4. **Confirm planted (No path):** Different pole → 🚩 → "No — not planted" → row shows red `⚠ Not planted (verify)` badge, snag remains open (visible in `/snags` page).
5. **From detail panel:** Open any pole → click "Snag pole" in header → same modal flow.
6. **Idempotence:** Re-open the modal on a pole that already has an open verification snag → modal shows existing state, "Yes" resolves the existing snag, no duplicate row in DB.
7. **Disabled invariant:** Approve Civil discipline on a pole → all civil slots reject both click and drop (no upload, no highlight).

### Manual DB check after smoke
```sql
SELECT id, snag_number, category, status, pole_references, description, verified_at, verification_notes
FROM snags
WHERE category = 'verification'
ORDER BY created_at DESC LIMIT 10;
```

---

## Rollout

1. Branch `feat/works-qa-pole-snag-and-upload` off `master` (already created).
2. Implement per the plan that `writing-plans` produces next.
3. Push → blind `/review` (single sonnet, single-domain PR).
4. Self-hosted CI runs (`runs-on: [self-hosted, linux, fibreflow]`).
5. Merge ONLY after blind review APPROVED + CI green: `gh pr merge <N> --merge --delete-branch`.
6. Deploy to dev: `bash scripts/deploy-local.sh dev` → verify on Mawadien PON 134.
7. Production deploy: after hours only, with Hein's explicit approval (CLAUDE.md rule 9).

## Risk

Low.
- No DB migration.
- No new API routes; reuses `/api/snags` and `/api/works-qa/pole-assign`.
- UI additions are purely additive — existing approve/upload flows unchanged unless you interact with the new affordances.
- Worst-case: drag-drop misbehaves on a specific browser → click upload still works as a fallback.
- The `<label>` swap actually *removes* a known-fragile path (programmatic `ref.click()`), so click reliability strictly improves.
