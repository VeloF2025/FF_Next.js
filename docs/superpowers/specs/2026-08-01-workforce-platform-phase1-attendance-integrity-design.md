# Workforce Platform Phase 1 — Attendance Integrity and Payroll Readiness

**Date:** 2026-08-01
**Branch:** `docs/attendance-platform-phase1-design`
**Status:** Approved for implementation planning
**Programme:** FibreFlow Workforce Platform

## 1. Decision summary

FibreFlow will become the workforce system that captures attendance evidence,
applies work-schedule rules, routes exceptions, records approvals, locks approved
periods and produces an auditable payroll-ready export.

FibreFlow will not calculate tax, generate final payslips or make payments. The
existing payroll system remains authoritative for those functions.

The approved programme is delivered in four separately designed and verified
phases:

1. **Attendance integrity and payroll readiness** — this specification.
2. **Crew and site scheduling** — shift templates, crew/site assignments,
   supervisor responsibility and planned Sunday/overtime work.
3. **Payroll preparation** — richer pay-period controls and payroll-system
   integration built on locked attendance results.
4. **Management automation** — wider workforce analytics and escalations built
   on the trusted attendance and schedule data.

Each phase requires its own specification, implementation plan, worktree, pull
request and verification. Phase 1 must be trusted before later phases may use
its results.

## 2. Problem and evidence

### 2.1 Spreadsheet review

The two supplied workbooks were reviewed against their own formulas and the
live FibreFlow attendance records:

- `June 2026 time sheet 2026-06-15 to 2026-07-21.xlsx`
- `June 2026 time sheet 2026-05-17.xlsx`

The spreadsheets are not reliable payroll evidence:

- The workbook named through 2026-07-21 stops at 2026-07-12.
- Six staff sheets repeat the same daily values extensively; 89 of 98 common
  dates are identical across all six sheets.
- The workbook layout behaves like a copied template rather than a record
  derived from each worker's clock events.
- The live register and raw live entries reconciled internally, while the
  workbook did not provide an equivalent evidence trail.

The workbooks may be used as historical examples for user-acceptance scenarios,
but never as the source of expected payroll totals.

### 2.2 FibreFlow audit snapshot

The 2026-08-01 live audit observed:

- 79 active staff and 56 attendance credentials.
- 32 staff with attendance entries in the preceding 30 days.
- 496 entries in that window, including 187 auto-closed entries and 13 open
  entries.
- 14 pending attendance corrections and no weekly locks.
- 599 auto-closed entries overall but no matching `missing_clock_out`
  exceptions, despite the schema supporting that exception kind.
- 496 warning and 29 informational geofence-mismatch exceptions in the
  preceding 30 days, effectively covering every entry.
- Cartrack verification dominated by `vehicle_not_mapped` results, with much
  smaller match, device-GPS-off and no-data groups.

These figures are an audit snapshot, not permanent system constants. They show
three control gaps that the design must address:

1. A system-generated close is being treated too much like a genuine worker
   clock-out.
2. The exception and approval trail is incomplete.
3. Location/fleet corroboration is too noisy to decide payroll eligibility.

### 2.3 Existing platform to preserve

The current module already provides:

- `/my` mobile PWA clock-in/out with selfie, GPS and offline queueing.
- PostgreSQL enforcement of one open entry per staff member.
- Attendance corrections through `attendance_adjustments`.
- Supervisor scoping, weekly locks, bulk actions, search and reports.
- `attendance_entries`, `attendance_daily_summaries`,
  `attendance_exceptions`, `attendance_adjustments` and
  `attendance_weekly_locks`.
- Cartrack corroboration and evidence-quality indicators.

Phase 1 extends these components. It does not create a parallel attendance
application or a second back-office navigation tree.

## 3. Goals and non-goals

### 3.1 Goals

- Make every scheduled workday resolve to an explicit, explainable state.
- Distinguish worker-recorded events, system fallbacks, corrections, approvals
  and payroll-effective results.
- Enforce the approved fixed work schedule consistently in SAST.
- Force a worker with a missing clock-out to submit a correction before the
  next clock-in, without blocking the site while waiting for supervisor review.
- Give supervisors one daily queue for missing clock-outs, attendance flags,
  absences, overtime and Sunday work.
