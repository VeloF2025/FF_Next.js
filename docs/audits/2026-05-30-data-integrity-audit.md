# FibreFlow Data Integrity Audit — Read-Only Snapshot
**As of: 2026-05-30 | Scope: 6 datasets | 34 confirmed discrepancies across 5 data domains + 3 live Telegram-broadcast mismatches**

> **Overlap note:** D1-3 and D2-2 below are the *same* 240-serial population surfaced from two different audit lenses (register-vs-OES reconciliation, and lifecycle-matrix integrity). They are retained as separate findings because each dataset's remediation owner needs to see it, but they represent **one** underlying issue, not two — verified: `intersect = 240, only-D1-3 = 0, only-D2-2 = 0`. Counting distinct underlying problems, the true total is 33.

> Method: multi-agent read-only audit. One finder agent per dataset (live-schema discovery, `SELECT`-only under server-enforced `default_transaction_read_only=on`), each finding independently re-verified with a second, separately-formulated confirming query. Findings that could not be reproduced were dropped (default false-positive). Every row below carries the SQL that proves it.

---

## Summary Table

| # | Dataset | Confirmed Discrepancies | False Positives Filtered | Severity Floor |
|---|---------|------------------------|--------------------------|----------------|
| 1 | Serial register ↔ OES ↔ Fibertime SP Excel | 8 | 0 | Critical |
| 2 | ONT stock lifecycle integrity (mig-387 matrix) | 6 | 0 | Critical |
| 3 | drops (SOW) vs qa_photo_reviews (WA QA) | 4 | 0 | High |
| 4 | PP/OES overlap vs SP Excel SoT | 7 | 0 | High |
| 5 | vlm_corrections linkage integrity | 6 | 0 | High |
| **6** | **Jarvis/Hermes Telegram broadcast reports** | **3** | **3** | **Critical** |
| | **TOTAL** | **34** | **3** | |

---

## DATASET 6 — TELEGRAM BROADCAST REPORTS (ACTION REQUIRED)

> **These figures are actively being broadcast to WhatsApp/Telegram groups. Two reports are sending materially wrong numbers right now.**

### D6-1 — CRITICAL MISMATCH: WA PP Daily "backlog remaining"

| Field | Value |
|-------|-------|
| Report | Velocity WA PP daily report |
| Metric | PP backlog remaining |
| Value broadcast | **2,596** |
| Value recomputed | **947** (true non-activated PP at 19:00 SAST 2026-05-29) |
| Over-count | **+1,649 records** |
| Report timestamp | 2026-05-29T19:00:01+02:00 |
| Source paths | `/home/hein/.hermes/cron/output/e98121137030/2026-05-29_19-00-01.md` · `/home/hein/Workspace/Cortex/reports/wa-pp-daily/Velocity_Fibre_WA_PP_Daily_Report_2026-05-29.pdf` · `/home/hein/.hermes/scripts/velocity_wa_pp_daily_report.py:190` |

**Root cause:** The backlog filter uses `COUNT(*) FILTER (WHERE COALESCE(resolution_status,'') NOT ILIKE 'resolved')`. Zero rows in `oes_pp_data` carry `resolution_status='resolved'` — the terminal state is `'activated'` — so this filter returns the entire table (2,596 rows) as "backlog". The 1,649 already-activated records are incorrectly included.

**Verified SQL (live DB returns 2,616 total / 959 correct open as of 2026-05-30):**
```sql
SELECT
  COUNT(*)                                                       AS total_records,
  COUNT(*) FILTER (WHERE resolution_status = 'activated')       AS activated_count,
  COUNT(*) FILTER (
    WHERE COALESCE(resolution_status,'') NOT ILIKE 'resolved'
  )                                                              AS broken_backlog_filter,  -- 2,616 at audit (2026-05-30); was 2,596 at report run (2026-05-29 19:00) — entire table either way
  COUNT(*) FILTER (
    WHERE resolution_status IS DISTINCT FROM 'activated'
  )                                                              AS correct_open_backlog,   -- returns 959
  COUNT(*) FILTER (WHERE resolution_status = 'resolved')        AS resolved_count          -- returns 0
FROM oes_pp_data;
```

**Fix:** Replace `NOT ILIKE 'resolved'` with `IS DISTINCT FROM 'activated'` at `velocity_wa_pp_daily_report.py:190`.

---

### D6-2 — CRITICAL MISMATCH: PP→OES Activation Report "backlog remaining"

| Field | Value |
|-------|-------|
| Report | Velocity PP to OES activation report |
| Metric | Backlog remaining |
| Value broadcast | **2,616** |
| Value recomputed | **959** (true non-activated PP at 23:00 SAST 2026-05-29) |
| Over-count | **+1,657 records** |
| Report timestamp | 2026-05-29T23:00:30+02:00 |
| Source paths | `/home/hein/.hermes/cron/output/39f77cfa24fa/2026-05-29_23-00-30.md` · `/home/hein/Workspace/Cortex/reports/pp-oes-activated-daily/Velocity_Fibre_PP_Final_Reconciliation_Report_2026-05-29.pdf` · `/home/hein/.hermes/scripts/velocity_pp_oes_activation_report.py:243` |

