# Task 8 report — Documentation and verification

## Scope

Documented the PR 4 Fleet operational status contract in `.claude/modules/fleet.md`.
No application code, database state, deployment, push, PR, or merge was changed.

## Changed files

- `.claude/modules/fleet.md` — adds the migration 489 contract: status vocabulary and
  precedence, evidence matrix, monitoring/privacy window, provider freshness reuse,
  geometry/coordinate boundaries, rule-version history, server-side scope, and PR 5/6
  boundaries.

`src/modules/fleet/AGENTS.md` was not changed. This task changes the module reference
(`.claude/modules/fleet.md`), not the module's path-scoped canonical
`src/modules/fleet/.claude.md`, so no Fleet mirror output is expected.

## Verification performed

| Command | Result |
| --- | --- |
| `npx.cmd vitest run src/modules/fleet/operations pages/api/fleet/operations` | All 11 suites and 118 tests passed. Vitest then exited non-zero only because its shared `node_modules/.vitest/results.json` cache link targets another worktree and could not be opened (`EPERM`). |
| `npm.cmd run test:migrations -- tests/migrations/489_fleet_operational_status_rules.test.ts tests/migrations/489_fleet_status_geometry.test.ts` | Blocked before collection: the migration harness starts a disposable PostgreSQL Docker container, but `docker` is not installed/available (`spawnSync docker ENOENT`). No shared database was contacted. |
| `npm.cmd run agents:mirror` | Blocked by sandbox `EPERM` on root `AGENTS.md`; it would regenerate unrelated stale repository mirrors. |
| `npm.cmd run agents:check` | Failed due to pre-existing stale generated `AGENTS.md` files throughout the worktree, including root and many modules; Fleet source mirror is unrelated to this documentation change. |
| `npm.cmd run ci:quick` | Windows `bash.exe` shim returned `Access is denied`. Git Bash invocation began but did not complete within 180 seconds in this environment, with no captured gate result. |
| `git diff --check HEAD` | Passed for the Task 8 working-tree documentation change. |
| `git diff --check origin/master...HEAD` | Failed on pre-existing branch file `scripts/migrations/sql/rollback_489_fleet_operational_status_rules.sql:12` (`new blank line at EOF`), not Task 8 docs. |
| Browser/API checks on port 3004 | Blocked: no listener answered `127.0.0.1:3004`, `curl` timed out, and no browser session was available. No live/shared API or database was accessed. |

## Documentation self-review

- The documentation states the engine is read-time and excludes persisted statuses,
  incidents, notifications, payroll, discipline, and driver-input scope.
- It records the status precedence, evidence safeguards, SAST monitoring window,
  geometry semantics, coordinate exposure limits, rule immutability, freshness reuse,
  and server-side project/oversight authorization.
- It explicitly fences PR 4 from PR 5 dashboard/map/incident work and PR 6 driver-facing
  workflows.
- No credentials, private coordinates, or database connection details were added.

## Commit

`f251f193a3377b8ddd5a98faec34b57c2041c119`
`docs(fleet): document operational status engine`

## Limitations / follow-up required

Run migration/PostGIS tests on a machine with Docker, complete `npm run ci:quick` in a
normal Git Bash/CI environment, resolve the branch's existing rollback whitespace failure,
and run the six browser/API cases against a local authenticated app on port 3004 before PR
submission. Capture no private coordinates in the eventual PR body.

---

## Fix round 1 — reviewer findings

### Changes

- `scripts/migrations/sql/rollback_489_fleet_operational_status_rules.sql` — removed
  the trailing blank line that made the whole branch's diff gate fail.
- `.claude/modules/fleet.md` — corrected rule-history GET authorization to
  `fleet.operations-rules:view`; status roster/detail reads remain
  `fleet.operations-status:view`.
- `.claude/modules/fleet.md` — corrected version-history wording: the current
  interval is closed and a new version is inserted; historical threshold values
  are not overwritten.

### Fresh verification

| Command / evidence | Result |
| --- | --- |
| `npx.cmd vitest run src/modules/fleet/operations pages/api/fleet/operations` | Exit 0: 11 files, 118 tests passed. (The earlier shared-cache EPERM did not recur.) |
| `git diff --check feat/fleet-oversight-pr3-operational-assignments...HEAD` | Exit 0 after commit `e37832393`; the former rollback 489 EOF-blank-line finding is resolved. |
| `git show --check e37832393` | Exit 0. |
| Controller: `bash scripts/ci-local.sh --quick` under Git Bash with `/c/Program Files/nodejs` on `PATH` | Exit 0. This corrects the earlier environment-limited report entry. |
| `npm.cmd run agents:mirror -- --dry-run` | Exit 0; 58 generated mirrors, including `src/modules/fleet/AGENTS.md`, would be rewritten. They are unrelated existing drift, so none were written or committed. |
| `npm.cmd run agents:check` | Exit 1, reporting the same 58 stale generated mirrors. This is existing whole-repository mirror drift, not a result of the module-reference update. |

### Still unavailable locally

