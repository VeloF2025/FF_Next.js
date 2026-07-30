# Task 5 report — QField physical and field-delivery state reducer

## Files

- `src/modules/qfield-sync/project-stats/featureState.ts`
- `src/modules/qfield-sync/project-stats/featureStateDefaults.ts`
- `src/modules/qfield-sync/project-stats/__tests__/featureState.test.ts`

## TDD evidence

### RED

Command:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/featureState.test.ts
```

Output:

```text
FAIL  src/modules/qfield-sync/project-stats/__tests__/featureState.test.ts
Error: Failed to resolve import "../featureState" from
"src/modules/qfield-sync/project-stats/__tests__/featureState.test.ts".
Does the file exist?
Test Files  1 failed (1)
Tests  no tests
Duration  1.70s
```

The failure was the expected missing-production-module failure. No
`featureState.ts` existed when the seven specified behavior tests were run.

### GREEN

Command:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/featureState.test.ts
```

Output:

```text
✓ src/modules/qfield-sync/project-stats/__tests__/featureState.test.ts  (7 tests) 16ms
Test Files  1 passed (1)
Tests  7 passed (7)
Duration  1.70s
```

Final focused reruns remained green after refactoring the production file below
the size gate:

```text
✓ src/modules/qfield-sync/project-stats/__tests__/featureState.test.ts  (7 tests) 14ms
Test Files  1 passed (1)
Tests  7 passed (7)
```

## Semantic decisions

- Pole physical, photo-completeness, and QA state are independent. Only the
  three explicit planting states plant a pole, and only the two explicit
  removal/cancel states unplant it. Applied QA, photo, WIP, optical, and unknown
  events never change physical state.
- Histories replay only `lastStatus === "applied"` events in timestamp-and-ID
  order. A stuck/error twin beside an applied history is a stale duplicate; a
  history with no applied event is recoverable/stuck.
- Feature identity is kind-prefixed (`pole:localPk`, `cable:localPk`,
  `drop:localPk`). Pole-quality events preferentially attach to an existing pole
  history even when a cable reuses the same local key. Other ambiguous untyped
  events are not guessed and produce `unknown_status` anomalies.
- Pole status distributions use the complete latest applied source label.
  Unknown applied labels remain visible and produce anomalies.
- Photo headline counts include only finally planted poles. A planted pole with
  no recognized photo state remains planted and creates a visible count gap
  rather than being forced into complete or incomplete.
- Cable totals remain feature-history based. Only finite, non-negative latest
  applied lengths are summed; comparison identities are normalized while source
  status labels remain intact. Missing or duplicate comparison identities
  produce mapping anomalies.
- Drop totals use normalized `dropNumber` business identities. Duplicate local
  identities collapse to the latest applied timestamp-and-ID state and produce
  one `sync_mismatch` anomaly. Installation/QC distributions preserve source
  labels; only exact Installed/Planned/In Progress and Approved/Pending/Failed
  values feed headline counters.
- Internal comparison maps contain only normalized identities and projected
  statuses. Pole photo-key and civil-label sets contain no photo bodies,
  addresses, customer fields, or geometry.

## Verification

Focused lint:

```bash
npx eslint src/modules/qfield-sync/project-stats/featureState.ts \
  src/modules/qfield-sync/project-stats/__tests__/featureState.test.ts
```

Result: exit 0, no diagnostics.

All project-stat tests:

```text
Test Files  6 passed (6)
Tests  24 passed (24)
Duration  833ms
```

Scoped TypeScript diagnostic:

```text
No project-stats TypeScript diagnostics
```

Final staged quick CI:

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

`git diff --check` passed. The production file is 293 lines.

## Self-review

- Re-read the staged diff against every Task 5 requirement.
- Confirmed deterministic ordering and duplicate winner selection use both
  timestamp and ID; applied drop candidates outrank newer non-applied twins.
- Confirmed no failed, pending, QA, photo, or unknown event can unplant a pole.
- Confirmed the seven tests use hand-derived literal counts and real reducer
  behavior; no mocks, production helpers, or computed expectations are used.
