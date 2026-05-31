# Group D — vlm_corrections Referential Integrity (issue #1862)

**Source:** [`2026-05-30-data-integrity-audit.md`](./2026-05-30-data-integrity-audit.md) Dataset 5 · **Drafted:** 2026-05-31
**Companion:** [`2026-05-30-data-integrity-remediation-plan.md`](./2026-05-30-data-integrity-remediation-plan.md) Group D

`vlm_corrections` links to its origin via a **polymorphic reference** (`source_table` + `source_id`), not a real FK — so there is no cascade, and a deleted source row leaves the correction's `source_id` dangling. Counts re-measured live 2026-05-31. Lowest-urgency real-data group (pure metadata, no production broadcast).

---

## D5-2 — 835 `source_table='gallery'` (RE-CLASSIFIED — not broken, no data change)

The audit flagged these as "referencing a dropped `gallery` table." Reading the write path (`pages/api/activate/photo-gallery/save-decisions.ts`) shows **`gallery` is an intentional VIRTUAL source, not a dropped table**: gallery-curated few-shot examples have no physical row, so `source_id` is deliberately NULL and the origin is recorded via `photo_url` + `context_json` (with a parallel `vlm_visual_photo_examples` row keyed by `photo_url`). All 835 have a populated `photo_url` — they are linked, just not by a table id.

**Action:** no data change. `gallery` is now a recognized source in the write-path guard (below) so it stops being flagged. The only real gap is that this endpoint writes directly to `vlm_corrections`, bypassing `recordVlmCorrection` — see Follow-ups.

---

## D5-4 / D5-5 — 23 dangling `source_id` (FIXED via script)

Genuinely broken: corrections whose `source_id` UUID points at a deleted row.
- **D5-4:** `source_table='construction_qa_photos'` → 12 dangling (9 distinct dead UUIDs).
- **D5-5:** `source_table='eod_install_sheets'` → 11 dangling (clustered on one dead UUID).

**Fix:** `scripts/backfill-vlm-corrections-dangling-refs-1862.ts` (dry-run default, `--commit`) nulls the dead `source_id` (keeps the correction; only the dead link is removed). One transaction, `/tmp` snapshot, aborts on rowCount mismatch. **Dry-run (2026-05-31): 12 + 11 = 23.**

**Verify after commit:** both dangling-reference queries (audit D5-4/D5-5) → 0.

---

## D5-3 / D5-6 — unrecoverable (LEFT, flagged)

- **D5-3 (115 unlinked `wa_photos`):** `source_id` and `photo_url` both NULL — no origin to recover. One live writer is `serialRecheckBatchService.ts` (the ONT recheck cron), which records `source_table='wa_photos'` with no id/url. The new guard logs a **warning** for this (recorded but flagged) rather than throwing, so the cron's few-shot harvest is not broken. Proper fix is to make that path pass linkage — see Follow-ups.
- **D5-6 (5 null-provenance):** `source_table` and `source_id` both NULL (fleet odometer/fuel + 2 activate). Nothing to repair; left as-is.

## D5-1 — informational (SKIPPED)

4,627 stale `vlm_extracted_value` mismatches. VLM is reconciliation-only (not lifecycle authority), so this reflects pipeline state, not register truth. Out of scope.

---

## Write-path guard (FIXED — code)

`src/services/vlmCorrectionSource.ts` + wired into `recordVlmCorrection`:
- **FATAL (throws):** a `source_table` not in `KNOWN_VLM_SOURCE_TABLES` (6 real tables + the `gallery` virtual source). Prevents the "name with no matching table" class that produced confusing audit findings. No current caller violates this — pure forward safety.
- **WARNING (records + logs):** a `source_table` with neither `source_id` nor `photo_url`. Surfaces incomplete provenance without breaking live harvest paths.
- Pure + unit-tested (`src/services/__tests__/vlmCorrectionSource.test.ts`, 9 cases).

This guard covers callers that go through `recordVlmCorrection`. It does **not** cover direct `INSERT`s (e.g. save-decisions.ts) — see Follow-ups.

---

## Follow-ups (out of scope here)
- Route `save-decisions.ts` (and any other direct `vlm_corrections` INSERT) through `recordVlmCorrection`, or add a DB-level CHECK/trigger, so the guard covers **all** write paths. A CHECK would need `NOT VALID` (existing 115+5 rows don't carry linkage) and an allowlist kept in sync with `KNOWN_VLM_SOURCE_TABLES`.
- Fix `serialRecheckBatchService.ts` to pass `source_id` (fetch the `dr_photo_unified_reviews.id`) + `source_table='dr_photo_unified_reviews'` instead of an unlinked `wa_photos`, eliminating the D5-3 source.
- Polymorphic-ref dangling (D5-4/D5-5) recurs on any source-row delete; consider a periodic sweep (this script is re-runnable) since true ON DELETE cascade isn't possible across a polymorphic reference.