- Migration/PostGIS test harness cannot start because Docker is unavailable
  (`spawnSync docker ENOENT`); no shared database was accessed.
- Browser plugin initialization returned `No browser is available`; there is no
  usable browser/API verification surface on port 3004.

### Commit and self-review

`e37832393829a3d1cfac541d159dde729f17f779`
`fix(fleet): correct operations status documentation`

The commit contains only the two reviewer-requested corrections. The authorization
wording was checked against `pages/api/fleet/operations/rules.ts`, which applies
`fleet.operations-rules:view` on GET and `fleet.operations-rules:edit` on POST.
No credentials, coordinates, deployment actions, database writes, push, PR, or
merge were performed.

---

## Final review fix wave

### Outcome

Implementation commit: `2e53fba084ea09baa71d997fc5de3edf73509b33`
(`fix(fleet): close operational status review gaps`). This wave changed only the
PR 4 feature worktree. It did not push, open or merge a PR, deploy, or apply a
migration to a shared database.

### Findings closed

1. **Canonical GPS schema (critical).** The production evidence query now reads
   `fleet_vehicle_positions.lat`, `lon`, and `speed_kph`, aliases them at the
   mapper boundary, validates coordinate ranges, and never references the
   nonexistent `latitude`, `longitude`, or `speed_kmh` columns. A new integration
   contract imports and executes the production `loadOperationalEvidence`
   function against representative canonical tables in a disposable scratch
   schema.
2. **Historical Attendance determinism (critical).** The query now uses a
   deterministic lateral lookup ordered by `clock_in_at DESC, id DESC`, restricted
   to `clock_in_at <= asOf`. A clock-out and its coordinates are returned only when
   `clock_out_at <= asOf`, so later same-day state cannot leak into a historical
   decision.
3. **Monitoring/privacy cap.** GPS loads through the earlier of `asOf` and each
   person's `monitoringEnd`. The evaluator also defensively filters evidence to
   that cap. Individual detail emits only the source points needed for its reason
   inside the monitoring window; an outside-window decision emits no coordinates.
4. **Invalid geometry.** Missing, inactive, retired, or invalid AOI/circle
   geometry maps to `siteGeometryValid: false`; no site-ID truthiness fallback
   remains. Invalid vehicle points are marked unusable. The mapping and production
   SQL contract cover retired and absent geometry.
5. **Vehicle assignment ambiguity.** The evidence loader honors the roster's
   selected `vehicle_assignment_id`. Without one, it accepts exactly one effective
   vehicle candidate; multiple candidates map to `assignment.ambiguous`, expose no
   vehicle, and evaluate as `assignment_ambiguous`/`unverifiable`. A missing
   roster-selected assignment becomes a source error instead of an arbitrary pick.
6. **Known wrong-site continuity.** Vehicle wrong-site confirmation now requires
   one continuous, fresh outside sequence at the same normalized known site.
   Attendance known-site normalization works for both AOI and authorized-circle
   geometry and is used independently of raw `site_geofence_id`.
7. **Early departure history.** Vehicle departure is classified from the start of
   the confirmed departure sequence, after a confirmed inside sequence. A departure
   that began before `scheduledEnd` remains `left_early` when `asOf` later advances
   beyond scheduled end.
8. **Status response contract.** Roster/detail services preserve project and site
   labels, expose exact ISO `monitoringStart`, `scheduledStart`, `graceEnd`,
   `scheduledEnd`, and `monitoringEnd` instants, preserve `total` and `hasMore`, and
   include the provider/account-derived `gpsStaleAfterSeconds` metadata. Roster
   summaries remain coordinate-free.
9. **Approach reading floor.** `approachingMinReadings` is now at least 2 in the
   migration constraint, repository validation, rules API parsing, UI field
   metadata/error copy, and corresponding unit/migration tests.
10. **Real integration contract.** `489_fleet_operational_evidence.test.ts` creates
    representative canonical tables in a scratch schema and calls the production
    loader. It covers canonical GPS columns and the monitoring cap, latest
    Attendance as-of selection/future clock-out masking, AOI/circle normalization,
    retired geometry, roster-selected vehicles, and ambiguity. The disposable
    migration harness image was changed to PostgreSQL 15 with PostGIS so its
    geography predicates can execute in CI; no fake or shared database is used.
11. **Documentation/handoff (minor).** Removed the stale machine-specific PR handoff
    document. Fleet ownership now states PR 5 dashboard/map, PR 6 incidents and
    notifications, PR 7 driver input, and PR 8 analytics/retention. It also records
    the monitoring-end GPS and detail-coordinate privacy boundaries.

### TDD evidence

Tests were added before implementation. The first focused RED run failed 7 test
files with 21 failed and 73 passed assertions, including the canonical GPS SQL,
historical Attendance, geometry, ambiguity, departure, response metadata/privacy,
and two-reading rule assertions. A separately added AOI-normalized Attendance case
then failed 1 of 18 evaluator assertions (`late` returned instead of
`wrong_site`). After implementation, the same focused scope is GREEN: 11 files and
131 tests passed.