- Give HR a weekly/pay-period readiness view, blocking issues, audited locks and
  reproducible exports.
- Automate reminders and reports without silently approving or deducting time.
- Verify complete mobile-worker, supervisor and HR journeys in the UI and in
  persisted PostgreSQL state.

### 3.2 Non-goals

- Tax, statutory payroll deductions, payslip generation or payment execution.
- Monetary wage-rate calculations in Phase 1. FibreFlow exports approved hour
  categories; payroll applies rates.
- A general-purpose shift/roster builder. Phase 1 uses the approved default
  schedule; Phase 2 adds crew/site scheduling.
- Leave entitlement balances or leave-application workflows. Phase 1 consumes
  approved leave when available and supports attendance-day classification.
- Automatic fraud findings from GPS, geofence, selfie or Cartrack differences.
- Rewriting historical raw clock evidence to make a correction look original.

## 4. Approved attendance policy

All policy evaluation uses `Africa/Johannesburg`. South Africa has no daylight
saving transition, but timestamps remain stored as `TIMESTAMPTZ` and work dates
remain explicit SAST dates.

### 4.1 Default schedule

| Day | Scheduled span | Unpaid break | Scheduled paid hours |
|---|---:|---:|---:|
| Monday–Friday | 08:00–17:00 | 1 hour | 8 hours |
| Saturday | 08:00–13:00 | None | 5 hours |
| Sunday | No regular schedule | None | 0 scheduled hours |

Sunday non-attendance never creates a no-show. Sunday work is recorded as a
separate category and is not payroll-effective until a supervisor approves it.

Work before 08:00, after 17:00 on weekdays, or after 13:00 on Saturday is
outside-schedule time. FibreFlow records it as provisional overtime and requires
supervisor approval before it reaches payroll.

Public-holiday work is unscheduled, requires supervisor approval and is exported
as a distinct hours category. Phase 1 does not decide its monetary multiplier.

### 4.2 Clean completed day

A clean day has a genuine clock-in and genuine clock-out, no blocking exception
and no time outside the schedule. FibreFlow stores elapsed time separately from
paid time:

- A complete 08:00–17:00 weekday produces 9 elapsed hours and 8 scheduled paid
  hours after the fixed one-hour lunch.
- A complete 08:00–13:00 Saturday produces 5 elapsed and paid hours.
- A clock recorded before scheduled start does not increase ordinary hours.
- A clock recorded after scheduled end does not increase ordinary hours; the
  additional time is provisional overtime.

### 4.3 Late arrival and early departure

Late arrivals and early departures create attendance exceptions. FibreFlow does
not make an automatic payroll deduction.

The derived result remains provisional until the supervisor accepts the actual
recorded time, accepts a worker correction, or confirms the full scheduled day
with an auditable reason. The 08:15 daily check is an operational reminder and
queue threshold, not a payroll rounding rule.

### 4.4 Missing clock-out

Overnight reconciliation handles a prior open attendance session as follows:

1. Preserve the genuine clock-in and absence of genuine clock-out.
2. Operationally close the stale session with explicit system provenance so it
   cannot block all future attendance activity.
3. Create one idempotent `missing_clock_out` exception.
4. Create a provisional daily fallback capped at:
   - 8 paid hours for Monday–Friday;
   - 5 paid hours for Saturday;
   - 5 paid hours for Sunday work.
5. Show the worker an action-required correction before the next clock-in.
6. Require the worker to submit the claimed clock-out time and reason.
7. Permit the new day's clock-in once that correction is persisted. Supervisor
   approval may remain pending so field work is not blocked by manager latency.

The fallback is a maximum provisional payroll value, not evidence that the
worker actually clocked out. A fallback can never become payroll-effective
while its correction/approval remains unresolved.

### 4.5 Missing clock-in on a scheduled day

At the daily attendance check, an active worker with no clock-in on a weekday or
Saturday receives an attendance-day exception unless approved leave, a public
holiday or another trusted schedule exception already explains the day.

The supervisor must classify the day as one of:

- Approved leave
- Sick leave
- Site shutdown or weather delay
- Public holiday
- Unauthorised absence

The classification records the actor, time, reason and evidence reference. It
does not create a fake clock event.

## 5. Concepts and state model

FibreFlow must keep these concepts separate:

- **Clock evidence:** what the device and server recorded, including whether
  clock-out evidence is absent.
