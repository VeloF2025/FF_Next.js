# Group E — drops / QA Hygiene Remediation (issue #1863)

**Source:** [`2026-05-30-data-integrity-audit.md`](./2026-05-30-data-integrity-audit.md) Dataset 3 · **Drafted:** 2026-05-31 (Sunday, outside the prod gate)
**Companion:** [`2026-05-30-data-integrity-remediation-plan.md`](./2026-05-30-data-integrity-remediation-plan.md) Group E

All counts re-measured live on 2026-05-31 (the 2026-05-30 snapshot was unchanged for this dataset). Dev + prod share one DB, so every `--commit` is immediately production.

---

## D3-2 — duplicate `drops` rows (FIXED via script)

**What it actually is:** not a naive duplicate. `drops` has `UNIQUE (project_id, drop_number)`, so the same `drop_number` legitimately *can* exist under multiple `project_id`s. DR1753212 / DR1753213 / DR1753214 were each imported **4×**: once as `source='qfield'` under **Lawley** (the real field capture) and three times as `source='sow'` under **Mohadin / Mamelodi / Etwatwa** (repeated SOW imports of the same numbers into the wrong projects). 12 rows → 9 extra.

**Evidence the Lawley/qfield row is canonical:** for DR1753212, the only FK child in the whole group — the `oes_activations.drop_id` reference — points at the Lawley qfield row. The 9 `sow` rows have **zero** FK children across all 9 referencing tables (`pon_change_log, checklist_items, customer_invoice_items, drop_submissions, notification_logs, oes_activations, quality_metrics, spare_usage_log×2`). `qa_photo_reviews` joins `drops` by the `drop_number` *string* (not a FK to `id`), and the keeper retains that string, so QA records are unaffected by the deletion.

**Fix:** `scripts/backfill-dedup-cross-project-drops-1863.ts` (dry-run default, `--commit`). Keeper selection is deterministic: the row with FK children wins; if none, prefer `source='qfield'` then oldest `created_at`. The script **aborts a group** rather than guess if >1 row has children, or if any non-keeper is referenced. Deletes run in one transaction with a pre-delete JSON snapshot to `/tmp` for revert.

**Dry-run result (2026-05-31):** 3 drop_numbers, 9 deletions, 0 groups skipped — keepers all Lawley/qfield.

**Verify after commit:**
```sql
SELECT drop_number, count(*) FROM drops GROUP BY drop_number HAVING count(*) > 1;  -- → 0 rows
```

---

## D3-3 — 2 `Active` drops with no QA (RESOLVED, no fix)

DR1734268 and DR1734935 (both Lawley, `source='qfield'`, `oes_confirmed=true`) are `status='Active'` with no `qa_photo_reviews` row. **Both are present in `oes_activations`** (serials ALCLB477F935 / ALCLB4779B7D, status `Active`, activated 2025-11-17). They are genuine **OES-direct activations** that never passed through the WhatsApp QA photo flow — which is expected for that activation path, not a corruption. **No action.** (These are the only genuinely anomalous slice of D3-3's 165,374; the rest are expected `planned` drops awaiting install.)

---

## D3-1 — 73 orphan QA records (TRIAGE — flagged, NOT deleted)

`qa_photo_reviews.drop_number` values with no matching `drops` row. **Deliberately not deleted:** each carries real photo/review submissions; deleting them loses work, and most are recoverable by fixing the drop_number or importing the missing SOW drop. Classified for the data-ops owner:

| Class | Count | Projects | Recommended action |
|-------|-------|----------|--------------------|
| **Test / demo data** | 1 | Velo Test (`DR0000001`) | Safe to delete on explicit request — clearly synthetic. |
| **Ambiguous (likely demo)** | 8 | Marketing | Confirm with marketing/ops before any deletion — do NOT assume test. |
| **Real-project orphans** | 64 | Lawley 28, Mohadin 20, Mamelodi 10, Thembisa POP 1 4, Etwatwa 2 | SOW-import gap or WhatsApp drop-number typo. Re-import the missing SOW drops or correct the typo'd `drop_number`. 1 of these (`DR173`, Lawley) is format-recoverable — see D3-4. |

No QA rows are deleted by this PR's script.

---

## D3-4 — drop_number format drift (DEFERRED — documented)

`drops` holds **259** numeric-only `drop_number`s (e.g. `'173'`) while `qa_photo_reviews` uses the `DR`-prefix exclusively. This hides 1 join: QA `DR173` (Lawley) does not match `drops` row `'173'`. A `DR`-prefix normalization of all 259 is **safe collision-wise** (0 would clash with an existing `DR`+number row in the same project), but normalizing could surprise any report/query that expects the numeric form. **Deferred to a dedicated follow-up** (bulk normalize the 259 + add a format CHECK / consider a global uniqueness constraint) rather than half-fixing one row here.

---

## Out of scope / not addressed here
- Global uniqueness constraint on `drop_number` (cross-project duplicates are structurally permitted today) — needs a product decision and is coupled to the D3-4 normalization. Tracked as the D3-4 follow-up.
- Deletion of any `qa_photo_reviews` rows — explicit, owner-approved only.
