# Handoff — 2026-05-14 10:56 SAST

**Project:** FF_Next.js (FibreFlow)
**Branch:** master (clean — all session PRs merged)
**Session goal:** Fix EOD install sheet PDF extraction (ONT serials wrong, PONs blank, dup uploads silent). Next session continues with handwritten-digit OCR accuracy then the dual-DR data model.

## TL;DR — current state

EOD extraction works. **10/10 ONT serials correct** on the test PDF (was 0/10 at session start). PONs auto-fill from `drops` table. Duplicate detection has a real UX. Row 6 hallucination eliminated. Remaining issues are **handwritten digit drift on DRs/Gizzu serials** (~10-20% wrong digits) and the **dual-DR data model** (form has two DR columns, only one is being saved).

## Test artifact

- **File:** `/home/hein/Downloads/10_PDFsam_EOD Scan Pack 13.05.2026.pdf` (1-page, 10-row Velocity install sheet)
- **Form layout** — 4 columns per row:
  1. ONT Serial (printed Code-128 sticker, `ALCLB...`)
  2. DR Installed (handwritten — DR where this ONT was installed)
  3. Gizzu Serial (printed Code-128 sticker, `GU18W12V25-...`)
  4. DR Installed (handwritten — DR where this Gizzu was installed)
- The two DR columns hold *different* DRs per row, but **the set of 10 DRs is identical between columns** — just in different orders. Each DR gets one ONT and one Gizzu; the technician records them as they happen, so the per-row pairing is ONT-time vs Gizzu-time, not ONT-place = Gizzu-place.
- **To join:** collect (ont_serial, ont_dr) pairs from cols 1-2 and (gizzu_serial, gizzu_dr) pairs from cols 3-4. Group by DR to produce 10 logical install records, each `{dr, ont_serial, gizzu_serial}`.

## What got done this session (11 merged PRs)

| PR | Branch | Purpose |
|---|---|---|
| #1611 | fix/eod-ont-serial-extraction | Drop NAFNet from focused-ONT pass, tune hallucination guards |
| #1613 | fix/eod-vlm-max-tokens | EOD_MAX_TOKENS 4096→8192, demand compact JSON |
| #1614 | fix/eod-pon-range-and-addr-guard | validatePon 100-200 → 1-900, address example removed |
| #1615 | fix/eod-pon-identical-guard | Null all-identical PONs (5+ rows) for HLD lookup fallback |
| #1616 | feat/eod-dedup-banner-overlap | Re-extract banner + content-overlap modal |
| #1618 | fix/eod-dup-banner-persistent | Hold dup slots open in auto-finalize, add Dismiss all |
| #1619 | fix/eod-force-reextract | Re-extract anyway now bypasses API hash dedup |
| #1620 | fix/eod-pdf-300dpi-barcodes | PDF DPI 150→300 |
| #1621 | fix/eod-pdf-600dpi | 600 DPI experiment (caused phantom rows) |
| #1622 | fix/eod-rollback-to-300dpi | Rolled back to 300 DPI |
| #1623 | fix/eod-row-dedup | Null duplicate ONT/Gizzu/DR across rows + uniqueness prompt |

## How EOD extraction works now

End-to-end pipeline for `/api/eod/extract`:

1. **PDF rasterization** (`pages/api/eod/pdf-pages.ts`): Ghostscript `-r300`, JPEG output, 25mb body limit on both pdf-pages and extract endpoints
2. **Pass 0+1**: `preprocessEodImage` (EXIF rotate, `optimizeForVlm` to 1280×960 for main pass, 5 preprocessing × 4 rotations = 20 barcode variants for zxing scan)
3. **Pass 2a (main VLM)**: 1280×960 image + structured prompt with COMPACT JSON instruction. Returns table of 10 rows
4. **Pass 3 (post-process)**: `postProcessEntries` normalizes serials/DRs, then hallucination guards run:
   - All DRs identical → null
   - All Gizzu serials identical (full-length only) → null
   - Sequential DR/ONT/Gizzu with bad DR column → null
   - All addresses identical 5+ rows → null
   - All PONs identical 5+ rows → null (for HLD lookup)
   - **Within-sheet uniqueness** (new this session): for each of `ont_serial`/`gizzu_serial`/`dr_number`, null all duplicates after first occurrence
5. **Pass 2b (focused ONT)**: If any ONT is null, re-extract at full-res with a narrow prompt. The apply step now tracks already-set serials so it can't re-introduce duplicates
6. **Pass 4 (HLD enrichment)**: `enrichWithHldPon` looks up `pon_no` from `drops` table by DR — fills PONs that the VLM missed or that uniqueness guard nulled

## Latest test result (after PR #1623 deployed)

Upload of test PDF returned 10 entries, ~25s:

