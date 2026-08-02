# Task 13 evidence — authoritative attendance reports

Status: implemented and verified on the fixed Task 13 base `730e9d4ef`.

## Scope and authority

- Added `exception-ageing`, `payroll-readiness`, and `evidence-quality` to the existing report catalogue and dispatcher.
- Reused the existing report API/export result (`rows`, `columns`, `notes`), so screen, CSV, and XLSX consume the same ordered columns and row values.
- `scopedStaffIds=[]` returns no rows. The new reports retain their column schema for empty supervisor scope so empty CSV/XLSX exports keep the same headers as the screen.
- `scopedStaffIds=null` remains explicit organisation scope. A non-null list is always applied as an authoritative `staff_id = ANY(...)` predicate.
- No database, migration, deploy, production, message-send, browser, or rebase action was performed.

## Superdesign gate

CLI authentication was confirmed before the UI edit.

- Project/canvas: https://superdesign.dev/teams/06297687-01a4-4a6a-886f-fdd0fe4d771f/projects/74263e03-5848-47fa-913c-18e5813465b9
- Pixel-faithful reproduction: https://p.superdesign.dev/draft/d5f8cb3c-b3bb-47de-8635-170206e73b4e
- Selected single branch variation: https://p.superdesign.dev/draft/0d80744d-7fbe-482e-a9fc-97da7b3be9b0

Both drafts were read back with `get-design`. The variation preserved the established FibreFlow layout and report-card system while replacing the misleading late-arrivals deferral with the three policy-backed catalogue entries. The real page/import tree and design tokens were inspected before editing. One initial CLI request exceeded the 20-file context limit; it was retried once with 20 files.

## RED evidence

Initial catalogue/UI RED:

```text
npx vitest run src/services/attendance/reports/__tests__/catalogueWiring.test.ts
Test Files  1 failed (1)
Tests       4 failed | 3 passed (7)
```

The failures were the three absent report slugs/catalogue definitions plus the page still lacking the three policy-backed titles.

Initial module RED:

```text
npx vitest run src/services/attendance/reports/__tests__/catalogueWiring.test.ts \
  src/services/attendance/reports/__tests__/exceptionAgeing.test.ts \
  src/services/attendance/reports/__tests__/payrollReadiness.test.ts \
  src/services/attendance/reports/__tests__/evidenceQuality.test.ts
Test Files  4 failed (4)
```

The three module imports did not resolve and the catalogue/UI assertions remained RED.

Mutation-sensitive follow-up RED tests also caught and drove fixes for:

- missing daily summaries not being counted as blocked because of SQL three-valued logic;
- wholly unavailable evidence being labelled `partial`;
- empty supervisor scope losing the stable report/export column schema;
- an unresolved `open` exception being assigned to HR instead of the supervisor action queue;
- latest lock history not being ordered by lock version first;
- readiness not requiring an active weekly lock and the absence of unresolved day blockers.

## Implemented contracts

### Exception ageing

- Unresolved-only statuses: `open`, `awaiting_worker`, `awaiting_supervisor`.
- SAST calendar age is derived from persisted `created_at`; work dates use `TO_CHAR(..., 'YYYY-MM-DD')`.
- `awaiting_worker` links to the worker correction journey; `open` and `awaiting_supervisor` link to the supervisor action queue.
- Owner mapping matches the Task 9 blocker contract: worker for `awaiting_worker`, supervisor for unresolved exception actions.

### Payroll readiness

- Expected days use the existing Monday-to-Saturday readiness convention.
- A day contributes approved hours only when it has no unresolved day exception and is either:
  - `approved`; or
  - `locked` with an active weekly lock and a `locked_period_version` equal to the latest lock/relock history version.
- Missing daily summaries, unresolved exceptions, unlocked/stale locks, and version mismatches count as blocked.
- Only approved ordinary, overtime, Sunday, public-holiday, leave, and unpaid hours are returned. No money, wage, or rate fields are exposed.

### Evidence quality

- Reports available, unavailable, and unreliable counts for GPS, selfie, geofence, and Cartrack evidence.
- Cartrack `match` and `mismatch` are both available corroboration; `no_data`, `vehicle_not_mapped`, and `device_gps_off` are unreliable.
- Wholly unavailable evidence is rendered `unavailable`, never as a verified match, fraud/guilt finding, worker-performance verdict, or payroll approval/readiness verdict.
- No selfie or storage URL is selected or returned.

All three modules fetch at most `REPORT_ROW_CAP + 1` and reject 50,001 rows with `ReportTooLargeError`.

## GREEN and regression evidence

Focused Task 13 tests after the final contract fixes:

```text
Test Files  4 passed (4)
Tests       23 passed (23)
```

Complete attendance report suite:

```text
npx vitest run src/services/attendance/reports/__tests__
Test Files  7 passed (7)
Tests       45 passed (45)
```

Task 7/9 readiness, lock, action-queue, and payroll export regressions:

```text
Test Files  9 passed (9)
Tests       94 passed (94)
```

The action-queue regression emits existing React `act(...)` warnings; all assertions passed.

Coverage explicitly proves:

- supervisor-scoped versus organisation-scoped rows;
- empty scope returns no rows and performs no report query;
- stable empty-scope screen/export headers;
- unresolved-only ageing, SAST age SQL, exact owners, and action URLs;
- approved/locked exact-version totals, active lock, unresolved blocker, missing-day, and no-rate semantics;
- evidence unavailable/unreliable semantics and forbidden-verdict absence;
- row keys equal ordered report columns for the shared screen/API/export result;
- 50,001-row rejection for every new module.

## Static and repository gates