**Root cause:** Identical broken filter as D6-1, at a different script line. Both the WA PP daily and the PP→OES report share the same SQL pattern. At 23:00 cut-off, 1,657 records were already `'activated'` and should be excluded; none carry `'resolved'`.

**Reproducing SQL:**
```sql
SELECT
  COUNT(*) FILTER (WHERE resolution_status = 'activated')
    AS activated_incorrectly_in_backlog,   -- 1,657
  COUNT(*) FILTER (
    WHERE resolution_status IS DISTINCT FROM 'activated'
  )                                        AS correct_open   -- 959
FROM oes_pp_data;
```

**Fix:** Same as D6-1 — replace filter at `velocity_pp_oes_activation_report.py:243`.

---

### D6-3 — MINOR MISMATCH: PP→OES Report "Cleared" count vs FibreFlow resolved count

| Field | Value |
|-------|-------|
| Report | Velocity PP to OES activation report |
| Metric | PP→OES Cleared (2026-05-29) |
| Value broadcast | 12 (OES truth) |
| FibreFlow workflow count | 11 (`ff_resolved`) |
| Report timestamp | 2026-05-29T23:00:30+02:00 |
| Source paths | `/home/hein/.hermes/cron/output/39f77cfa24fa/2026-05-29_23-00-30.md` |

**Note:** The broadcast value of 12 is correct per the agreed definition ("cleared = OES activated only"). The `ff_resolved=11` divergence reflects 1 activation recorded in OES that was not progressed through the FibreFlow workflow. Not a bug in the report; a definitional note for consumers.

**Reproducing SQL:**
```sql
WITH oes_today AS (
  SELECT * FROM oes_activations WHERE activation_date = '2026-05-29'
)
SELECT COUNT(DISTINCT pp.id) AS cleared_count
FROM oes_today oa
JOIN oes_pp_data pp
  ON UPPER(TRIM(pp.serial_number)) = UPPER(TRIM(oa.serial_number))
  OR pp.resolved_drop_number = oa.drop_number;
-- Returns 12
```

**Dataset 6 false positives (broadcast correct, no action needed):**
- ONT Issues Tracker "Open PP" = 959: verified correct.
- ONT Issues Tracker "Open Mismatches / No Entries" = 94 / 169: verified correct.
- Atlas PP watchdog "Duplicate DRs" = 9 DRs / 18 rows: verified correct.

---

## DATASET 1 — Serial Register ↔ OES ↔ Fibertime SP Excel

**8 confirmed discrepancies (0 false positives)**

### D1-1 — CRITICAL: 14,474 OES-active ONTs remain 'in_stock' in the register

**Key:** `oes_active_in_stock_in_register`
**Expected:** ONT serials Active in OES (with `activation_date` and `drop_number`) should have `status='activated'` in `stock_serials`.
**Actual:** 14,474 serials appear as `status='Active'` in `oes_activations` (all with `activation_date` and `drop_number` populated) but remain `status='in_stock'` in `stock_serials`. All 14,474 were bulk-created on 2026-04-02 (Sprint E migration). Their `installed_at_drop_number` is NULL — the register was never advanced to `'activated'` after OES ingestion.
**Severity:** Critical | **Record count:** 14,474

```sql
SELECT COUNT(*)
FROM oes_activations oa
INNER JOIN stock_serials ss ON ss.serial_number = oa.serial_number
WHERE oa.status = 'Active'
  AND oa.activation_date IS NOT NULL
  AND oa.drop_number IS NOT NULL
  AND ss.status = 'in_stock';
-- Returns 14,474
```

> **Count-integrity note:** the bare `COUNT(*)` here equals `COUNT(DISTINCT ss.serial_number)` because `oes_activations` has no fan-out on Active serials — verified: `SELECT COUNT(*) - COUNT(DISTINCT serial_number) FROM oes_activations WHERE status='Active'` returns **0** (18,465 rows = 18,465 distinct). The join cannot inflate the figure.

---

### D1-2 — HIGH: 2,318 OES-active serials absent from the register entirely

**Key:** `oes_active_serials_absent_from_register`
**Expected:** Every serial OES reports as 'Active' should exist in `stock_serials`.
**Actual:** 2,318 serials are 'Active' in `oes_activations` but have no row in `stock_serials`. All carry the ALCLB4 (Nokia ONT) prefix. 1,310 activated in May 2026; 845 in July–August 2025; remainder scattered Sep 2025–Apr 2026. None appear in `ont_swap_records` as replacement serials.
**Severity:** High | **Record count:** 2,318

```sql
SELECT COUNT(DISTINCT oa.serial_number)
FROM oes_activations oa
LEFT JOIN stock_serials ss ON ss.serial_number = oa.serial_number
WHERE oa.status = 'Active'
  AND ss.serial_number IS NULL;
-- Returns 2,318
```

---

### D1-3 — HIGH: 240 OES-confirmed activations stuck in 'installed' in the register

**Key:** `oes_active_installed_not_activated_in_register`
**Expected:** ONT serials 'Active' in OES should be 'activated' in the register, not 'installed'.
**Actual:** 240 serials are 'Active' in `oes_activations` with `drop_number` and `activation_date`, but `stock_serials.status='installed'`. Sample confirms matching `installed_at_drop_number` values — OES activation completed, register lifecycle not advanced past 'installed'. **⚠️ Same 240-serial population as D2-2** (viewed here as a register-reconciliation gap; D2-2 frames it as a lifecycle-cascade miss). Verified identical: intersect = 240, no rows unique to either side.
**Severity:** High | **Record count:** 240 (shared with D2-2)