| Row | ONT | Match? | DR | Match? | Gizzu (form) | PON |
|---|---|---|---|---|---|---|
| 1 | ALCLB480E666 | ✅ | DR1858020 | ✅ | 176587 (176688) | 49 |
| 2 | ALCLB484F549 | ✅ | DR1858106 | ✅ | 176583 (176581) | 50 |
| 3 | ALCLB484F5EA | ✅ | DR1858024 (034) | ❌ | 176584 | 49 |
| 4 | ALCLB484F647 | ✅ | DR1858101 | ✅ | 176582 | 50 |
| 5 | ALCLB484F6A8 | ✅ | DR1858107 | ✅ | 176586 (176582) | 50 |
| 6 | ALCLB484F56F | ✅ | DR1858023 (123) | ❌ | 176677 | 49 |
| 7 | ALCLB484F5A6 | ✅ | DR1858038 (115) | ❌ | 176679 | 49 |
| 8 | ALCLB484F4D7 | ✅ | DR1858006 (038) | ❌ | 176678 | 49 |
| 9 | ALCLB484FBD3 | ✅ | null (uniqueness cleared) | – | 176680 | null |
| 10 | ALCLB484F94A | ✅ | DR1858034 (036) | ❌ | null (uniqueness cleared) | 49 |

ONT: 10/10. DR: ~5/10. Gizzu: ~3/10. PONs that survived uniqueness check are correct from HLD.

## What's next — user said "do 2 then 1"

### (2) — Improve handwritten digit OCR

Current failure mode: VLM mis-reads handwritten digits in DR and Gizzu columns. Examples from above:
- `DR1858034` → `DR1858024` (0/3 transposition)
- `DR1858123` → `DR1858023` (1 read as 0)
- `DR1858115` → `DR1858038` (whole row drift)
- Gizzu suffix `176688` → `176587` (6 ↔ 5, 8 ↔ 7)

Approaches to try, in order of cheapness/promise:

1. **Per-column crop + focused VLM pass.** Already done for ONT (`extractOntSerials` at line ~374 of `eodVlmService.ts`). Replicate for DR column and Gizzu column. The form layout is predictable — each column is a fixed fraction of page width.
   - DR column ~30-45% of width; Gizzu suffix is the last 6 digits after `GU18W12V25-`
   - Implementation: `extractDrNumbers(fullResBase64, rowCount)` and `extractGizzuSerials(fullResBase64, rowCount)` mirroring `extractOntSerials`
   - Each focused pass runs *after* the within-sheet uniqueness guard but *before* HLD enrichment

2. **Cross-validate DR against HLD `drops` table.** If a VLM-read DR doesn't exist in `drops` but a near-neighbor does (1-2 digit Levenshtein), prefer the near-neighbor. Every legit DR for an install must exist in `drops`.
   - Query: `SELECT drop_number FROM drops WHERE drop_number ILIKE 'DR1858%'` then fuzzy-match
   - Implement as `correctDrFromHld(entries)` between dedup and `enrichWithHldPon`

3. **Cross-validate Gizzu against a known prefix.** All Gizzu serials on this form start `GU18W12V25-` then 6 digits. The VLM should never emit a different prefix. Extend `cleanGizzuSerial` to enforce `^GU18W12V25-\d{6}$` and null anything else.

4. **Few-shot example pool.** `vlmLearningService` already supports `eod_sheet_dr` and `eod_sheet_address` analysisTypes. Auto-record corrections on save when the user edits a field, then feed them into the prompt as `getVlmFewShotExamples`. Infra is there — just needs corrections collected.

5. **Higher VLM resolution per pass.** Pass 2a uses 1280×960. Bumping to 1600×1200 might help but `optimizeForVlm` was tuned for 1280×960 (Qwen3 sweet spot per code comment). Risky.

**Recommended starting point: (1) per-column crop for DR + Gizzu, then (2) HLD-fuzzy-match DR correction.** Together these will likely push DR accuracy to 9-10/10 and Gizzu to similar.

### (1) — Dual-DR data model rework

The form is being parsed as 10 rows × {dr, ont, gizzu, pon, address}, where `dr` is taken from column 2 (ONT-DR). Column 4 (Gizzu-DR) is currently ignored, and the ONT-Gizzu pairing on each form row is *wrong* — the technician records them as-completed, not by drop.

**Correct model:**
- A form row produces TWO pieces of evidence:
  - "ONT X was installed at DR_A" (cols 1-2)
  - "Gizzu Y was installed at DR_B" (cols 3-4)
- Across the day's 10 form rows, the set of 10 DRs is the same in both columns
- A DR's final record is `{dr, ont_serial: <from ONT-DR match>, gizzu_serial: <from Gizzu-DR match>, pon: <HLD>, address: <form>}`

