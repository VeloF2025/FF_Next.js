# Task 7 report — bounded project-statistics orchestration

## Files

- `src/modules/qfield-sync/project-stats/projectStatsService.ts`
- `src/modules/qfield-sync/project-stats/projectStatsAggregation.ts`
- `src/modules/qfield-sync/project-stats/index.ts`
- `src/modules/qfield-sync/project-stats/__tests__/projectStatsService.fixtures.ts`
- `src/modules/qfield-sync/project-stats/__tests__/projectStatsService.test.ts`
- `src/modules/qfield-sync/project-stats/__tests__/projectStatsServiceAggregation.test.ts`

The feature-local aggregation and test-fixture files keep every new file below
the repository's 300-line hard limit.

## TDD evidence

### RED

Command:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/projectStatsService.test.ts
```

Output:

```text
FAIL src/modules/qfield-sync/project-stats/__tests__/projectStatsService.test.ts
Error: Failed to resolve import "../projectStatsService"
Test Files 1 failed (1)
Tests no tests
```

This was the expected missing-production-module failure. No Task 7 production
file existed before the orchestration tests were written and run.

### GREEN

The initial focused GREEN run passed all 15 Task 7 cases. The suite was then
split without behavior changes to satisfy the file-size gate:

```text
Test Files 2 passed (2)
Tests 15 passed (15)
```

The tests cover required resolution, external-QField/FibreFlow identifier
routing, concurrent source startup, source timeouts, primary
`SERVICE_UNAVAILABLE`, optional partial results, safe health messages, planted
state independence, honest MinIO unknowns, genuine missing photos, normalized
cable/drop reconciliation, design coverage, anomaly pagination, section
shaping, freshness, system sync scope, and sensitive-detail exclusion.

## Delivered behavior

- Project resolution completes before source reads start. Resolution errors
  propagate unchanged and no source is called on resolution failure.
- QField, FibreFlow, QA, sync, cached design, and MinIO reads start
  independently and concurrently. QField/MinIO are bounded at 10 seconds; the
  other optional readers are bounded at 5 seconds.
- QField is primary. Its failure or timeout raises a safe
  `SERVICE_UNAVAILABLE` error containing only the request ID. Optional failure
  or timeout produces `partial`, safe source health, warnings, and null affected
  metrics.
- QField, QA, design, and photo readers receive the external QFieldCloud UUID.
  The FibreFlow comparison reader receives the FibreFlow UUID. The internal
  registration UUID is never serialized.
- The Task 5 reducer owns physical pole state. Photo or QA failure cannot change
  planted counts. MinIO failure leaves `presentPhotos` and `missingPhotos`
  `null`; only a successful MinIO read can produce genuine missing-photo counts
  and anomalies.
- Cable and drop identities and compared statuses use trimmed,
  case-insensitive matching without invented status synonyms. Internal maps
  never enter the response.
- Cached design coverage uses normalized unique labels. Freshness is delegated
  unchanged to Task 2. Successful sync statistics retain `scope: "system"` and
  a concise system-wide warning.
- Full aggregates are built before section shaping. Summary returns aggregate
  sections without anomaly items; named sections hide unrelated aggregates;
  only sorted anomaly details are paginated while their total remains global.
- Structured logs contain request/user/project IDs, section, result status, and
  source health only. Business records, labels, responses, errors, credentials,
  and payloads are not logged or serialized through health metadata.

## Verification

Focused Task 7 suites:

```text
Test Files 2 passed (2)
Tests 15 passed (15)
```

All project-stat suites:

```text
Test Files 12 passed (12)
Tests 60 passed (60)
```

Scoped ESLint exited zero for all Task 7 production, helper, fixture, and test
files.

Scoped TypeScript diagnostic:

```text
No project-stats TypeScript diagnostics
```

Staged `npm run ci:quick`:

```text
✓ ESLint: 0 errors, 185 warnings
✓ Silent catches: 78
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

`git diff --cached --check` passed. New file sizes are 269 lines or fewer.

## Self-review

- Re-read the staged diff against every Task 7 brief step and the approved
  design's source-ownership, failure, privacy, pagination, and freshness rules.
- Confirmed all six source promises are created before awaiting any source, and
  their timers are cleared in every result path. A unique timeout sentinel
  prevents an upstream error message from being misclassified as a timeout.
- Confirmed optional source failures do not become empty arrays or zero
  comparison/photo/design metrics. QField-derived physical counts remain usable.
- Confirmed status matching compares exact normalized labels only; drop
  comparison requires both installation and QC status equality.
- Confirmed no comparison map, registration ID, internal error, stack, token,
  customer, address, geometry, photo body, or authorization value appears in the
  response or structured log.
- Mutation check: skipping resolution breaks the resolution test; serial source
  startup breaks the concurrency barrier; wrong timeout/state handling breaks
  timeout tests; wrong IDs break source-routing; coupling planted state to
  QA/MinIO breaks aggregation; zeroing MinIO failure breaks null semantics;
  removing normalization breaks reconciliation; slicing before total breaks
  pagination; returning all sections breaks section privacy.
- No writes, migrations, deploys, production access, or unrelated edits were
  introduced.

## Concerns

- The repository-wide type-check remains red on 58 pre-existing diagnostics
  outside `src/modules/qfield-sync/project-stats`; the scoped Task 7 diagnostic
  is clean and quick CI treats the baseline as non-blocking.
- Vitest emits the repository's existing Vite CJS deprecation warning. All
  focused and project-stat suites exit zero.