```sql
SELECT COUNT(DISTINCT ss.serial_number)
FROM stock_serials ss
INNER JOIN oes_activations oa ON oa.serial_number = ss.serial_number
WHERE ss.status = 'installed'
  AND oa.status = 'Active'
  AND oa.drop_number IS NOT NULL
  AND oa.activation_date IS NOT NULL;
-- Returns 240
```

---

### D1-4 — HIGH: 34 register-activated FT-ONTs with no OES record

**Key:** `register_activated_no_oes_record`
**Expected:** Every FT-ONT `status='activated'` in the register should have a corresponding 'Active' record in `oes_activations`.
**Actual:** 34 FT-ONT serials are 'activated' in `stock_serials` but have no entry in `oes_activations` (neither Active nor Uninstalled). Some have `installed_at_drop_number` and `installed_date` populated, indicating local activation that was never sent to OES.
**Severity:** High | **Record count:** 34

```sql
SELECT COUNT(*)
FROM stock_serials ss
JOIN stock_items si ON ss.stock_item_id = si.id
WHERE si.name = 'FT-ONT'
  AND ss.status = 'activated'
  AND NOT EXISTS (
    SELECT 1 FROM oes_activations oa
    WHERE oa.serial_number = ss.serial_number
      AND oa.serial_number IS NOT NULL
  );
-- Returns 34
```

---

### D1-5 — MEDIUM: 172 PP-vs-OES drop number conflicts for the same serial

**Key:** `pp_oes_drop_number_conflict`
**Expected:** For serials activated in both `oes_pp_data` and `oes_activations`, `resolved_drop_number` and `drop_number` should agree.
**Actual:** 172 serials have conflicting drop numbers between the two sources. Example: serial ALCLB48E0705 is at DR476193 in OES but DR474284 in PP (resolved via wa_photos). Represents genuine address-resolution disagreement, not a data artifact.
**Severity:** Medium | **Record count:** 172

```sql
SELECT COUNT(*)
FROM oes_pp_data opd
INNER JOIN oes_activations oa ON oa.serial_number = opd.serial_number
WHERE oa.status = 'Active'
  AND opd.resolution_status = 'activated'
  AND opd.resolved_drop_number IS NOT NULL
  AND oa.drop_number IS NOT NULL
  AND UPPER(TRIM(opd.resolved_drop_number)) <> UPPER(TRIM(oa.drop_number));
-- Returns 172
```

---

### D1-6 — MEDIUM: 422 PP serials unresolved to any drop

**Key:** `pp_serials_not_found_no_drop_match`
**Expected:** Serials imported from the PP/SP Excel should resolve to a drop number.
**Actual:** 422 serials in `oes_pp_data` have `resolution_status='not_found'`. Breakdown: 316 in `stock_serials` as 'in_stock', 86 absent from the register entirely, 20 'activated' in the register with no resolved drop.
**Severity:** Medium | **Record count:** 422

```sql
SELECT ss.status, COUNT(*) AS cnt
FROM oes_pp_data opd
LEFT JOIN stock_serials ss ON ss.serial_number = opd.serial_number
WHERE opd.resolution_status = 'not_found'
GROUP BY ss.status
ORDER BY cnt DESC;
-- Total = 422 (in_stock:316, NULL:86, activated:20)
```

---

### D1-7 — MEDIUM: 2 register-vs-OES drop conflicts for the same serial

**Key:** `register_oes_drop_conflict_same_serial`
**Expected:** For serials present in both OES (Active) and the register (with `installed_at_drop_number`), drop assignments should agree.
**Actual:** 2 serials have conflicting drop numbers: ALCLB48E9E85 (OES: DR2599638, register: DR2599618) and ALCLB48CC83B (OES: DR1862133, register: DR1864674). Both are `status='activated'` in the register.
**Severity:** Medium | **Record count:** 2

```sql
SELECT ss.serial_number,
       oa.drop_number        AS oes_drop,
       ss.installed_at_drop_number AS reg_drop,
       ss.status             AS reg_status
FROM stock_serials ss
JOIN oes_activations oa ON oa.serial_number = ss.serial_number
WHERE ss.installed_at_drop_number IS NOT NULL
  AND oa.drop_number IS NOT NULL
  AND oa.status = 'Active'
  AND ss.installed_at_drop_number <> oa.drop_number
ORDER BY ss.serial_number;
-- Returns 2 rows
```

---

### D1-8 — LOW: SP PON Tracker is 65 days stale, aggregate-only (no serial-level data)

**Key:** `sp_pon_tracker_stale_no_serial_level_data`
**Expected:** SP Excel should provide serial-level reconciliation against OES and the register.
**Actual:** `sp_pon_tracker` contains only PON-level aggregate counts (activated, available per PON/zone) with no serial numbers. Last sync: 2026-03-26 — 65 days stale. 13,945 total activated across 1,319 PON rows at that date vs OES 14,037 (delta 92). Serial-level reconciliation from DB alone is impossible.
**Severity:** Low | **Record count:** 1,319 PON rows