**Implementation sketch:**
1. **Schema:** `eod_install_sheet_entries` currently has one DR per row. Either:
   - Add `gizzu_dr_number` column and keep `dr_number` as the ONT-DR, OR
   - Refactor entries to be DR-keyed: extract 20 raw observations per page (10 ONT-DR pairs + 10 Gizzu-DR pairs), group by DR, store one entry per DR with both serials. **Recommended** — `dr_number` becomes the natural key per entry. Add a migration to backfill existing rows where `gizzu_dr_number` was assumed equal to `dr_number`.
2. **Prompt:** redesign to extract all 4 columns:
   ```
   {"row":N, "ont_serial":"...", "ont_dr":"DR...", "gizzu_serial":"...", "gizzu_dr":"DR..."}
   ```
3. **Post-process join:** after VLM returns the raw 10 rows, build `Map<dr, {ont?, gizzu?}>` by walking both pair sets, then emit one entry per DR.
4. **Frontend (`EodSheetReviewer`)**: show all four fields per row (ONT + ONT-DR | Gizzu + Gizzu-DR) for review, save the joined records.
5. **Validation:** if both columns of DR sets don't match (≠ same 10 DRs), flag for user review.

This is a meaningful schema change — recommend a brainstorm session on Opus before coding.

## Operational notes

- **Dev URL:** `https://dev.fibreflow.app/activate/data-sync?group=eod&tab=upload`
- **Test DB:** Self-hosted Supabase `100.96.203.105:5436`, DB `fibreflow`, user `postgres.ironman-platform`, pwd in `.claude/credentials.local.md`
- **VLM endpoint:** `http://localhost:8100/v1/chat/completions` on Velocity, model `QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ`, max_model_len 32768
- **NAFNet:** Running at `:8101` but no longer used (deblur made things worse for clean PDF scans)
- **Logger gotcha:** `src/lib/logger.ts` only stores in `process.__appLogs`, never writes to file. The dev/error log gets pino entries from middleware `lib/api-error-handler.ts` (root `lib/logger.ts` which uses pino). When you need to see service-internal logs, use `process.stderr.write(...)` directly during diagnostic — it lands in `/var/log/fibreflow-dev.error.log` via the systemd service redirect.
- **Clear test sheets** before re-uploading the same PDF (hash dedup will skip otherwise):
  ```bash
  PGPASSWORD=a23f6104debd1d3e88e8f00c0067f22f psql -h 100.96.203.105 -p 5436 -U postgres.ironman-platform -d fibreflow -c "DELETE FROM eod_install_sheets WHERE created_at > NOW() - INTERVAL '1 hour';"
  ```
- **Browser debug:** playwriter MCP is already set up. Page reload, hook `window.__cap` on `fetch`, upload file via `input[type=file]`.

## Key file paths

- `pages/api/eod/extract.ts` — VLM extraction endpoint
- `pages/api/eod/pdf-pages.ts` — PDF → JPEG pages (Ghostscript 300 DPI)
- `pages/api/eod/sheets.ts` — save endpoint with hash + content-overlap dedup
- `src/modules/data-sync/services/eodVlmService.ts` — **the main pipeline** (~700 lines); `extractOntSerials` is the focused-pass template to copy
- `src/modules/data-sync/services/eodOverlapService.ts` — `findOverlappingSheets`
- `src/modules/data-sync/services/eodSheetService.ts` — `createSheet`, `writeBackDrSerials`
- `src/modules/data-sync/services/eodBatchService.ts` — client `extractSheetFile`, `saveEodSheet`, `EodOverlapError`
- `src/modules/data-sync/components/groups/eod/EodBatchQueue.tsx` — queue orchestration
- `src/modules/data-sync/components/groups/eod/EodDuplicateBanner.tsx` — dup banner
- `src/modules/data-sync/components/groups/eod/EodOverlapModal.tsx` — overlap modal
- `src/modules/data-sync/components/groups/eod/EodSheetReviewer.tsx` — per-row review table

## How to start the next session

1. `cd /home/hein/Workspace/FF_Next.js && git fetch && git log --oneline -5`
2. `git worktree add /home/hein/Workspace/FF_Next.js-eod-dr-ocr -b fix/eod-dr-focused-pass origin/master`
3. Open `src/modules/data-sync/services/eodVlmService.ts` and find `extractOntSerials` (around line 374). Use it as the template for `extractDrNumbers` (focused DR column extraction).
4. Pipeline order in `extractEodSheet`: after the uniqueness guard, before `enrichWithHldPon`:
   - Run `extractDrNumbers` if any DR is null or any DR fails `cleanDrNumber`
   - Run `extractGizzuSerials` if any Gizzu is null or any fails `cleanGizzuSerial`
   - Then HLD enrichment fills PONs based on the now-cleaner DRs
5. Test in browser end-to-end after each pass added; expect ~50% improvement per focused pass.
