# Fleet Driver Oversight stage 8 — Session Handoff

> **Date:** 2026-08-25
> **Continue with:** Check CI on #2614 and #2618 (both were re-pushed for a migration renumber), then chase review/merge of the seven open PRs in the order below. Do NOT create the operational roster — that is held for Hein.
> **Plans:** `docs/superpowers/plans/2026-08-11-fleet-oversight-pr8-timelines-analytics-retention.md` on branch `feat/fleet-driver-oversight-design`

---

## What We Did Today

### 1. Finished every remaining task in the PR8 plan
Stage 8 tasks 8, 9 and 10 (docs half) are built. Seven PRs open, all authored by **Zander1798** — note that is not Hein's account, so they will not appear in his own PR list.

| PR | Task | Base |
|---|---|---|
| #2610 | SAST history-window fix | `master` |
| #2611 | Task 8 — Excel export | `master` |
| #2612 | Task 9a — analytics UI | `feat/fleet-oversight-pr8-export` |
| #2614 | Coverage gate + migration **530** | `master` |
| #2615 | Task 9b — settings API + hold panel | `master` |
| #2616 | Task 9b — settings dialog section | `feat/fleet-oversight-pr8-retention-settings` |
| #2618 | Task 10 — runbook + roster gap | `master` |

### 2. Found and fixed a nightly production outage (#2610)
`fleet_operational_monitor_runs` had 96 failures, **all** at UTC hours 22 and 23 — exactly SAST 00:00–01:59. `monitorService` derives `workDate` in SAST; `statusService.validate()` compared it against **UTC** midnight. A SAST day starts at 22:00Z, so for two hours every night `asOf` preceded the work date's own start, `ageDays` went negative, and the guard rejected the run. Fixed via `sastStartOfWorkDate` in `operations/timeRules.ts`.

### 3. Discovered the whole feature is starved
Zero incidents all-time; `roster_evaluated_count = 0` on every one of 2153 successful monitor runs. Not a bug — no operational site has ever been created, so there is no roster to evaluate. Confirmed in the deployed UI that the path works and the AOI list is already populated. It is **data entry**, not a code gap.

### 4. Closed the coverage-gate defect (#2614)
The old gate inferred coverage from stored aggregate rows, but a correctly-aggregated month can publish **zero** rows — those months reported no coverage forever and could never be purged. Migration 530 records coverage explicitly, written inside `replaceMonth`'s transaction on every path.

### 5. Caught a migration number collision (late in the session)
Hein opened **#2617 (528)** and **#2619 (529)** while this work was in progress. My coverage migration was also 528. Renumbered mine to **530** across the SQL, the rollback, the fixture, and both docs. Each PR passed CI individually because `check-migration-versions.mjs` only sees its own checkout.

---

## All Decisions Made (don't re-litigate)