```sql
SELECT
  COUNT(DISTINCT id)                        AS distinct_row_count,
  SUM(COALESCE(activated, 0))               AS sum_activated,
  MAX(synced_at)::date                      AS last_sync_date,
  EXTRACT(DAY FROM (NOW() - MAX(synced_at)))::int AS days_since_sync
FROM sp_pon_tracker;
-- 1319 rows, 13945 activated, last sync 2026-03-26, 65 days stale
```

---

## DATASET 2 — ONT Stock Lifecycle Integrity (Migration-387 Transition Matrix)

**6 confirmed discrepancies (0 false positives)**

### D2-1 — CRITICAL: 7 illegal backward activated→installed transitions

**Key:** `backward_activated_to_installed`
**Expected:** Once a serial reaches 'activated', no backward transition to 'installed' is permitted. `stock_serial_status_transitions` has no row for `activated→installed`.
**Actual:** 7 serials have `from_state='activated'`, `to_state='installed'` events (all `event_type='installed_at_drop'`, `source_table='drops'`). All 7 are currently stuck in 'installed'. A field install drop event fired after OES had already activated the serial, overwriting the activated state.
**Severity:** Critical | **Record count:** 7

```sql
SELECT e.event_type, e.source_table,
       COUNT(*) AS event_rows,
       COUNT(DISTINCT e.serial_id) AS unique_serials
FROM stock_serial_events e
WHERE e.from_state = 'activated'
  AND e.to_state = 'installed'
GROUP BY e.event_type, e.source_table;
-- Returns installed_at_drop / drops / 7 rows / 7 unique serials
```

---

### D2-2 — CRITICAL: 240 OES-confirmed activations stuck in 'installed' (cascade missed)

**Key:** `oes_active_installed_missed_activation`
**Expected:** The OES cascade trigger should advance `installed→activated` when an OES activation is imported for a serial registered before its activation date.
**Actual:** 240 serials have `oes_activations.status='Active'` with `activation_date` after `stock_serials.created_at`, yet `stock_serials.status='installed'`. Longest: 124 days (ALCLB48CB0B3, installed 2026-01-26). 5 serials stuck 30+ days. **⚠️ Same 240-serial population as D1-3** — one underlying issue counted under two datasets; do not sum them.
**Severity:** Critical | **Record count:** 240 (shared with D1-3)

```sql
SELECT COUNT(DISTINCT ss.serial_number) AS cnt_installed_but_oes_active
FROM stock_serials ss
JOIN oes_activations oa ON oa.serial_number = ss.serial_number
WHERE ss.status = 'installed'
  AND oa.status = 'Active'
  AND oa.activation_date > ss.created_at::date;
-- Returns 240
```

---

### D2-3 — HIGH: 1,624 post-registration OES activations not reflected in register

**Key:** `oes_active_in_stock_missed_post_registration`
**Expected:** Serials registered in `stock_serials` before their OES activation date should be advanced to 'activated' when the OES event is imported.
**Actual:** 1,624 distinct serials show `oes_activations.status='Active'` with `activation_date` after `stock_serials.created_at`, yet `stock_serials.status='in_stock'`. The OES activation cascade did not fire for these. (Separate from the 12,850 serials already Active in OES before registration — those are a historical backfill gap, not a regression.)
**Severity:** High | **Record count:** 1,624

```sql
SELECT COUNT(*) AS cnt
FROM (
  SELECT ss.serial_number
  FROM stock_serials ss
  WHERE ss.status = 'in_stock'
    AND EXISTS (
      SELECT 1 FROM oes_activations oa
      WHERE oa.serial_number = ss.serial_number
        AND oa.status = 'Active'
        AND oa.activation_date > ss.created_at::date
    )
) sub;
-- Returns 1,624
```

---

### D2-4 — MEDIUM: 65 event records reference pre-mig387 'available' state name

**Key:** `pre_mig387_state_name_bypass`
**Expected:** After migration-387 renamed 'available'→'in_stock' (backfill ran 2026-05-30 04:43 UTC), all new event records should use 'in_stock'. The transition `available→activated` is not in `stock_serial_status_transitions`.
**Actual:** 65 event records show `from_state='available'`, `to_state='activated'`, all occurring 2026-05-21 to 2026-05-29 (pre-backfill window). The OES cascade fired on serials still holding the legacy state name, bypassing the transition matrix guard. 54 of these 65 are now correctly 'activated'; 11 had a subsequent backward transition to 'installed'.
**Severity:** Medium | **Record count:** 65

```sql
SELECT COUNT(*) FROM stock_serial_events
WHERE from_state = 'available' AND to_state = 'activated';
-- Returns 65
```

---

### D2-5 — MEDIUM: 3 activated serials with zero event history

**Key:** `orphan_activated_no_event_history`
**Expected:** Every `status='activated'` serial should have at least one event in `stock_serial_events` tracing the activation transition.
**Actual:** 3 serials (ALCLB480E59D, ALCLB48F2F05, ALCLB48E004C — all created 2026-04-02, `updated_at` 2026-05-29 consistent with mig-387 backfill) have `status='activated'` with zero rows in `stock_serial_events`. A direct `UPDATE` bypassed the trigger or the trigger was not yet wired at creation time.
**Severity:** Medium | **Record count:** 3