- **Operational session state:** whether the app considers the worker currently
  clocked in and may accept another clock-in.
- **Daily attendance result:** scheduled, elapsed, ordinary, overtime, Sunday,
  holiday, leave and unpaid-hour categories for one worker/date.
- **Exception:** a condition that needs action or corroboration.
- **Adjustment:** a worker or authorised staff member's proposed correction.
- **Approval event:** the decision that makes or refuses a provisional value.
- **Period lock:** HR's confirmation that a defined result version is frozen.
- **Payroll export:** an immutable output derived from one locked version.

### 5.1 Daily-result states

```text
expected
  → open
  → complete
  → provisional
  → awaiting_worker
  → awaiting_supervisor
  → approved
  → locked

expected → absence_review → approved → locked
```

- `complete` means the calculation is mechanically complete, not necessarily
  approved for payroll.
- Any late/early flag, missing punch, Sunday work, outside-schedule time or
  attendance classification makes the result provisional.
- A result becomes `approved` only when every blocking item is resolved.
- Only HR may move an approved result into a locked period.
- Unlocking never deletes the old decision; it appends an audit event and
  creates a new result/export version.

## 6. Architecture

```text
/my clock evidence + approved leave/public holidays + default schedule
                                ↓
                    attendance policy engine
                   pure, effective-dated rules
                                ↓
                    daily attendance projection
                                ↓
             exception + correction + approval workflow
                                ↓
                HR readiness → lock → versioned export
                                ↓
                dashboards + scheduled notifications
```

The server is authoritative. Browser components render states and submit
commands; they do not calculate payable hours or decide approval eligibility.

### 6.1 Policy engine

A focused attendance-policy service accepts clock evidence, SAST date, the
effective schedule policy, public-holiday state, approved leave and accepted
adjustments. It returns a deterministic daily result plus exceptions.

Rules are effective-dated. Locked history retains the policy-version ID used at
approval and never silently recalculates when a later policy changes.

The engine is pure and separately testable. Database reads, writes,
notifications and export generation remain outside it.

### 6.2 Reconciliation service

The existing reconciliation flow becomes schedule-aware:

- Replace the generic `older than 16 hours` / `9-hour cap` behaviour with the
  approved schedule and fallback-paid-hour rules.
- Always create/read back the matching exception for a system reconciliation.
- Recompute changed daily results in chronological order.
- Use stable idempotency keys per worker/date/exception kind.
- Report partial failures and leave affected results provisional.
- Never mark a run successful when a write required for payroll integrity did
  not persist.

### 6.3 Notifications

Attendance notifications use the existing FibreFlow notification
infrastructure with stable delivery keys. A retry cannot create a second task or
send the same reminder repeatedly.

Default operational cadence:

- Before shift: `/my` shows today's schedule/site/crew context available in the
  current phase.
- 08:15: late/no-clock flags appear for supervisors.
- 17:00 weekdays and 13:00 Saturdays: open-session clock-out reminder.
- End of day: supervisor digest for open sessions, Sunday work, overtime and
  unresolved attendance classifications.
- Overnight: schedule-aware reconciliation and missing-clock-out tasks.
- Weekly/pay period: HR readiness summary and unresolved-blocker escalation.

In-app state is authoritative. An email or message delivery failure is visible
and retryable but does not change attendance or payroll state.

## 7. Data design

The implementation uses additive migrations with rollback scripts. The exact
migration number is selected from the then-current sequence immediately before
implementation because the repository's migration sequence is active.

### 7.1 Existing tables retained

- `attendance_entries` remains the clock-session evidence source. Genuine
  device clock-out fields remain distinguishable from a system reconciliation.
- `attendance_adjustments` remains the approved path for corrections. Staff and
  manager routes never update source clock values directly.
- `attendance_daily_summaries` remains the daily projection, extended to carry
  schedule-aware and approval-aware values.
- `attendance_exceptions` remains entry-scoped evidence/exception history.
- `attendance_weekly_locks` remains the active-lock lookup.

### 7.2 Required additions

#### Schedule policy versions

An effective-dated schedule-policy record stores:

- timezone;
- weekday start/end and unpaid break;
- Saturday start/end;
- Sunday scheduled status;
- missing-clock-out paid caps;
- operational reminder thresholds;
- activation/retirement timestamps and actor.

