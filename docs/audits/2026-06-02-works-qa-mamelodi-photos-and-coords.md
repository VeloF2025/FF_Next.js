# Works-QA Mamelodi: missing photos + swapped pole coordinates

**Date:** 2026-06-02
**Trigger:** Johan (Civil QA) reported Mamelodi Zone 3 PON 27 — photos visible on
QField but not on FibreFlow works-qa, and "PON 27 shows only 7 poles but there
are more."

---

## Issue 1 — QField photos not surfacing on works-qa (FIXED)

**Pipeline:** `QField → qfield_photo_validations → sync-qfield.ts → pole_qa_photos → works-qa`.
The sync only pulls rows with `feature_type='pole'` **and** a resolvable
`checklist_step`.

**Root cause:** the original Jan-2026 pole-audit photos (`mam-poles_*`) were bulk
ingested with `feature_id = <filename>`, `feature_type = NULL`,
`checklist_step = NULL` — so the sync skipped them. The newer March-2026
`civil-audit_*` photos were extracted with proper label+step and *did* surface.
For poles whose `MAMPoles.gpkg` step-7 cell still points to an old `mam-poles_*`
file (e.g. **A353**), the photo sat as an unlabeled row and never appeared.

**Fix:** `scripts/backfill-works-qa-pole-photo-labels.py` reverse-looks-up each
unlabeled row's filename in `MAMPoles.gpkg` step columns and re-keys it
(`feature_id`→pole label, `feature_type='pole'`, `checklist_step`, `work_type='pole_installation'`).
- Relabeled **139** rows (138 poles), all step 7 ("After photo / full pole").
- Corrected **128** rows that carried `work_type='activation'` (which the sync
  treats as *optical* → would fill `dome_07` instead of `civil_07`).
- Ran the sync → **117** poles gained their step-7 photo; **A353** now shows on
  PON 27 with a real MinIO-backed image.

**Not bugs / limits:**
- **A348** — genuinely never photographed (all GPKG columns empty).
- Most poles only ever had **one** field photo (step 7), so they read ~1/7 civil.
- **16** GPKG conflicts skipped — the same photo is assigned to 3 different poles
  in QField itself (e.g. A438/B278/B280). Field-data error for the QA team.

## Issue 2 — "PON 27 = 7 poles but there are more" (NOT a data defect)

Both `sow_poles` and `MAMPoles.gpkg` agree PON 27 = **7 poles** (A348, A351,
A352, A353, A355, A356, A357; A353 is stored zero-padded `'027'` in the GPKG).
The perception of "more poles" is explained by Issue 3 (the broken map) plus
poles physically near the boundary that belong to PON 26/28. No change made.

## Issue 3 — Swapped pole latitude/longitude (FIX READY)

**Finding:** pole rows had `latitude ≈ +28` (a SA *longitude*) and
`longitude ≈ -25` (a SA *latitude*). The authoritative GPKG `geom` (WKB x=lon,
y=lat) confirms true values are `lat ≈ -25.7, lon ≈ +28.4`. The QField reader
(`read_gpkg.py`) is correct (uses geom + SA-bounds check); the swap entered via
the **SOW import** path.

**Scope (rows matching the unambiguous swap signature):**

| Table | Project | Rows |
|-------|---------|------|
| `poles` | Etwatwa | 4538 |
| `poles` | Mamelodi | 1915 |
| `sow_poles` | Mamelodi | 3261 |
| **Total** | | **9714** |

Lawley/Mohadin/Tonga/Grabouw/Themb'elihle/Thembisa-1 are clean. Two rows
(Lawley `LAW.P.B726`, Thembisa-3 `TEM.P.H275`) have `latitude = NaN` — corrupt,
*not* a swap; excluded from this fix (re-derive from geom separately).

**Repair:** `scripts/fix-swapped-pole-coordinates.py` swaps lat↔lon only for rows
matching `latitude ∈ [16,33] AND longitude ∈ [-35,-22]`, so already-correct rows
(e.g. A348) are never touched. Dry-run by default.

**Prevention:** `src/lib/geo/normalizeSaLatLon.ts` auto-corrects the swapped
signature at the SOW import boundary (`processPoles` / `processDrops`), so the
bad shape no longer persists on future imports.