```sql
SELECT ss.serial_number, ss.status, ss.created_at::date
FROM stock_serials ss
LEFT JOIN stock_serial_events e ON e.serial_id = ss.id
WHERE ss.status = 'activated'
GROUP BY ss.id, ss.serial_number, ss.status, ss.created_at
HAVING COUNT(e.id) = 0
ORDER BY ss.created_at;
-- Returns 3 rows
```

---

### D2-6 — LOW: 5 no-op self-transitions in the event log

**Key:** `no_op_self_transitions_in_event_log`
**Expected:** State transition events should only be recorded when `from_state != to_state`.
**Actual:** 5 self-transition events: 4 with `from_state='installed'`, `to_state='installed'` (event_type='installed_at_drop', all 2026-05-26) and 1 with `from_state='activated'`, `to_state='activated'`. No state corruption, but the install trigger fired twice on already-in-state serials without a guard clause.
**Severity:** Low | **Record count:** 5

```sql
SELECT from_state, to_state, event_type,
       COUNT(*) AS cnt,
       MIN(occurred_at) AS first_seen
FROM stock_serial_events
WHERE from_state IS NOT NULL
  AND to_state IS NOT NULL
  AND from_state = to_state
GROUP BY from_state, to_state, event_type
ORDER BY cnt DESC;
-- Returns installed/installed/installed_at_drop (4) + activated/activated/activated (1)
```

---

## DATASET 3 — drops (SOW) vs qa_photo_reviews (WhatsApp QA)

**4 confirmed discrepancies (0 false positives)**

### D3-1 — HIGH: 73 orphan QA records referencing non-existent drop numbers

**Key:** `orphan-qa-no-matching-drop`
**Expected:** Every `qa_photo_reviews.drop_number` should reference an existing `drops.drop_number`.
**Actual:** 73 QA records reference drop numbers absent from the `drops` table. Breakdown by project: Lawley (28), Mohadin (20), Mamelodi (10), Marketing (8), Thembisa POP 1 (4), Etwatwa (2), Velo Test (1). Marketing and Velo Test entries are likely test/training submissions. Remaining 64 may be SOW-import gaps or WhatsApp submission typos.
**Severity:** High | **Record count:** 73

```sql
SELECT project, COUNT(*) AS orphan_count
FROM qa_photo_reviews q
WHERE NOT EXISTS (
  SELECT 1 FROM drops d WHERE d.drop_number = q.drop_number
)
GROUP BY project
ORDER BY orphan_count DESC;
-- Total = 73
```

---

### D3-2 — HIGH: 3 drop numbers duplicated 4× each in the drops table (9 extra rows)

**Key:** `duplicate-drop-number-in-drops`
**Expected:** Each `drop_number` in the `drops` table should be unique (one SOW line per drop).
**Actual:** DR1753212, DR1753213, DR1753214 each appear 4 times (12 total rows, 9 extra). Each was imported once via `source='qfield'` and three times via `source='sow'` across different `project_id` UUIDs on 2026-01-15/16. DR1753212 also has a QA review, causing a 4-row fan-out in joins and inflating join-based counts.
**Severity:** High | **Record count:** 9 extra rows

```sql
SELECT drop_number, COUNT(*) AS cnt
FROM drops
GROUP BY drop_number
HAVING COUNT(*) > 1
ORDER BY cnt DESC;
-- Returns DR1753212 / DR1753213 / DR1753214, each cnt=4
```

---

### D3-3 — MEDIUM: 165,374 drops with no QA coverage (including 2 anomalous Active drops)

**Key:** `drops-no-qa-coverage-gap`
**Expected:** All non-planned DR-prefixed drops should have at least one `qa_photo_review` record.
**Actual:** 165,374 DR-prefixed drops have no matching QA record. 165,372 are 'planned' (expected — not yet installed). **2 are 'Active' status with no QA — anomalous.** Overall coverage: 9,104 / 174,478 = 5.2%. No-QA breakdown: Thembisa POP 3 (38,232), POP 1 (30,478), POP 2 (30,126), Etwatwa (20,929), Lawley (20,916), Mohadin (18,417), Mamelodi (6,274), Lawley Active (2).
**Severity:** Medium | **Record count:** 165,374

```sql
SELECT COUNT(*) FROM drops d
WHERE d.drop_number ~ '^DR[0-9]+$'
  AND NOT EXISTS (
    SELECT 1 FROM qa_photo_reviews q
    WHERE q.drop_number = d.drop_number
  );
-- Returns 165,374
```

---

### D3-4 — LOW: 1 hidden orphan from drop-number format mismatch (numeric vs DR-prefix)

**Key:** `drop-number-format-mismatch-numeric-vs-dr-prefix`
**Expected:** `drop_number` format should be consistent between tables so joins work correctly.
**Actual:** The `drops` table contains 259 numeric-only drop numbers (e.g. '173', '1') with no DR prefix, while `qa_photo_reviews` uses DR-prefix exclusively. This causes 1 confirmed hidden orphan: `qa_photo_reviews` has 'DR173' (Lawley, 2026-03-15) which does not join to `drops` row `drop_number='173'`. A normalized join reduces true orphan count from 73 to 72.
**Severity:** Low | **Record count:** 1

