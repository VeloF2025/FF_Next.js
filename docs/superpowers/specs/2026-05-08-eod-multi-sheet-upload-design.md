# EOD Multi-Sheet Upload — Design Spec
**Date:** 2026-05-08  
**Status:** Approved  

---

## Problem

The current EOD upload handles one sheet at a time. At end of day, admins need to upload 5–15 technician sheets. The one-at-a-time flow is too slow and doesn't connect the extracted DR↔ONT pairs back into the canonical DR records, serial change history, or pre-provisioning pipeline.

---

## Goals

1. Accept multiple sheets in one drop (multi-file select + folder drag-and-drop).
2. Process sheets sequentially through VLM; let the user review in a queue (Sequential Queue).
3. On save, write confirmed DR↔ONT matches back to `dr_photo_unified_reviews` (fill nulls only, never overwrite existing serials).
4. Log each match to `serial_change_history` + `dr_activity_log` with `change_source = 'eod_sheet'` so it appears in the DR's activation history.
5. Pre-provisioning picks up EOD-sourced serials automatically (no extra work — it already queries `dr_photo_unified_reviews.ont_serial_scanned`).

---

## Architecture

### New UI components

**`EodBatchQueue`** (`src/modules/data-sync/components/groups/eod/EodBatchQueue.tsx`)  
Owns the file list and the extraction pipeline state machine. Each file slot transitions:  
`pending → extracting → ready → saved | failed`

The pipeline extracts sheet N+1 in the background while the user reviews sheet N, so "Save & Next" is usually instant.

Renders:
- Progress chips row at the top (one chip per file; colour-coded by state)
- Passes the current `EodVlmExtraction` + file index down to `EodSheetReviewer`
- Handles "Save & Next" / "Skip" / "Retry failed" actions

**`EodSheetReviewer`** (`src/modules/data-sync/components/groups/eod/EodSheetReviewer.tsx`)  
Pure display: receives an `EodVlmExtraction` result + sheet index, renders the editable review pane (date, technician, entry table), emits `onSave(entries)` and `onSkip()`. Extracted from the current `EodUploadTab` single-sheet review section — no new logic, just a clean boundary.

**`EodUploadTab`** (existing, shrinks significantly)  
Renders the upload drop zone when queue is empty; renders `EodBatchQueue` once files are queued. No longer owns extraction or review state.

### Upload zone changes

- `<input type="file" multiple accept="image/*">` — multi-file select (replaces the current single-file input)
- Second `<input type="file" webkitdirectory accept="image/*">` — folder select button
- Drag-and-drop zone uses `webkitGetAsEntry()` on the `DataTransferItem` to recursively read folder contents; filters to `image/*` files only
- Files are de-duplicated by name+size before adding to queue

### Extraction pipeline

- Extracts one file at a time (VLM GPU is serial; concurrent requests would queue on the server anyway)
- As soon as the current sheet enters "reviewing", immediately starts extracting the next `pending` file in the background
- If extraction fails, slot moves to `failed`; user can retry that slot individually or skip it

---

## Backend changes

### `SerialChangeSource` type (`_shared.ts`)

Add `'eod_sheet'` to the union:

```ts
export type SerialChangeSource =
  | 'onemap_sync'
  | 'manual_edit'
  | 'vlm_extraction'
  | 'wa_photo_vlm'
  | 'swap_correction'
  | 'migration'
  | 'eod_sheet';   // new
```

### `eodSheetService.createSheet()` — write-back logic

After inserting the sheet header and entries, for each entry where **both** `dr_number` and `ont_serial` are non-null:

1. Query `dr_photo_unified_reviews` for `ont_serial_scanned` where `drop_number = dr_number`.
2. If the DR exists and `ont_serial_scanned IS NULL` → `UPDATE dr_photo_unified_reviews SET ont_serial_scanned = $eodOnt WHERE drop_number = $dr`.
3. Call `logSerialChange(drNumber, 'ont_serial', currentSerial, eodSerial, 'eod_sheet', uploadedBy, 'technician_update', { eod_sheet_id, eod_entry_row })`.
4. If `ont_serial_scanned` is already set (non-null) → still call `logSerialChange` (records the EOD capture for audit; `oldValue === newValue` guard in `logSerialChange` skips the insert if they match exactly).
5. If the DR does not exist in `dr_photo_unified_reviews` → log a warning; do not create a new row (DR must exist before a serial can be assigned to it).

`logSerialChange` already writes to both `serial_change_history` and `dr_activity_log`. No additional logging code needed.

### Write-back is synchronous inside `createSheet()`

The user has reviewed and confirmed the data before hitting save; write-back completes before the API returns so the response includes a `matched_count`.

### API response change

`POST /api/eod/sheets` response adds:
```json
{
  "matched_count": 7,   // DRs updated with ONT serial (previously null)
  "logged_count": 10    // serial_change_history entries created (includes confirmations of already-set serials)
}
```

---

## Data flow summary

```
Field tech writes EOD sheet
        ↓
Admin photographs / scans → drops into FF upload zone (multi-file or folder)
        ↓
EodBatchQueue queues files
        ↓
VLM extracts each sheet sequentially → EodVlmExtraction (dr_number, ont_serial per row)
        ↓
Admin reviews in EodSheetReviewer → edits any bad rows → Save & Next
        ↓
createSheet() persists eod_install_sheets + eod_install_sheet_entries
        ↓
Write-back loop: for each dr+serial pair
  → fills ont_serial_scanned in dr_photo_unified_reviews (if null)
  → logSerialChange(..., 'eod_sheet') → serial_change_history + dr_activity_log
        ↓
Pre-provisioning queries dr_photo_unified_reviews.ont_serial_scanned → picks up EOD data automatically
DR activation history shows 'eod_sheet' serial capture event
Search by DR or ONT serial surfaces EOD-sourced matches via serial_change_history
```

---

## What is NOT changing

- VLM extraction API (`/api/eod/extract`) — unchanged
- Reconciliation tab — unchanged
- `dr_photo_unified_reviews` schema — no new columns
- `serial_change_history` schema — no new columns
- Pre-provisioning queries — no changes needed

---

## File list

| File | Change |
|------|--------|
| `src/modules/data-sync/components/groups/eod/EodUploadTab.tsx` | Shrink: replace single-file logic with drop zone + `EodBatchQueue` |
| `src/modules/data-sync/components/groups/eod/EodBatchQueue.tsx` | **New** — queue state machine + progress chips |
| `src/modules/data-sync/components/groups/eod/EodSheetReviewer.tsx` | **New** — extracted review pane |
| `src/modules/activate/services/activity-log/_shared.ts` | Add `'eod_sheet'` to `SerialChangeSource` |
| `src/modules/data-sync/services/eodSheetService.ts` | Add write-back loop in `createSheet()` |
| `pages/api/eod/sheets.ts` | Return `matched_count` + `logged_count` in POST response |
