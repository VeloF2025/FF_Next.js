# Task 6 report — uncapped FibreFlow, QA, and system-sync readers

## Files

- `src/modules/qfield-sync/project-stats/fibreflowInfrastructureRepo.ts`
- `src/modules/qfield-sync/project-stats/qfieldQaRepo.ts`
- `src/modules/qfield-sync/project-stats/qfieldSyncStatsRepo.ts`
- `src/modules/qfield-sync/project-stats/qfieldDesignRepo.ts`
- `src/modules/qfield-sync/project-stats/__tests__/fibreflowInfrastructureRepo.test.ts`
- `src/modules/qfield-sync/project-stats/__tests__/qfieldQaRepo.test.ts`
- `src/modules/qfield-sync/project-stats/__tests__/qfieldSyncStatsRepo.test.ts`
- `src/modules/qfield-sync/project-stats/__tests__/qfieldDesignRepo.test.ts`

## TDD evidence

### RED

Command:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/{fibreflowInfrastructureRepo,qfieldQaRepo,qfieldSyncStatsRepo,qfieldDesignRepo}.test.ts
```

Output:

```text
Test Files  4 failed (4)
Tests  no tests
```

Each suite failed at its production import because the matching reader module
did not exist. This was the expected missing-feature failure; no Task 6
production file existed before the run.

### GREEN

The same command passed after the minimal readers were implemented:

```text
Test Files  4 passed (4)
Tests  15 passed (15)
```

The tests use injected database runners and hand-derived literals. They verify
the real query/result boundary without connecting to a database: exact selected
fields, parameter arrays, absence of uncapped aggregate limits, concurrent query
startup, numeric conversions, internal comparison maps, external-QField QA
scope, signed-in email scope, honest system scope, and cache-only design reads.

## Delivered behavior

- FibreFlow poles use a grouped count; cable and drop comparisons read every
  matching row with only normalized identity and status fields. Blank identities
  stay in totals and distributions but are excluded from comparison maps with a
  warning. The three reads start concurrently and contain no `LIMIT`.
- QA uses `qfield_photo_validations.project_id::text = $1`, where the caller must
  pass the external QFieldCloud UUID. The signed-in email is `$2` only in the
  personal queue aggregate. Summary, confidence, work-type, and priority reads
  start concurrently; every count becomes a JavaScript number.
- Sync reads current job metadata, completed/error aggregates, and unresolved
  conflict count concurrently. It accepts no project argument, adds no project
  predicate, selects no error/conflict payload fields, and always returns
  `scope: "system"`.
- Design lookup performs one parameterized `SELECT` against
  `qfield_pole_pon_cache`. It never imports or invokes the resolver, fetches a
  GPKG, or writes cache state. No row returns unavailable design data; malformed
  cache payloads reject as source failures for Task 7 to handle.

## Verification

Focused Task 6 tests:

```text
Test Files  4 passed (4)
Tests  15 passed (15)
```

All project-stat tests:

```text
Test Files  10 passed (10)
Tests  45 passed (45)
```

Scoped ESLint exited zero with no diagnostics for all eight Task 6 source/test
files.

Scoped TypeScript diagnostic:

```text
No project-stats TypeScript diagnostics
```

Production file sizes are 150, 117, 94, and 67 lines; every file is below the
300-line limit.

Final staged `npm run ci:quick`:

```text
✓ ESLint: 0 errors (≤0), 185 warnings (≤185)
✓ Silent catches: 78 (≤78)
✓ Neon-shim SQL divergence: none
✓ QField step detection: all checks pass
✓ QField GPKG resolution: all checks pass
✓ QField hierarchy mapping: all checks pass
⚠ TypeScript: 58 errors (pre-existing, non-blocking)
✓ Zero Tolerance: changed files clean
✓ Secret scan: no new credential-like content
✓ CI PASSED
Passed: 8  Failed: 0  Warned: 1  Skipped: 2
```

`git diff --cached --check` passed with no whitespace errors.

## Self-review

- Re-read the staged implementation against every Task 6 brief step and the
  approved design's failure/privacy semantics.
- Confirmed all SQL inputs use positional parameters and no identifier is
  interpolated.
- Confirmed aggregate inputs are uncapped. The only `LIMIT` clauses are the
  required single current-sync-job row and latest verified-design-cache row.
- Confirmed QA receives the external QField UUID by contract and never resolves
  or substitutes the internal registration/FibreFlow UUID.
- Confirmed system sync queries have no parameter or project predicate.
- Confirmed no customer, address, geometry, notes, photo body, sync error array,
  conflict values, token, credential, or connection string is selected or
  logged.
- Confirmed all production queries are read-only, independent reads are
  concurrent, and there is no `console.log`, empty catch, migration, deploy, or
  unrelated edit.

## Concerns

- The Vitest runner emits the repository's existing Vite CJS deprecation
  warning; all requested tests still exit zero.
- Repository-wide TypeScript diagnostics remain a pre-existing non-blocking
  quick-CI baseline. The filtered project-stat diagnostic is clean.