```sql
SELECT COUNT(DISTINCT q.drop_number)
FROM qa_photo_reviews q
WHERE NOT EXISTS (SELECT 1 FROM drops d WHERE d.drop_number = q.drop_number)
  AND EXISTS (
    SELECT 1 FROM drops d
    WHERE 'DR' || d.drop_number = q.drop_number
      AND d.drop_number ~ '^[0-9]+$'
  );
-- Returns 1
```

---

## DATASET 4 — PP/OES Overlap vs SP Excel SoT

**7 confirmed discrepancies (0 false positives)**

### D4-1 — HIGH: 245 'located' records that should be 'activated' (overlap understated by 14.8%)

**Key:** `located-records-should-be-activated`
**Expected:** `oes_pp_data` records whose `resolved_drop_number` appears in `oes_activations` should carry `resolution_status='activated'`.
**Actual:** 245 records have `resolution_status IN ('located_1map','located_local','located_unified')` but their `resolved_drop_number` is confirmed in `oes_activations`. The PP/OES overlap is understated by 245 (1,657 reported vs ~1,902 true). Breakdown: Mohadin 181, Lawley 49, Mamelodi 11, TEM 3, TEM-3 1.
**Severity:** High | **Record count:** 245

```sql
SELECT COUNT(*)
FROM oes_pp_data p
INNER JOIN oes_activations a ON a.drop_number = p.resolved_drop_number
WHERE p.resolution_status IN ('located_1map','located_local','located_unified');
-- Returns 245
```

---

### D4-2 — HIGH: 115 serial mismatches between PP and OES for the same drop number

