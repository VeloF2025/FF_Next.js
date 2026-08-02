# Task 10 report — HR readiness and lock walkthrough

## Status

Implemented the Task 10 HR readiness walkthrough on base `d67783600`. The
stable `/staff/attendance/locks` route now renders server-calculated readiness,
strict admin authority, audited lock/unlock controls, atomic bulk readiness,
and server readback outcomes. The weekly view distinguishes approved from
locked hour categories and exposes export navigation only for an active lock
version.

No database, migration, browser, deployment, DEV, or production action was
performed. Task 14 still owns browser walkthrough evidence. Task 11 still owns
the deterministic export implementation; this task only gates the existing
export request behind the active lock and includes its version.

## Superdesign gate

- Canvas: `d21ab9a2-cc0f-4d2d-8d7e-ea25cbaeb08a`
  - https://superdesign.dev/teams/06297687-01a4-4a6a-886f-fdd0fe4d771f/projects/d21ab9a2-cc0f-4d2d-8d7e-ea25cbaeb08a
- Current locks reproduction: `d2447724-5f98-416f-adf6-28601237be10`
  - https://p.superdesign.dev/draft/d2447724-5f98-416f-adf6-28601237be10
- Single selected readiness variation: `e903e58b-9f06-45a2-abc5-1c5fef0dbf5e`
  - https://p.superdesign.dev/draft/e903e58b-9f06-45a2-abc5-1c5fef0dbf5e

The app implementation follows the selected variation while preserving the
actual FibreFlow AppLayout, attendance navigation, token system, Task 9 API
contracts, and existing stable routes. Task 9 exposes the active lock plus the
latest immutable action/version, not a full history list, so this UI truthfully
shows only that available snapshot.

## Implemented behavior

- Invalid/non-Monday weeks fail before readiness requests; loading, permission,
  API failure, empty/stale readiness, blockers, and success are distinct states.
- Counts, freshness and blocker ownership come only from Task 9 readiness.
  Blocker links retain the exact server `actionUrl`.
- Only `admin` and `super_admin` see mutations. Other permitted roles receive
  read-only lock visibility.
- Single lock stays disabled until server `readyToLock` is true. Unlock requires
  explicit confirmation and a 10-character trimmed reason.
- Bulk lock stays disabled until every selected Monday independently returns
  ready. A 409 refreshes every selected week and current locks without showing
  optimistic success or clearing the entered reason.
- Duplicate commands are blocked synchronously. Lock/unlock and bulk success
  appear only after exact server readback confirms the active state/version.
- Task 8 action deep links now select `exception_id` from the bounded queue or
  retrieve that exact record from the existing `status=all&limit=200` readback.
  Filter changes retain the deep-link parameter.
- Weekly metrics read Approved regular/overtime/Sunday while open and Locked
  regular/overtime/Sunday when the weekly-lock API confirms an active version.
  CSV/XLSX requests are hidden otherwise and include `lock_version` when shown.

## TDD evidence

The initial focused legacy run was RED: three UI test files failed with ten
failures because the readiness components and server-authoritative behavior did
not yet exist. Later mutation-sensitive RED cycles caught and drove two fixes:

- A bulk 409 initially refreshed only the current week rather than every
  selected readiness item.
- A deep-linked exception outside the bounded queue initially produced the
  empty state instead of rendering the exact selected item.

Both failed before their production changes and pass in the final regression.

## Final verification

Focused Task 8-10 UI and Task 7-9 workflow/API regression on final code:

```text
Test Files  15 passed (15)
Tests       114 passed (114)
```

Existing React `act(...)` warnings remain visible in the established attendance
UI tests; they do not fail the suite and are not presented as browser evidence.

```text
Scoped ESLint:             exit 0
git diff --check:          exit 0
Changed production files: all below 300 lines
Changed page/components:  all below 200 lines
Largest changed test:     299 lines

npm run ci:quick
Passed: 8  Failed: 0  Warned: 1  Skipped: 2  Duration: 107-108s across two final runs
```

The CI warning is the accepted repository baseline of 58 pre-existing
TypeScript errors. The changed-file zero-tolerance gate is clean, ESLint has
zero errors, and the secret scan reports no new credential-like content.

## Evidence boundary and carry-forward

This task has component/page and API-contract regression evidence only. It has
no rendered-browser, live-auth, live-database, migration, deterministic-export,
DEV, deployment, or production proof. Task 14 must verify the complete manager
and HR UI walkthrough in a browser, including exact blocker navigation, read-
only authority, stale conflicts, reason retention, active versions and export
visibility. Task 11 must implement and verify immutable versioned exports.

## Fix Round 1 — reviewer rejection remediation

Independent review rejected commit `87554d9ce` because weekly labels used
legacy proposed totals, async week responses could overwrite newer selections,
malformed lock versions were treated as active, bulk readback was not correlated
to the submitted batch, a failed exact deep link retained an unrelated decision,
and the latest audit snapshot omitted actor/time/reason details.