It references, rather than duplicates, the existing overtime-rule profile.
Phase 2 will assign shift templates and crew/site schedules against this same
policy boundary.

#### Daily projection fields

The daily summary/projection adds:

- schedule-policy version;
- scheduled span and scheduled paid hours;
- recorded elapsed and recorded paid hours;
- approved ordinary, overtime, Sunday, holiday, leave and unpaid hours;
- result state and provisional reason;
- source/result version and recomputation timestamp.

Hour categories used in payroll exports must not overlap silently. Any existing
report whose premium buckets overlap ordinary/overtime remains explicitly
labelled and cannot be reused as the new payroll-ready export without a mapping
test.

#### Day-level exceptions

The existing `attendance_exceptions.entry_id NOT NULL` model cannot represent a
no-clock-in day. Add a day-level exception record keyed by worker, date and kind,
with optional entry link, owner, status, due state, resolution and idempotency
key.

Kinds include:

- missing clock-in;
- missing clock-out;
- late arrival;
- early departure;
- outside-schedule time;
- Sunday work;
- public-holiday work;
- evidence unavailable or unreliable.

#### Approval and period events

Append-only decision events record actor, role/permission, effective time,
recorded time, before/after values, reason and source. Weekly-lock history must
survive unlock/re-lock cycles; the current mutable lock row remains only the
fast active-state projection.

#### Payroll exports

Each export record stores:

- period and lock/result version;
- generator version;
- generated by/at;
- row count and totals;
- file checksum and storage reference;
- export status and failure detail.

Re-exporting the same locked version must reproduce the same rows and totals.

## 8. Permissions and authority

Existing PostgreSQL RBAC and supervisor-scope services remain authoritative.

| Role | Authority |
|---|---|
| Worker | View own schedule/results; clock in/out; submit own correction |
| Assigned supervisor | View assigned crews/sites; classify attendance; approve/return corrections, Sunday work and overtime |
| Manager | View scoped operational dashboards and escalations; no implicit HR lock authority |
| HR/admin | Organisation readiness; lock/unlock with reason; generate locked export |
| Super admin | Recovery authority with the same mandatory audit requirements |

Workers see only themselves. Supervisors see only workers proven by current
supervisor scope or later crew/site assignment. An ID supplied by the browser
never widens scope.

Selfie access continues through the audited selfie route. GPS, geofence and
Cartrack data are corroborating evidence, not automatic fraud or pay decisions.

## 9. Product and UI walkthroughs

Attendance remains a multi-page module using the existing horizontal
`AttendanceNav`. No sidebar subtree is introduced.

### 9.1 Worker `/my` journey

#### Ready to start

The attendance tile shows today's date, default schedule, available site/crew
context, GPS/selfie readiness and one primary **Clock in** action. Any unresolved
prior missing clock-out replaces the normal action with **Attendance action
required**.

#### Working

After successful API confirmation, the UI shows clock-in time, active status,
scheduled end, lunch rule and **Clock out**. It does not show a success state
until the persisted API response is received. Offline submission shows queued
state and later confirms the server result.

#### Normal completion

The worker sees elapsed and scheduled paid time separately. A clean weekday
shows `08:00–17:00`, `1h unpaid lunch` and `8h scheduled paid`.

#### Missing clock-out

The next visit shows:

- original clock-in;
- absence of clock-out evidence;
- provisional fallback cap;
- required claimed clock-out time and reason;
- correction-submission status.

After successful submission, the same screen confirms that the new day's
clock-in is enabled and supervisor review is still pending. Failed submission
does not unlock clock-in.

### 9.2 Supervisor journey

The existing attendance area gains a daily **Needs attention** queue grouped by
site/crew and ordered by payroll risk/age.

Summary cards show present, flagged, open, missing clock-in and unresolved
counts. Queue kinds include:

- missing clock-out correction;
- late/early flag;
- outside-schedule time;
- Sunday/holiday work;
- missing-clock-in classification;
- unreliable supporting evidence.

The detail screen shows clock evidence, adjustment, site/crew, GPS/selfie access
and available fleet corroboration, followed by the proposed hour categories.
The supervisor may approve, return/reject, or classify as permitted. Every
command requires API confirmation and produces an attributed audit event.

