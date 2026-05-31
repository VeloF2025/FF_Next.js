# FibreFlow Data Integrity — Remediation Plan
**Companion to:** [`2026-05-30-data-integrity-audit.md`](./2026-05-30-data-integrity-audit.md) · **Drafted:** 2026-05-31 · **Status:** proposal, awaiting controller approval

This plan turns the audit's confirmed findings into a sequenced, low-risk remediation. It does **not** apply any fix. Each group becomes one tracking issue.

---

## ⚠️ Controlling constraints (read first)

1. **Dev and prod share one database.** Every migration, trigger change, and data backfill is **immediately live in production**. There is no staging copy of the data.
2. **Production time gate.** No schema/data changes during business hours (08:00–17:00 SAST, Mon–Fri). All of this lands after-hours, with explicit approval.
3. **Backfills are dry-run → audit → `--commit`.** Never a blind `UPDATE`. Each backfill script prints affected counts and a sample, is reviewed, then re-run with `--commit`.
4. **No guessing.** Every group's first task is to **read the actual cascade code and confirm the root cause** before writing a migration or fix. Findings below carry a *hypothesis*, not a conclusion.
5. **Migrations:** `scripts/migrations/sql/`, version = `MAX(DB max, on-disk max) + 1`, prod runs as `postgres` superuser.
6. **Counts shift.** The audit is a 2026-05-30 snapshot; OES ingestion moves numbers nightly. Re-measure at fix time.

---

## Fix groups (priority order)

### Group B — Lifecycle guard gaps (DO FIRST: active corruption) → Issue
**Findings:** D2-1 (7 illegal `activated→installed`), D2-4 (65 `available→activated` pre-mig387), D2-5 (3 activated, no event), D2-6 (5 no-op self-transitions). **~80 rows.**

**Why first:** D2-1 is the only finding representing *ongoing corruption* — the install-at-drop write path can still regress an already-`activated` serial back to `installed` today. Every group else is a static gap; this one keeps happening.

**Root cause to confirm:** read `src/modules/procurement/field-stock/services/serialService.ts` and `src/modules/wa-monitor/services/scanSerialService.ts` install-at-drop path. Hypothesis: it sets `status='installed'` unconditionally without consulting `stock_serial_status_transitions`.

**Fix shape:**
- Code: gate the install-at-drop transition on the mig-387 matrix — refuse `activated → installed`, log instead.
- Add a guard so no-op self-transitions (`from=to`) don't write an event.
- Data: correct the 7 stuck serials to `activated` (one-time, after confirming OES is authority for each).

**Verify:** re-run D2-1 query → 0; transition-matrix unit test; dev smoke test of an install-at-drop on an already-activated serial.

---

### Group A — OES→register activation cascade (BIGGEST: ~16,300 rows) → Issue
**Findings:** D1-1 (14,474 OES-active still `in_stock`), D2-2 / D1-3 (240 OES-active stuck `installed` — *same population*), D2-3 (1,624 post-registration OES-active still `in_stock`). **~16,338 rows, ~16,098 distinct after the 240 overlap.**

**Root cause to confirm:** read `src/modules/activate/services/oes/oesPostImportService.ts` + `oesImportService.ts`. Hypothesis: the post-import step advances `oes_pp_data.resolution_status='activated'` but does **not** propagate to `stock_serials.status`, and the 2026-04-02 Sprint-E bulk-created rows were never cascaded.

**Fix shape:**
- Code (forward-looking): on OES import, advance matched `stock_serials` to `activated` via the transition matrix (reusing the Group B guard so it's matrix-safe).
- Backfill (one-time, dry-run first): heal the ~16k historical rows `in_stock`/`installed` → `activated`, writing proper `stock_serial_events`. **Must run *after* Group B ships** so the backfill itself goes through the guarded path and can't create illegal transitions.

**Verify:** D1-1, D2-2, D2-3 queries → 0 after commit; event-history count matches; spot-check 10 serials end-to-end vs OES.

---

### Group C — PP/OES overlap sync (~585 rows) → Issue
**Findings:** D4-1 (245 `located` that are actually activated — overlap understated), D4-3 (57 activated not in `oes_activations`), D4-4 (58 missing `activated_at`), D4-5 (53 drops `oes_confirmed=false`), D1-5 (172 PP-vs-OES drop conflicts).

**Root cause to confirm:** the post-import sync (`oesPostImportService`) does not re-evaluate already-`located` rows, and the `activated_at` / `drops.oes_confirmed` back-propagation isn't firing on newly-matched rows.

**Fix shape:** code fix to re-run resolution for `located_*` rows whose drop is now in `oes_activations`; backfill `activated_at` and `drops.oes_confirmed`. D1-5's 172 drop conflicts need a **business decision** (which source wins) — flag for the activations owner, do not auto-resolve.

**Verify:** D4-1/3/4/5 → 0 (except the business-decision conflicts); overlap count matches SP SoT.

---

### Group D — vlm_corrections referential integrity (~978 rows) → Issue
**Findings:** D5-2 (835 reference dropped `gallery` table), D5-4 (12 dangling `construction_qa_photos`), D5-5 (11 dangling `eod_install_sheets`), D5-3 (115 unlinked `wa_photos`), D5-6 (5 null provenance). D5-1 (4,627 stale VLM values) is **informational** — VLM is recon-only, lower priority.

**Fix shape:** data cleanup (re-point or null the broken `source_table`/`source_id`); add a write-path check that `source_table` references an existing table and at least one of `source_id`/`photo_url` is present; decide ON DELETE behaviour for source rows. Pure-metadata, no production-broadcast impact → lowest urgency among real-data groups.

**Verify:** dangling-reference queries → 0; new-write validation test.

---

### Group E — drops / QA hygiene (~85 rows + investigation) → Issue
**Findings:** D3-2 (3 drop_numbers duplicated 4× = 9 extra rows — **inflates join counts**), D3-1 (73 orphan QA), D3-4 (numeric-vs-DR format drift), **2 `Active` drops with no QA** (the genuinely anomalous slice of D3-3's 165,374, which is otherwise expected `planned` rows).

**Fix shape:** dedup the 9 extra `drops` rows (highest value — fixes the join fan-out that distorts other counts); investigate the 2 Active-no-QA drops; normalize `drop_number` format and consider a uniqueness constraint. The 73 orphan QA need triage (test submissions vs real SOW gaps) — not all are bugs.

**Verify:** `drops` duplicate query → 0; 2 Active drops explained; format-mismatch orphans → 0.

---

## Sequencing summary

```
1. Group B  (code guard + 7 fixes)      → PR → dev verify → prod after-hours
2. Group A  (cascade fix + ~16k backfill, dry-run→commit; AFTER B is live)
3. Group C  (sync fix + backfill; flag 172 conflicts for business decision)
4. Group D  (vlm_corrections cleanup + write-path validation)
5. Group E  (drops dedup + QA triage)
```

B before A is deliberate: A's backfill must flow through B's guarded transition path. Everything is controller-approved and after-hours given the shared prod DB.

## Out of scope here (tracked elsewhere)
- The 2 critical **Telegram broadcast** bugs (audit Dataset 6, D6-1/D6-2) — fixed separately in `~/.hermes/scripts/` (outside this repo); not part of these issues.
- Hardcoded prod DB credential in the Hermes report scripts — credential-hygiene follow-up.
