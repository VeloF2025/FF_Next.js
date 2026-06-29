# Auto-QA Coverage Hardening — Design

**Date:** 2026-06-29
**Branch:** `feat/auto-qa-coverage-hardening`
**Goal:** Guarantee every in-scope DR gets an auto-QA *decision* so the existing auto-feedback cron sends it — and ensure no DR can silently retry forever or be starved out.

## Problem

The auto-QA pipeline has two crons:
- `/api/cron/auto-qa` (every 5 min) → `findEligibleDRs` → `processOneDR` → writes a decision.
- `/api/cron/auto-feedback` (every 5 min) → auto-sends the feedback ~30 min after the decision. **This side already works** (verified 2026-06-29: 56 FAIL feedbacks auto-sent), gated by `system_flags.auto_feedback_enabled` and a `2026-06-09` cutoff that protects the pre-cutover backlog.

The leak is entirely on the **decision** side, via two defects in `src/modules/activate/services/autoQaProcessor.ts`:

1. **Poison-pill:** `processOneDR`'s catch block only logs and returns `{success:false}`. It never marks the DR or counts the failure, so a DR that throws is retried **forever, invisibly, and never sent**. This produced 15 DRs stuck since 2026-05-30.
2. **Starvation:** `findEligibleDRs` orders `auto_qa_eligible_at DESC LIMIT n` (newest-first), so during a burst the oldest overdue DRs are served last.

DRs blocked by *missing inputs* are explicitly **out of scope** (a re-run can't fix them): no-photos (need photo refetch), non-WhatsApp (no WA recipient — auto-feedback skips them), and the pre-`2026-06-09` backlog (human-only by policy).

## Design

Surgical: **one migration + edits to one file (`autoQaProcessor.ts`). No new cron.**

### 1. Migration `scripts/migrations/sql/432_auto_qa_attempts.sql`
Additive, backward-compatible (safe on the shared dev+prod DB):
```sql
ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS auto_qa_attempts        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_qa_last_error      TEXT,
  ADD COLUMN IF NOT EXISTS auto_qa_last_attempt_at TIMESTAMPTZ;
```
Existing rows get `0`/NULL; nothing reads them until the new code runs.

### 2. `findEligibleDRs` — fair, bounded, skips poison-pills
- Add `AND COALESCE(auto_qa_attempts,0) < MAX_AUTO_QA_ATTEMPTS` (default **5**) → parks a repeatedly-failing DR after 5 tries instead of retrying forever.
- Add `AND auto_qa_eligible_at >= NOW() - INTERVAL '2 days'` → the **2-day rolling window** (honors "today onward, don't dredge the backlog"; a poison-pill hits the cap in ~25 min, long before 2 days).
- Change `ORDER BY auto_qa_eligible_at DESC` → **`ASC`** (oldest-first within the window → no starvation).

### 3. `processOneDR` — count attempts, capture errors
- At entry: `UPDATE … SET auto_qa_attempts = auto_qa_attempts + 1, auto_qa_last_attempt_at = NOW()` (counts even if it throws mid-way).
- In the catch block: also persist `auto_qa_last_error = <message>` so a failing DR both climbs toward the cap and surfaces *why*.
- On success: unchanged (`persistAutoQaResults` marks it processed).

### Why no separate 2-hourly sweep (recommendation — confirm)
The existing 5-min cron, once hardened, **is** the self-healing sweep — oldest-first within the 2-day window, skipping parked DRs, running ~24× more often than every 2h. A separate job would be redundant, add a new crontab line (which would re-use the already-leaked `CRON_SECRET`), and process the same rows. **Recommendation: skip it.** If you want a distinct scheduled job anyway, we add a thin `/api/cron/auto-qa-sweep` wrapper — say the word.

## Visibility
Parked DRs are queryable without new UI:
`SELECT drop_number, auto_qa_attempts, auto_qa_last_error FROM dr_photo_unified_reviews WHERE auto_qa_attempts >= 5 AND auto_qa_processed = false;`
A dashboard surface is explicitly out of scope for this change.

## Out of scope
- no-photos DRs (handled by `refetch-missing-photos` cron) and non-WA DRs (no recipient).
- pre-`2026-06-09` backlog (human-only; protected by the auto-feedback cutoff).
- Any change to auto-feedback sending behavior.

## Testing
- Unit-test `findEligibleDRs` SQL conditions (attempt cap, 2-day window, ASC order) and `processOneDR` (increment on entry, error captured on throw, parked at cap, untouched on success). Extend existing `autoQaProcessor.*.test.ts`.
- `npm run ci:quick` green before PR.

## Rollout
- Migration ships *inside* the PR; applied by the migration runner at **deploy** (Hein), not run ad-hoc against the live DB.
- No data backfill needed. Going forward, any DR that fails **within the 2-day window** accumulates attempts on each cron tick and parks after 5 — surfacing it via the `auto_qa_attempts >= 5 AND auto_qa_processed = false` query.
- The pre-existing stuck DRs (e.g. the 15 since 2026-05-30) are **older than the 2-day window**, so `findEligibleDRs` does not select them — they keep `auto_qa_attempts = 0` and are *not* auto-processed by this change. That is intended: they fall in the pre-`2026-06-09` backlog that is human-only by policy (see *Out of scope*). Clearing that backlog, if wanted, is a separate one-off operator action, not part of the rolling window.
