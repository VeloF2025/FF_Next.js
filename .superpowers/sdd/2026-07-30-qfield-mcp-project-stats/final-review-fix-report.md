# Final review fix report — round 1

**Date:** 2026-07-30

**Starting HEAD:** `36744b2cae5e4d150d5e1d0015369646004f2c00`

## Outcome

Both IMPORTANT findings and all requested low-risk minors were addressed without
deploying, pushing, mutating a pull request, changing a database schema, or
running token-gated smokes.

The fixed endpoint remains `/api/qfield/project-stats`; the curated adapter still
delegates through `_fibreflow_get_sync`, retaining its per-user credential,
read-only, rate-limit, path, denied-group, timeout, and response-size guards.

## Live optical research

A read-only query against the live QFieldCloud `core_delta` status projection
found exactly:

- `Optical Complete`: 1,203 rows;
- `Optical WIP`: 14 rows.

The existing reconciliation repository already recognizes exact
`Optical Complete`. The existing civil sync script and cron documentation
identify `To be Planted` as the live civil pre-plant marker.

The reducer therefore uses a closed optical set containing only
`Optical Complete` and `Optical WIP`. It does not use an `Optical ` prefix or
otherwise treat arbitrary future labels as known.

## Implemented fixes

### Feature state

- Added an explicit ignored `optical` feature kind.
- Kept optical histories separate from pole, cable, and drop histories even
  when `localPk` collides.
- Excluded known optical-only histories from asset totals and anomalies.
- Classified exact `To be Planted` as a known civil/pole event.
- Counted that state in pole `qfieldTotal`, `byStatus`, and civil labels while
  leaving physical `planted` false.
- Split feature-status constants and classification into `featureStatus.ts`;
  `featureState.ts` is 285 lines.

### Projection and validation boundaries

- Blank and whitespace cable length now project to `null`, not numeric zero.
- QField delta projection tests cover old-only values, missing `localPk`,
  invalid/non-finite/blank lengths, and valid zero.
- Design cache validation now requires finite numeric `designPons`, nonblank
  pole labels, and a record per mapping with finite numeric `pon` plus
  `zone: string | null`.
- FibreFlow pole status rows now accumulate when SQL-emitted keys collide.
- `page` must convert to a finite safe integer. There is no arbitrary small
  page cap; `limit` retains its existing maximum.

### MCP observability

The curated tool now emits one stdlib logging event per invocation with only:

- tool name and requested section;
- OAuth `client_id` from the current access-token context, when present;
- total duration;
- controlled result category: `complete`, `partial`, `unavailable`, or `error`;
- a safe response-metadata request ID, otherwise a generated local invocation
  ID; and
- a controlled error category.

No identity lookup was added. The FibreFlow token, MCP access token, project
query, business payload, query credential, raw response body, and exception text
are not projected into the event.

### Audit artifacts

- Task 5's top file list now includes `featureStateDefaults.ts`.
- Task 11 records the actual integrated `origin/master` SHA:
  `e49b84bb8f5815cde2c553b25fc3aac77c5f4d57`.

## Strict TDD evidence

Each behavior was observed failing before its production fix:

| Boundary | RED evidence | Focused GREEN |
|---|---:|---:|
| Optical kind, collision, pre-plant civil state | 4 failed / 4 | 17 passed / 17 including existing reducer suite |
| Delta length projection | 2 failed / 8 | 8 passed / 8 |
| Design cache validation | 9 failed / 16 | 16 passed / 16 |
| FibreFlow emitted-key collision | 1 failed / 4 | 4 passed / 4 |
| Safe page parser and API | 3 failed / 21 | 21 passed / 21 |
| MCP safe observability | 6 failed because implementation was absent | 18 passed / 18 |

The failures matched the intended regressions; existing focused behavior stayed
green except for the new assertions.

## Verification

### Project statistics and API

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__ \
  tests/api/qfield/project-stats.test.ts
```

Result: 14 test files passed, 97 tests passed, 0 failed, 0 skipped.

### Complete offline MCP

```bash
env -u FF_DEV_TOKEN FF_MCP_CALLBACK_SECRET=test-secret \
  python3 -m pytest apps/ff_mcp/ -q
```

Result: 85 passed, 1 skipped. The sole skip is the deliberately opt-in live DEV
test requiring `FF_DEV_TOKEN`, which was explicitly unset.

### Static checks

- Scoped ESLint: exit 0, no diagnostics.
- Scoped TypeScript: no QField project-statistics or API diagnostics.
- `python3 -m compileall -q apps/ff_mcp`: exit 0.
- `git diff --check`: exit 0.
- All authored files are below 300 lines; the largest production file is
  `featureState.ts` at 285 lines and the Task 5 audit report is 279 lines.

### Staged quick CI

```text
ESLint: 0 errors, 185 warnings at accepted baseline
Silent catches: 78 at accepted baseline
Neon-shim SQL divergence: none
QField step, GPKG resolution, hierarchy mapping: pass
TypeScript: 58 pre-existing errors, non-blocking
Zero Tolerance: changed files clean
Secret scan: no new credential-like content
Passed: 8  Failed: 0  Warned: 1  Skipped: 2
```

## Remaining concerns

- Repository-wide TypeScript still reports the accepted 58 pre-existing
  diagnostics outside this feature; the scoped feature/API diagnostic is clean.
- The one live MCP test remains intentionally skipped because `FF_DEV_TOKEN` was
  unset. No token-gated smoke was attempted.
- No database-timeout recommendation was attempted, per task scope.
- No deployment was performed.