- Mutation check: removing physical-state independence breaks tests 1-2;
  collapsing kind identity breaks test 4; ignoring stale twins breaks test 3;
  dropping source labels/anomalies breaks tests 5-6; failing stable drop
  deduplication/latest-state selection breaks test 7.
- Confirmed there are no writes, migrations, logging, credentials, or unrelated
  edits.

## Concerns

- The repository-wide `npm run type-check` remains red on 58 pre-existing
  diagnostics outside `src/modules/qfield-sync/project-stats`. The requested
  filtered project-stats diagnostic is clean, and `ci:quick` treats the baseline
  diagnostics as non-blocking.

## Fix round 1

### Review findings addressed

1. Pole QA/photo events now use a closed assignment branch. They attach only
   when the same local key has a pole candidate; they never fall through to a
   cable or drop solely because that is the only candidate.
2. Cable and drop current totals, distributions, and comparison maps now require
   a latest applied row. Error-, pending-, and other non-applied-only histories
   remain visible through `stuck` anomalies without entering current state.
3. Unknown non-null drop installation/QC projections remain in the complete
   source distributions and emit `unknown_status` anomalies whose `status`
   preserves the exact trimmed source label.
4. Distinct normalized cable/drop identities within one applied local history
   emit `sync_mismatch`; the latest applied identity remains the comparison key.
5. Cable length now uses only the latest applied projection. A negative,
   non-finite, or missing latest value cannot inherit an older valid value;
   invalid values, and missing values that replace older valid values, emit a
   `sync_mismatch` anomaly.

The zero-value stat factories moved without behavior changes into the
feature-local `featureStateDefaults.ts` module so every production file remains
below 300 lines.

### TDD RED

Command:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/featureState.test.ts
```

Output:

```text
❯ src/modules/qfield-sync/project-stats/__tests__/featureState.test.ts
  (13 tests | 6 failed) 15ms
  → expected { 'Q/A Failed': 1 } to deeply equal { 'String Complete': 1 }
  → expected 1 to be +0
  → expected [] to deeply equal ArrayContaining
  → expected [] to deep equally contain ObjectContaining (cable identity)
  → expected [] to deep equally contain ObjectContaining (drop identity)
  → expected 120 to be null
Test Files  1 failed (1)
Tests  6 failed | 7 passed (13)
Duration  723ms
```

Each failure corresponded directly to one review regression; the seven original
Task 5 behavior tests remained green.

### GREEN and verification

Focused reducer:

```text
✓ src/modules/qfield-sync/project-stats/__tests__/featureState.test.ts
  (13 tests) 9ms
Test Files  1 passed (1)
Tests  13 passed (13)
Duration  744ms
```

All project-stat tests:

```text
Test Files  6 passed (6)
Tests  30 passed (30)
Duration  773ms
```

Scoped ESLint returned exit 0 with no diagnostics for:

- `featureState.ts`
- `featureStateDefaults.ts`
- `featureState.test.ts`

Scoped TypeScript output:

```text
No project-stats TypeScript diagnostics
```

Staged `npm run ci:quick`:

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

`git diff --check` passed. Production file sizes are 298 and 53 lines.

### Fix-round self-review

- Re-read all five review findings against the staged diff and exercised each
  through the real reducer, with literal expectations and no mocks.
- Confirmed unassigned pole-quality events produce a visible anomaly while the
  cable/drop history retains its own latest applied status.
- Confirmed `inspectHistory` runs before non-applied cable/drop histories are
  excluded, preserving their stuck anomaly.
- Confirmed identity-change detection compares normalized applied values within
  one kind-prefixed local history; case/whitespace-only differences do not
  create false mismatches.
- Confirmed drop projection labels are preserved exactly in distributions and
  anomaly status fields while headline mappings stay closed.
- Confirmed invalid/missing latest cable length cannot be replaced by an older
  history value.
- Confirmed no writes, migrations, logging, credentials, or non-Task-5
  production files were changed.

### Fix-round concerns

- The same 58 pre-existing repository-wide TypeScript diagnostics remain the
  only warning. The scoped project-stats diagnostic and staged changed-file gate
  are clean.