```text
npx eslint <10 Task 13 source/test files>   PASS (no output)
git diff --check                           PASS
```

Size checks:

```text
page 69 lines; runner 286; types 194
report modules 91 / 121 / 105
test files 70 / 104 / 93 / 87
```

Candidate-head quick CI:

```text
npm run ci:quick
CI PASSED — Passed 8, Failed 0, Warned 1, Skipped 2
```

The one warning is the repository baseline of 58 pre-existing TypeScript errors. Quick CI confirmed zero changed-file violations and no new credential-like content. A direct `npm run type-check` showed the same unrelated errors and no Task 13 file error.

Final committed-head quick CI is recorded in the handoff checkpoint.

## Fix Round 1 — channel integrity, production logic and real exports

Review identified that the first implementation allowed the day-level `evidence_unreliable` timestamp exception to contaminate every evidence channel, relied too heavily on SQL-text-aware fakes, did not exercise real CSV/XLSX bytes, disabled empty-result exports, and sorted lock versions lexically.

### Corrected evidence model

- SQL now returns persisted point facts grouped per worker rather than pre-classified channel totals.
- Production aggregation classifies each channel only from that channel’s facts:
  - GPS uses coordinate presence and recorded accuracy;
  - selfie uses persisted image presence without returning its URL;
  - geofence uses the entry’s persisted geofence ID once per entry;
  - Cartrack treats `match` and `mismatch` as available corroboration, null as unavailable, and no-data/mapping/device failures as unreliable.
- The day-level timestamp-integrity exception is a separate, entry-deduplicated `timestamp_unreliable_entries` column. It does not alter GPS, selfie, geofence, Cartrack, or overall channel-coverage counts.
- Mixed evidence with valid GPS/selfies/geofence plus Cartrack `match` and `mismatch`, and a simultaneous timestamp exception, remains `complete` with all channel unreliable counts at zero and timestamp count one.

### Production row-fact logic

The report tests no longer calculate expected aggregates in a SQL fake. The database boundary returns row-level facts, and the actual functions used at runtime perform:

- evidence channel aggregation and coverage classification;
- payroll authoritative-day decisions, hour totals, blocker handling, lock matching, and numeric version sorting;
- exception owner/action mapping and SAST calendar-age calculation from the persisted timestamp.

SQL tests remain at the boundary for bound date, scope and row-cap parameters. Empty scope continues to return before querying. Payroll null lock versions have an explicit regression because `Number(null) === 0` must never create a false exact match.

### Export and zero-row UI behavior

The route’s real CSV/XLSX logic moved without semantic duplication into `exportSerializers.ts`; the route calls those same functions. Tests parse the generated XLSX workbook and compare it with the exact CSV output for:

- empty scope: header-only CSV and header-only XLSX;
- non-empty data: identical column order, integer/number formatting, quoted CSV cells and XLSX values.

The report page enables CSV/XLSX after any successful load, including zero rows. Loading and error states keep both controls disabled. The buttons and result panel were extracted without changing the Superdesign-approved visual structure, bringing the changed page to 197 lines.

### Fix Round 1 RED evidence

Row-fact production logic:

```text
npx vitest run ...exceptionAgeing.test.ts ...payrollReadiness.test.ts ...evidenceQuality.test.ts
Test Files  3 failed (3)
Tests       6 failed | 11 passed (17)
```

The old pre-aggregated mappings returned `NaN`, omitted the timestamp dimension, and could not respond to row-level fact mutations.

Real serializer seam:

```text
npx vitest run src/services/attendance/reports/__tests__/exportSerializers.test.ts
Test Files  1 failed (1)
Cause: production serializer module did not exist
```

Zero-row UI export:

```text
npx vitest run tests/pages/staff-attendance-report-slug.test.tsx
Test Files  1 failed (1)
Tests       1 failed | 1 passed (2)
Cause: successful zero-row CSV/XLSX controls remained disabled
```

Null lock-version authority:

```text
npx vitest run ...payrollReadiness.test.ts -t "does not treat absent lock versions as an exact match"
Tests 1 failed | 6 skipped
Observed: approved_days=1, lock_versions="0"; expected blocked with no version
```

### Deliberate mutation proof

The production GPS accuracy threshold was temporarily changed from `100` to `1_000`. The targeted mixed-channel mutation test failed with `gps_available=2` and `gps_unreliable=0` instead of `1` and `1`. The threshold was restored to `100`; the exact same targeted test then passed. The temporary mutation is not present in the final diff.

### Fix Round 1 GREEN evidence

```text
Focused reports + serializer + report-page UI: 6 files, 32 tests passed
Complete attendance report suite:             8 files, 52 tests passed
Task 10 readiness UI regressions:              2 files, 20 tests passed
Task 7/9/action/payroll regressions:            9 files, 94 tests passed
Scoped ESLint:                                 PASS, 0 errors
git diff --check:                              PASS
Candidate-head npm run ci:quick:               PASS 8, failed 0, warned 1
```

The quick-CI warning remains the unchanged baseline of 58 pre-existing TypeScript errors. Existing readiness/action UI tests also emit React `act(...)` warnings, and the new page test sees the repository test stack’s `ReactDOMTestUtils.act` deprecation warning; assertions pass.

Fix Round 1 size evidence:

```text
pages/staff/attendance/reports/[slug].tsx       197
ReportExportButtons.tsx                          77
ReportResultPanel.tsx                            46
evidenceQuality.ts                              125
payrollReadiness.ts                             131
exceptionAgeing.ts                               78
exportSerializers.ts                             45
```

All changed source files are below 300 lines and all changed pages/components are below 200 lines. No shared database, migration, deploy, production, browser, send or rebase action was performed during the fix.