| Decision | Outcome |
|---|---|
| Export sheet grain | Screen grain only — Summary / Monthly Trends / Metadata. **No per-incident sheet**; the drill-down returns ids only, and a detail sheet would need a new fact→row mapper and a name lookup. |
| Task 9 as one PR | **Split.** 15 files across three surfaces is not one reviewable PR. Became 9a (#2612), 9b API+panel (#2615), 9b dialog (#2616). |
| Migration number for the coverage gate | **530.** 528 and 529 are Hein's. |
| Who renumbers on collision | **Mine.** His two form a stack already consistent at 528/529; renumbering them means touching two PRs. |
| Shortening-retention gate | An `acknowledgedDryRunId` naming a real `dry_run = true` run — **not** a boolean. A boolean proves only that somebody clicked past a warning. |
| Hold owner default | **Not** defaulted to the creator. `createdBy` already records who placed it; a legal hold's owner is often not the manager who noticed the incident. |
| Metric labels in the export | Raw metric keys. A label map would have to stay in sync with a UI that did not exist at the time. The **UI** does label them, from `incidentLabels.ts`. |
| Roster creation | **Held for Hein.** Creating it starts automated oversight of named employees. |
| `AGENTS.md` mirror churn | Never commit it. See gotcha 3. |

---

## What's Next (in order)

### Step 1 — Re-check CI on #2614 and #2618 (FIRST)
Both were pushed again after the 528→530 renumber, so the green runs recorded earlier are stale.
```bash
gh pr checks 2614; gh pr checks 2618
```
Success condition: `Lint, type-check, unit tests = pass` on both. If #2614 fails, look at the step named **"Migration tests — real Postgres (gate)"** — that gate is the only thing that executes migration 530, and it has already caught one real fault this session.

### Step 2 — Get the seven reviewed and merged
Independent reviewer per the standing rule; never self-review. Merge order:
1. #2610, #2611, #2615, #2618 — any order, all target `master`
2. #2612 and #2616 — they retarget to `master` automatically when their bases merge
3. #2614 — any time, **but see Step 3**

### Step 3 — Apply migration 530 BEFORE #2614's code deploys
The retention cron is live (5 runs, latest 2026-08-25 03:30 SAST). Deploying the coverage-gate code first makes the nightly run fail on a missing relation. It fails **closed** — nothing is deleted — but loudly, every night. Sequence is in the runbook.

### Step 4 — Roster (Hein only, not the agent)
A ready-to-use brief was written for him this session. It covers the exact UI path, a suggested one-site/one-team first scope, verification queries, and the warning that 10 enabled rules start notifying 4 oversight members within minutes. **Do not do this on his behalf.**

### Step 5 — Task 10's browser-verification half
Blocked until a roster exists. Five of the seven PRs ship with no browser evidence for exactly that reason. Once data exists, verify #2611, #2612, #2615, #2616 against it.

---

## Key Files to Know

| File | Purpose |
|---|---|
| `.claude/modules/fleet-analytics-disclosure.md` | **Read before touching the aggregate read path.** Section 3 items are still open. |
| `docs/operations/fleet-analytics-retention-runbook.md` | New. Schedules, going-live sequence, readback queries, rollback. |
| `src/modules/fleet/incidents/analytics/operationsFilters.ts` | The single `op_` parser. Three callers: analytics, drill-down, export. Never write a second one. |
| `src/modules/fleet/operations/timeRules.ts` | Owns the SAST offset. `sastStartOfWorkDate` is the fix from #2610. |
| `src/modules/fleet/incidents/analytics/retentionSettingsValidation.ts` | Bounds mirroring migration 518's CHECKs, plus the shortening gate. |
| `scripts/migrations/sql/530_fleet_aggregate_month_coverage.sql` | The coverage table. Not applied anywhere yet. |

---

## Current State of Dev

| Item | Status |
|---|---|
| dev.fibreflow.app | Running `master`; none of the seven PRs deployed |
| Migrations 518 / 521 / 527 | ✅ applied on shared DB |
| Migration 530 | ❌ not applied, not merged |
| Operational roster | ❌ 0 sites, 0 assignments — the roster-driven half is starved |
| Incidents — roster-driven | ❌ none; roster is empty |
| Incidents — telematics (PR4, #2624) | ✅ LIVE; 1 critical `theft_after_hours_movement` open as of 2026-08-26 |
| Live retention (deletion) | ✅ OFF (`live_retention_enabled = false`) and the cron wrapper has no switch |
| Monitor cron | ✅ running every few minutes, evaluating nobody |
| Aggregation cron | ✅ running nightly, writing 0 rows (correctly) |
| Browser evidence for stage-8 UI | ❌ none — nothing to render |

---

## To the AI Reading This Tomorrow

1. **Do not create the operational roster.** It puts named employees under automated oversight and notifies four real people within minutes. Held for Hein, deliberately, after an explicit decision.
2. **Re-check CI before telling anyone these are ready.** Two PRs were reported green earlier in the session and were later found red; the fixes are pushed but the latest runs need confirming. Check the *step*, not just the rollup.
3. **`npm run agents:mirror` rewrites all 58 `AGENTS.md` mirrors with LF endings and every content diff is empty.** `agents:check` then calls them all stale — against `master` too. It is the `core.autocrlf` trap. Run `git checkout -- '*AGENTS.md' AGENTS.md` afterwards and only commit a mirror whose `git diff --numstat` is non-zero.
4. **`migrationContract.test.ts > rollback 518` fails on this Windows box and only this box** — CRLF vs the `\n` the test asserts on. It passes on the Linux runner. Do not "fix" it.
5. **`npm run ci:quick` aborts at Gate 2d** (Python not installed), so Gates 3 and 4 never run. Run them by hand: `npx tsc --noEmit` (baseline is **76** errors) and `bash scripts/zero-tolerance-changed.sh --range origin/master HEAD`.
6. **The tracked git hooks are not installed on this clone** — `core.hooksPath` points at an empty `.git/hooks`, so pre-commit/pre-push secret scanning does not run. Scan by hand: `bash scripts/secret-scan.sh --range origin/master <branch>`.
7. **Push from the worktree, not the main checkout.** A bare `git push` from `C:\Users\zande\Documents\AI Workspace\FF_Next.js` pushes whatever branch that checkout is on — it recreated the merged `feat/fleet-parking-approval-queue` on the remote this session. That stale branch is still there awaiting a decision to delete it.
8. **Re-check migration numbers every single time**, including immediately before pushing. Two collided this session because both were opened the same day.
9. Working discipline that paid off repeatedly: failing test first; prove every forbidding test by breaking what it guards; `npx tsc --noEmit` before each commit. Roughly 60 mutations were run this session and each caught its intended test — several caught real defects in my own first drafts.