| Command | Result |
| --- | --- |
| `.\\node_modules\\.bin\\vitest.cmd run src/modules/fleet/operations pages/api/fleet/operations` (RED) | Exit 1: 7 files failed; 21 tests failed, 73 passed. |
| Focused AOI Attendance evaluator case (RED) | Exit 1: 1 test failed, 17 passed; expected `wrong_site`, received `late`. |
| `.\\node_modules\\.bin\\vitest.cmd run src/modules/fleet/operations pages/api/fleet/operations` (final GREEN) | Exit 0: 11 files, 131 tests passed. |
| `.\\node_modules\\.bin\\eslint.cmd pages/api/fleet/operations src/modules/fleet/operations tests/migrations/489_fleet_operational_status_rules.test.ts tests/migrations/489_fleet_operational_evidence.test.ts tests/migrations/setup/global-setup.ts --report-unused-disable-directives` | Exit 0 with no findings. |
| `bash scripts/secret-scan.sh` | Exit 0: no new credential-like content. |
| `git diff --check` and `git show --check 2e53fba08` | Exit 0. |

### Broader verification and blockers

| Command | Result |
| --- | --- |
| `npm.cmd run test:migrations -- tests/migrations/489_fleet_operational_status_rules.test.ts tests/migrations/489_fleet_status_geometry.test.ts tests/migrations/489_fleet_operational_evidence.test.ts` | Blocked before test collection: the disposable harness could not spawn Docker (`spawnSync docker ENOENT`). No shared database was contacted. The harness is now PostGIS-capable for a Docker/CI run. |
| `npm.cmd run ci:quick` | The Windows bash shim returned `Access is denied`. Running `scripts/ci-local.sh --quick` directly in Git Bash completed the lint portions (changed-code lint 0 errors/186 warnings; full lint 0 errors/1114 warnings; silent-catch and Neon-shim gates passed) but exited 1 on pre-existing baseline drift and the Microsoft Store Python alias used by QField checks. |
| `.\\node_modules\\.bin\\tsc.cmd --noEmit --pretty false` | Produced no diagnostics before the 180-second execution limit, so no TypeScript-pass claim is made. |
| `npm.cmd run antihall` | Blocked because the repository script references missing `scripts/antihall-validator.cjs`. |

Remaining verification concern: run the new production-loader/PostGIS contract and
the whole quick-CI script in the normal Docker-enabled Linux CI environment. All
focused PR 4 tests, changed-file lint, secret scan, and whitespace checks are green.

### Residual final-review fix round

Implementation commit: `7fbf824bb` (`fix(fleet): preserve status history boundaries`).

1. **Empty-page pagination.** A nonzero-offset roster page can have no row from
   which to read `COUNT(*) OVER()`. The loader now takes an explicit fallback
   branch only for that case, builds the same roster scope at offset zero with a
   one-row limit, and runs a parameterized count-result query over it. This
   preserves the real `total` while returning an empty `items` array; the status
   service consequently returns the correct total with `hasMore: false` for an
   out-of-range page. Normal non-empty pages retain the six-query batch path.
2. **Interrupted prior arrival.** Departure evaluation previously removed every
   outside point before checking prior-inside continuity, which could join two
   separated inside observations into a false arrival. It now passes the complete
   ordered valid pre-departure fix stream to `continuousHistoricalInside`, so any
   intervening outside fix breaks that sequence.

Strict TDD RED was captured before implementation. The empty-page assertion
returned `{ items: [], total: 0 }` instead of total 42, and the interrupted
arrival case returned `left_early` instead of `late`. The initial combined RED
run reported 7 failures/39 passes because the unconsumed future count mock also
spilled into five later evidence tests; the test setup now resets queued query
implementations between cases. The two requested behavioral failures were the
first pagination failure and the evaluator failure in that output.

| Command | Result |
| --- | --- |
| `.\\node_modules\\.bin\\vitest.cmd run src/modules/fleet/operations/__tests__/evidenceQueries.test.ts src/modules/fleet/operations/__tests__/evaluateStatus.test.ts src/modules/fleet/operations/__tests__/statusService.test.ts` (RED) | Exit 1: target failures reproduced (`total` 0 vs 42; `left_early` vs `late`); 7 failed and 39 passed including the described mock-queue spillover. |
| Same three-suite command (GREEN) | Exit 0: 3 files, 46 tests passed. |
| `.\\node_modules\\.bin\\vitest.cmd run src/modules/fleet/operations pages/api/fleet/operations` | Exit 0: 11 files, 134 tests passed. |
| `.\\node_modules\\.bin\\eslint.cmd src/modules/fleet/operations/evidenceQueries.ts src/modules/fleet/operations/evaluateStatus.ts src/modules/fleet/operations/__tests__/evidenceQueries.test.ts src/modules/fleet/operations/__tests__/evaluateStatus.test.ts src/modules/fleet/operations/__tests__/statusService.test.ts --report-unused-disable-directives` | Exit 0 with no findings. |
| `git diff --check` before commit | Exit 0. |

No database, deployment, push, PR, or merge operation was performed in this
residual round.