There is no blind bulk approval of payroll-effective exceptions. Bulk actions
may assign/escalate queue ownership, but individual payroll decisions retain an
evidence review.

### 9.3 HR journey

The weekly/pay-period readiness view shows:

- active workers and expected scheduled days;
- completed and approved results;
- unresolved worker and supervisor items;
- unapproved Sunday/overtime/holiday hours;
- attendance classifications and payroll variances;
- evidence-quality coverage separately from payroll blockers.

The **Lock period** command is disabled until all blocking results are approved.
Unlock requires explicit permission and reason. The prior locked version and
export remain visible.

The payroll preview shows employee/payroll ID, ordinary hours, approved
overtime, approved Sunday, approved public-holiday, leave categories,
unpaid/absence hours, project/site allocation available in the current phase
and an audit reference.

### 9.4 Empty and error states

- No assigned workers: explain scope rather than showing organisation-wide data.
- No exceptions: show the checked period and last successful reconciliation.
- Evidence unavailable: say which source is unavailable and when it was last
  checked; never render a false green match.
- Reconciliation stale: block lock/export and show the last successful run.
- Concurrent decision: return `409`, reload the current state and preserve the
  user's draft note.
- Export failure: keep the period locked, record failure, allow an idempotent
  retry and never publish a partial file.

## 10. Reports and automation outputs

### 10.1 Manager outputs

- Daily site/crew attendance: present, flagged, no clock-in and open sessions.
- Exception ageing: worker, reason, owner, age and escalation status.
- Repeated missing clock-out and late/early patterns.
- Planned versus attended hours once Phase 2 assignments exist.
- Supervisor decision turnaround.

### 10.2 HR outputs

- Weekly/pay-period readiness.
- Approved ordinary, overtime, Sunday, holiday, leave and unpaid hours.
- Worker, site, crew and department variance where authoritative mappings exist.
- Evidence-quality report for GPS, geofence, selfie and Cartrack coverage.
- Lock, unlock and export audit report.

Reports and exports use the same server-side daily projection. A dashboard total
and exported total for the same locked version must reconcile exactly.

## 11. API boundaries and errors

New routes follow the repository's flat Pages Router convention. Final names are
confirmed during implementation planning, but the boundary is:

- Worker current-day schedule/result and required action.
- Worker missing-clock correction submission.
- Supervisor exception queue and exception decision.
- HR period readiness, lock/unlock and payroll preview/export.
- Reconciliation health and notification delivery status.

All commands use `apiResponse`, `@/lib/db` or `@/lib/db-pool`, and `log`. Stable
error reasons include:

- `prior_correction_required`
- `result_stale`
- `exception_already_decided`
- `scope_forbidden`
- `period_has_blockers`
- `period_locked`
- `reconciliation_stale`
- `export_version_conflict`

Responses include the exact blocking worker/date/action instead of a generic
failure.

## 12. Failure handling and observability

- Clock idempotency keys prevent duplicate online/offline punches while
  retaining the actual device occurrence time and server receipt time.
- Reconciliation, exception creation, reminders and exports are safe to replay.
- A missing GPS, geofence or Cartrack result remains `unavailable` or
  `unreliable`; it is never coerced to pass/fail.
- Because the audit showed effectively universal geofence mismatches, Phase 1
  reports geofence quality separately and does not make those mismatches an
  automatic payroll blocker. Geofence capture remains mandatory.
- Per-worker reconciliation failure leaves that daily result provisional and
  visible. The run report counts and identifies failures.
- Reconciliation freshness is a hard precondition for HR lock/export.
- Jobs log started/finished state, input range, policy version, counts, stable
  run ID, failed entity IDs and duration.
- Notification delivery has its own status; delivery acceptance is not treated
  as worker acknowledgement.

## 13. Verification and complete UI walkthroughs

Code review alone is not acceptance. Phase 1 requires all layers below.

### 13.1 Pure rule matrix

Test deterministic calculations for:

- clean Monday–Friday shift and one-hour lunch;
- clean Saturday shift;
- Sunday with and without work;
- early clock-in and late clock-out split from ordinary time;
- late arrival and early departure provisional states;
- missing clock-out weekday/Saturday/Sunday caps;
- missing scheduled clock-in;
- public holiday;
- effective policy version boundaries;
- SAST date and ISO-week boundaries;
- locked historical result after a later policy change.