**Key:** `serial-mismatch-pp-vs-oes-same-drop`
**Expected:** For the same drop, the ONT serial in `oes_pp_data` should match `oes_activations`.
**Actual:** 115 'activated' records in `oes_pp_data` have a different serial from `oes_activations` for the same drop (excluding '-' placeholders). `serial_change_history` explains 58 of these (recorded swaps); 57 remain genuinely unexplained. Breakdown: Lawley 34, Mamelodi 32, Mohadin 37 (verified figure — finder's original sub-count was 39; see Caveats), TEM 12. Unexplained cases likely represent stale PP serials or post-activation swaps not fed back to the PP table.
**Severity:** High | **Record count:** 115

```sql
SELECT COUNT(*)
FROM oes_pp_data p
JOIN oes_activations a ON a.drop_number = p.resolved_drop_number
WHERE p.resolution_status = 'activated'
  AND p.serial_number IS NOT NULL
  AND TRIM(p.serial_number) NOT IN ('', '-')
  AND a.serial_number IS NOT NULL
  AND TRIM(a.serial_number) NOT IN ('', '-')
  AND UPPER(TRIM(p.serial_number)) != UPPER(TRIM(a.serial_number));
-- Returns 115
```

---

### D4-3 — MEDIUM: 57 activated PP records absent from oes_activations

**Key:** `activated-pp-not-in-oes-activations`
**Expected:** All `resolution_status='activated'` records with a non-null `resolved_drop_number` should have a matching row in `oes_activations`.
**Actual:** 57 records are marked 'activated' but their `resolved_drop_number` is absent from `oes_activations`. Breakdown: Mohadin 29, Lawley 20, Mamelodi 7, TEM 1. Sources: 1map_search (36), dr_photo_unified_reviews (13), 1map_api (5), wa_photos (2), stock_serials (1). These are activation claims backed solely by non-OES photo/visual evidence.
**Severity:** Medium | **Record count:** 57

```sql
SELECT COUNT(*) FROM oes_pp_data opd
WHERE opd.resolution_status = 'activated'
  AND opd.resolved_drop_number IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM oes_activations oa
    WHERE oa.drop_number = opd.resolved_drop_number
  );
-- Returns 57
```

---

### D4-4 — MEDIUM: 58 activated PP records missing activated_at timestamp

**Key:** `activated-at-not-synced-from-oes-activations`
**Expected:** `oes_pp_data` records with `resolved_source='oes_activations'` should have `activated_at` populated from `oes_activations.activation_datetime`.
**Actual:** 58 records have `resolved_source='oes_activations'` and `resolution_status='activated'` but `activated_at IS NULL`, even though the linked `oes_activations` row has a valid `activation_date`. The back-fill sync is not running for newly matched records.
**Severity:** Medium | **Record count:** 58

```sql
SELECT COUNT(*)
FROM oes_pp_data p
INNER JOIN oes_activations a ON a.drop_number = p.resolved_drop_number
WHERE p.resolution_status = 'activated'
  AND p.resolved_source = 'oes_activations'
  AND p.activated_at IS NULL
  AND a.activation_date IS NOT NULL;
-- Returns 58
```

---

### D4-5 — MEDIUM: 53 drops with oes_confirmed=FALSE despite PP marking them activated

**Key:** `drops-oes-confirmed-false-for-activated-pp`
**Expected:** Drops resolved as 'activated' in `oes_pp_data` should have `oes_confirmed=TRUE` in the `drops` table.
**Actual:** 53 drops are 'activated' in `oes_pp_data` but have `oes_confirmed=FALSE` (and `oes_confirmed_at=NULL`) in `drops`. The flag sync is not firing when `resolution_status` is set to 'activated'.
**Severity:** Medium | **Record count:** 53

```sql
SELECT COUNT(DISTINCT d.drop_number)
FROM drops d
INNER JOIN oes_pp_data p ON p.resolved_drop_number = d.drop_number
WHERE p.resolution_status = 'activated'
  AND (d.oes_confirmed = false OR d.oes_confirmed IS NULL);
-- Returns 53
```

---

### D4-6 — LOW: 260 of 262 import batches have zeroed located/not_found metadata

**Key:** `import-batch-metadata-not-maintained`
**Expected:** `oes_pp_import_batches.located_count` and `not_found_count` should reflect actual counts for each batch.
**Actual:** 260 of 262 batches (99.2%) with `total_rows > 0` have `located_count=0` AND `not_found_count=0`. Only the two earliest batches (Feb 2026, IDs 1 and 2) have non-zero counts. Per-batch reporting and audit are impossible.
**Severity:** Low | **Record count:** 260

```sql
SELECT COUNT(*)
FROM oes_pp_import_batches
WHERE total_rows > 0
  AND located_count = 0
  AND not_found_count = 0;
-- Returns 260
```

---

### D4-7 — LOW: 1 serial duplicated across two project aliases (ETW-2 / Etwatwa)

**Key:** `duplicate-serial-across-projects`
**Expected:** Each `serial_number` in `oes_pp_data` should appear at most once.
**Actual:** ALCLB48F4CCD appears twice: once under project='ETW-2' (batch 201, 2026-05-21) and once under project='Etwatwa' (batch 238, 2026-05-23), both `resolution_status='activated'`, both `resolved_drop_number='DR2376160'`. Same site imported under two project name aliases.
**Severity:** Low | **Record count:** 1 duplicated serial (2 rows)

```sql
SELECT serial_number, COUNT(*) AS occurrences,
       array_agg(project ORDER BY created_at) AS projects,
       array_agg(resolved_drop_number ORDER BY created_at) AS drop_numbers
FROM oes_pp_data
GROUP BY serial_number
HAVING COUNT(*) > 1;
-- Returns ALCLB48F4CCD, count=2, projects={ETW-2, Etwatwa}, drops={DR2376160, DR2376160}
```

---

## DATASET 5 — vlm_corrections Linkage Integrity

**6 confirmed discrepancies (0 false positives)**

### D5-1 — HIGH: 4,627 stale vlm_extracted_value mismatches in dr_photo_unified_reviews

**Key:** `stale_linkage_vlm_extracted_value_mismatch`
**Expected:** `vlm_corrections.vlm_extracted_value` should match the current serial value in the linked source record.
**Actual:** 4,627 corrections (2,517 `ont_serial_front` + 2,110 `ont_serial_back`) have `vlm_extracted_value` no longer matching the linked `dr_photo_unified_reviews` serial column. Of these: 3,095 are genuinely stale (corrected_value also diverged from source — correction not applied back); 1,532 have `corrected_value` matching the source (correction was applied and source updated — expected flow).
**Severity:** High | **Record count:** 4,627

```sql
SELECT COUNT(*) AS total_stale
FROM vlm_corrections vc
INNER JOIN dr_photo_unified_reviews dr ON dr.id = vc.source_id
WHERE vc.source_table = 'dr_photo_unified_reviews'
  AND vc.vlm_extracted_value IS NOT NULL
  AND CASE vc.analysis_type
    WHEN 'ont_serial_front' THEN
      dr.vlm_ont_serial_step6 IS NOT NULL
      AND dr.vlm_ont_serial_step6 <> vc.vlm_extracted_value
    WHEN 'ont_serial_back' THEN
      dr.vlm_ont_serial_step9 IS NOT NULL
      AND dr.vlm_ont_serial_step9 <> vc.vlm_extracted_value
    ELSE FALSE
  END;
-- Returns 4,627 (front: 2,517 + back: 2,110)
```

---

### D5-2 — HIGH: 835 corrections referencing dropped 'gallery' table

**Key:** `gallery_table_missing`
**Expected:** `source_table='gallery'` should reference an existing table in the public schema.
**Actual:** 835 `vlm_corrections` rows reference `source_table='gallery'` which does not exist in `information_schema.tables` (table was dropped or renamed). All 835 have `source_id IS NULL` so no dangling UUID reference, but `source_table` metadata is permanently broken.
**Severity:** High | **Record count:** 835

```sql
SELECT COUNT(*) FROM vlm_corrections
WHERE source_table = 'gallery';
-- Returns 835

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name ILIKE '%gallery%';
-- Returns 0 rows (table does not exist)
```

---

### D5-3 — MEDIUM: 115 wa_photos corrections with no linkage (no source_id, no photo_url)

**Key:** `completely_unlinked_wa_photos_corrections`
**Expected:** All `source_table='wa_photos'` corrections should have at least `source_id` OR `photo_url` to identify the source record.
**Actual:** 115 corrections have `source_table='wa_photos'`, `source_id IS NULL`, and `photo_url IS NULL` — no linkage to any source record. All in the activate module: 107 `ups_serial` + 8 `wa_photo_serial` analysis types. (586 other wa_photos corrections do have linkage, so this is a specific write path issue.)
**Severity:** Medium | **Record count:** 115

```sql
SELECT module, analysis_type, COUNT(*)
FROM vlm_corrections
WHERE source_id IS NULL
  AND source_table = 'wa_photos'
  AND photo_url IS NULL
GROUP BY module, analysis_type;
-- Returns activate/ups_serial=107, activate/wa_photo_serial=8 (total 115)
```

---

### D5-4 — MEDIUM: 12 dangling UUID references to deleted construction_qa_photos rows

**Key:** `dangling_uuid_construction_qa_photos`
**Expected:** Every `source_id` with `source_table='construction_qa_photos'` should match a row in `construction_qa_photos.id`.
**Actual:** 12 corrections carry a `source_id` UUID that no longer exists in `construction_qa_photos` (9 distinct deleted UUIDs; one referenced by 3 corrections, one by 2, seven by 1 each). Source rows deleted without cascading to `vlm_corrections`.
**Severity:** Medium | **Record count:** 12

```sql
SELECT COUNT(*)
FROM vlm_corrections vc
LEFT JOIN construction_qa_photos c ON c.id = vc.source_id
WHERE vc.source_table = 'construction_qa_photos'
  AND vc.source_id IS NOT NULL
  AND c.id IS NULL;
-- Returns 12
```

---

### D5-5 — MEDIUM: 11 dangling UUID references to deleted eod_install_sheets rows

**Key:** `dangling_uuid_eod_install_sheets`
**Expected:** Every `source_id` with `source_table='eod_install_sheets'` should match a row in `eod_install_sheets.id`.
**Actual:** 11 corrections carry a `source_id` UUID that no longer exists in `eod_install_sheets`. Source rows deleted without cascading to `vlm_corrections`.
**Severity:** Medium | **Record count:** 11

```sql
SELECT COUNT(*)
FROM vlm_corrections vc
LEFT JOIN eod_install_sheets e ON e.id = vc.source_id
WHERE vc.source_table = 'eod_install_sheets'
  AND vc.source_id IS NOT NULL
  AND e.id IS NULL;
-- Returns 11
```

---

### D5-6 — LOW: 5 corrections with no provenance at all (source_table IS NULL AND source_id IS NULL)

**Key:** `null_source_table_and_source_id`
**Expected:** All corrections should have at minimum `source_table` populated.
**Actual:** 5 corrections have both `source_table IS NULL` and `source_id IS NULL` — no provenance whatsoever. Breakdown: fleet/odometer (2), fleet/fuel_gauge (1), activate/ont_serial_back (2).
**Severity:** Low | **Record count:** 5

```sql
SELECT module, analysis_type, COUNT(*) AS cnt
FROM vlm_corrections
WHERE source_table IS NULL AND source_id IS NULL
GROUP BY module, analysis_type
ORDER BY module, analysis_type;
-- Returns fleet/odometer=2, fleet/fuel_gauge=1, activate/ont_serial_back=2 (total 5)
```

---

## Caveats & Scope

**Audit basis:** Read-only SQL queries against the FibreFlow Supabase PostgreSQL instance (`supabase-db` on `100.96.203.105:5437`). No data was modified; no Telegram messages were sent. Snapshot as of 2026-05-30.

**Count note:** 34 confirmed findings are detailed above; per-dataset section counts (8/6/4/7/6/3) sum to 34. One pair — **D1-3 and D2-2** — is the same 240-serial population surfaced from two audit lenses (verified: intersect = 240, none unique to either), so the number of *distinct underlying problems* is **33**. They are listed separately so each dataset's remediation owner sees the issue, but must not be summed when sizing the work. No other cross-dataset overlaps were found.

**What was covered:**
- `stock_serials`, `oes_activations`, `sp_pon_tracker`, `oes_pp_data`, `stock_serial_events`, `stock_serial_status_transitions`, `drops`, `qa_photo_reviews`, `vlm_corrections`, `dr_photo_unified_reviews`, `construction_qa_photos`, `eod_install_sheets`, `wa_photos`, `oes_pp_import_batches`, `serial_change_history`, Hermes cron output files (`~/.hermes/cron/output/`) and Cortex report attachments (`~/Workspace/Cortex/reports/`).

**What was NOT covered:**
- `ont_swap_records` deep content (referenced but not audited independently).
- QField GPKG / MinIO storage layer — no storage-layer integrity check was performed.
- WA bridge SQLite (`messages.db`) vs Postgres group tables — out of scope for this run.
- Fibertime SharePoint Excel serial-level data — the DB contains only PON-level aggregates; serial-level SP reconciliation requires a fresh Excel pull.
- Future OES ingestion runs — counts will shift as the OES nightly sync proceeds.
- Historical QA records predating Sprint E cutover (2026-04-02) — only post-cutover lifecycle is governed by the mig-387 transition matrix.

**VLM treatment:** VLM serial extraction is treated as reconciliation evidence only, not authority. Per project rule, ONT lifecycle authority remains OES. The D5-1 stale-mismatch count (4,627) reflects VLM pipeline state, not serial register truth.

**Independent verification:** Every finding listed above survived at least two independently-formulated SQL queries. Record counts shown use the verifier's measured count where it differed from the finder's; no finding was rejected solely on small count discrepancies (the one verified divergence — D4-2 Mohadin sub-count of 37 vs finder's 39 — did not change the confirmed total of 115).