### Corrected contracts

- The attendance-week query now reads the approved regular, overtime and Sunday
  snapshot columns plus result status. It returns separate `payrollTotals` using
  only approved/locked rows; the approved/locked UI metrics consume those totals
  instead of the legacy proposed fields. A differing fixture pins 13.5 regular,
  1.5 overtime and 2 Sunday hours while the legacy proposal values differ.
- Readiness/lock-list pairs and weekly payloads use request generations and
  cancellation checks. Obsolete week completions cannot write readiness, locks,
  errors, loading state or export visibility. Mutations also capture their
  initiating week/generation before POST/readback/success, and downloads stop if
  the selected week changes before completion.
- Active lock and export state require a positive integer version. Null, zero,
  NaN-like and decimal values remain fail-closed in both HR controls and week UI.
- Bulk success captures each selected week's pre-submit inactive version (zero
  only when no prior row). The response must name every selected week and exact
  lock count; readback must then show every week active at exactly prior + 1,
  latest action `lock`/`relock`, and the submitted trimmed audit reason. Missing,
  legacy, wrong-action, wrong-reason and concurrent-version rows fail closed.
- A requested `exception_id` is now the sole selectable decision authority while
  present. Failed exact readback clears selection, leaves the error and refresh
  action visible, and never exposes an unrelated decision form.
- Weekly lock-list reads now include the latest immutable actor ID, reason and
  recorded timestamp. The lock snapshot labels version, action, actor, timestamp
  and reason explicitly without claiming a full history timeline.

### Fix-round TDD and verification

The first legacy RED run had 15 failures and 15 passes across six files. The
failures independently covered approved snapshot absence, stale A-over-B writes,
invalid lock versions, bulk false-positive readback, missing audit fields and
the unrelated exact-link decision. The exact-link test was rerun alone after its
complete fixture was corrected and failed specifically because `Unrelated
Worker` and the approval form remained visible. Two later RED cycles pinned all
four malformed active-version values and a same-version bulk row with a
different audit reason before their production fixes.

Final Task 8-10 UI and Task 9 API/workflow regression:

```text
Test Files  20 passed (20)
Tests       145 passed (145)
Scoped ESLint: exit 0
git diff --check: exit 0
Largest changed production file: attendance-week API 292 lines
Largest changed hook: usePeriodReadiness 291 lines
All changed pages/components: below 200 lines
npm run ci:quick: 8 passed, 0 failed, 1 warned, 2 skipped (93-104s across two runs)
```

The CI warning remains the accepted repository baseline of 58 pre-existing
TypeScript errors; the changed-file zero-tolerance gate is clean.

No browser, live database, migration, deployment, DEV, production or rebase
action was performed in this fix round. The branch remained on its assigned
base; Task 14 still owns rendered walkthrough evidence.

## Fix Round 2 — exact-week authority and mutation lifetime

The second re-review found that bulk correlation still inferred a missing prior
lock from the bounded 200-row list, effect cleanup could leave a later in-flight
mutation generation valid after unmount, and two mutation/SQL contracts were
not directly pinned.

### Corrected contracts

- `GET /api/staff/attendance-weekly-locks?week_start_date=YYYY-MM-DD` now
  validates a real ISO Monday and returns `{ lock }` from a dedicated exact
  query. The row includes active/unlock fields plus the latest immutable
  version, action, actor, reason and recorded time. The existing view permission
  wrapper remains authoritative; the bounded list contract was not expanded.
- Initial selected-week reads, added bulk weeks, successful post-readbacks and
  `409` refreshes now query every selected week exactly. Only `lock: null` from
  that exact read establishes version zero; absence from a recent list no longer
  has any correlation meaning.
- Week-effect cleanup now invalidates the mutation generation unconditionally.
  A deferred POST cannot start readback after unmount, and a deferred readback
  cannot publish success, error or state into a newly selected week.
- Mutation coverage now fails closed when a post-readback row is unlocked. The
  real weekly API SQL test also asserts selection of
  `approved_regular_hrs`, `approved_overtime_hrs` and
  `approved_sunday_hrs`, independently of aggregation fixtures.

### Fix-round TDD and verification

RED first demonstrated that the old GET returned `{ locks }` for an exact query
and accepted a Tuesday, while the hook still called and parsed `limit=200`.
The deferred-unmount test then pinned the stale mutation lifetime. Final focused
Task 8-10 and Task 9 API/workflow regression is:

```text
Test Files  28 passed (28)
Tests       214 passed (214)
Scoped ESLint: exit 0
git diff --check: exit 0
Weekly-lock API: 183 lines
usePeriodReadiness hook: 298 lines
npm run ci:quick: 8 passed, 0 failed, 1 warned, 2 skipped (78s)
```

The test total includes the final three strict-invalid exact-week cases. Existing
React `act(...)` warnings remain non-failing test-harness output and are not
browser evidence. No browser, live database, migration, deployment, DEV,
production or rebase action was performed.