### 13.2 Database and API verification

- Real PostgreSQL constraints enforce one active clock session and idempotent
  day exceptions.
- Adjustment decisions use the approved state machine and never overwrite raw
  clock evidence.
- Missing-clock reconciliation persists both provisional result and matching
  exception atomically or leaves the result visibly incomplete.
- Supervisor scope has positive and negative tests.
- HR lock rejects unresolved results and stale reconciliation.
- Unlock/re-lock preserves every audit event.
- Repeated export of one locked version has identical rows, totals and checksum.

### 13.3 Playwright UI walkthroughs

Run against a controlled environment and assert both UI state and persisted
readback:

1. Worker completes a normal weekday: clock-in, active state, clock-out, lunch
   deduction and 8-hour daily result.
2. Worker misses clock-out: overnight cap, action-required screen, correction
   submission, new-day clock-in enabled, pending supervisor state retained.
3. Supervisor approves and returns corrections; worker sees each resulting
   state and note.
4. Supervisor classifies every supported missing-clock-in outcome.
5. Supervisor approves Sunday and outside-schedule time; unapproved values stay
   out of payroll preview.
6. HR cannot lock a period with blockers, can lock a clean period, can export,
   and receives the same output on retry.
7. Authorised unlock creates an audit record and a new result/export version.
8. Worker, supervisor, manager and HR access boundaries are proven with negative
   navigation and direct-API tests.
9. Offline clock submission and duplicate retry create one server event.
10. Missing GPS/Cartrack/reconciliation services render honest degraded states.

Capture and inspect mobile `/my` and desktop management screenshots. Verify
layout, hierarchy, touch targets, keyboard access, loading/empty/error states and
that no action appears successful before API confirmation.

### 13.4 Reconciliation proof

For the same locked period, prove:

```text
approved daily results
= weekly worker totals
= HR readiness totals
= payroll preview totals
= exported payroll rows
```

The legacy spreadsheets are not expected totals. A controlled fixture set and
persisted database readback are the acceptance authority.

## 14. Rollout and rollback

### 14.1 Shadow mode

Run the new policy engine beside the current summaries with no payroll effect.
Produce a per-worker/date variance report explaining every difference. Confirm
exception creation, policy versioning and job idempotence.

### 14.2 Pilot

Enable worker correction gating, supervisor queue and HR readiness for one
representative crew/site. Complete the worker, supervisor and HR walkthroughs
using real authorised pilot accounts.

### 14.3 Organisation rollout

Expand only after the pilot acceptance and an agreed clean parallel payroll
run. Payroll export stays disabled until HR accepts the reconciliation evidence.

### 14.4 Rollback

- Database changes are additive and have an explicit rollback script.
- A feature flag returns reads to existing summaries and disables new workflow
  commands without deleting evidence or audit history.
- Rollback never overwrites clock events or removes an export already handed to
  payroll.
- A database migration or production deploy remains separately approval-gated
  under FibreFlow's operational rules.

## 15. Success criteria

Phase 1 is successful when:

- every active scheduled worker/date has an explicit daily state;
- every system-reconciled missing clock-out has one matching exception and a
  visible worker action;
- a worker cannot skip that correction but can work after submitting it;
- supervisor and HR queues show exact owner, blocker and evidence;
- unapproved Sunday/overtime and unresolved attendance never enter the locked
  payroll export;
- geofence/Cartrack coverage is reported honestly and separately;
- locked exports are deterministic and reconcile to the UI and database;
- all specified UI walkthroughs pass with persisted readback;
- `npm run ci:quick`, focused tests and applicable build/E2E gates pass on the
  implementation branch;
- the pilot and production deployment approvals are recorded separately from
  code completion.

## 16. Later-phase contracts

Phase 2 may replace the company default schedule for a worker/date with an
effective crew/site shift assignment, but it must call the same policy engine
and preserve the same approval/audit boundaries.

Phase 3 may add payroll-system-specific mappings, but only from locked,
versioned hour categories. Tax, payslip and payment authority remains outside
FibreFlow unless a separately approved future specification changes that
boundary.

Phase 4 may add predictive or comparative management analytics, but it may not
convert corroborating evidence into automatic disciplinary or fraud findings.
