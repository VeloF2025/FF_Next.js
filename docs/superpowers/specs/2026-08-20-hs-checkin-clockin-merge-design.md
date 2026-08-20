# Merging the H&S daily check-in into the clock-in — design

**Date:** 2026-08-20
**Status:** approved design, not yet planned
**Scope:** `/my` staff portal — attendance clock-in and H&S daily check-in

---

## Problem

The H&S daily check-in and the attendance clock-in are two separate journeys
that a site worker must remember to do each morning. Only the clock-in has a
reason to be remembered — it is what gets them paid. The check-in is a hub tile
nobody is required to press.

The result is visible in the data: `findClockedInWithoutCheckin()`
(`src/modules/health-safety/services/checkinService.ts:208`) exists purely to
list people who clocked in and never declared their fitness for the day. That
report is the symptom.

Merging the two makes the safety declaration part of the action the worker
already has a reason to complete.

---

## Decisions

| Question | Decision |
|---|---|
| How combined? | One flow. The safety questions are steps inside the clock-in wizard. |
| Who gets it? | Everyone who clocks in. The worker declares Office or a project. |
| Blocked clearance? | Attendance still commits. The app never refuses to record time. |
| Project for the H&S row? | Sticky picker, defaulted to yesterday's answer. Office needs no project. |
| Abandoned mid-flow? | The clock-in stands; the check-in shows as outstanding. |
| Office path? | Fit-for-duty only. No PPE, no activities. |
| Standalone page? | Stays. See "Why the standalone page survives". |

---

## Approach: continue the wizard after the clock-in commits

`ClockActionFlow` gains H&S steps after the attendance write. The clock-in
posts to `POST /api/my/attendance/clock-in` unchanged and commits; the flow
then continues into the safety questions, which post to the existing
`POST /api/my/hs/checkin` carrying `attendance_entry_id` and the GPS fix the
clock-in already captured.

Both APIs keep their own guards, their own idempotency, and their own tests.
No new endpoint is introduced.

**Why this ordering, and not a single composite endpoint.** The H&S API
carries an explicit invariant (`pages/api/my/hs/checkin.ts:8-12`): it is
"deliberately SEPARATE from clock-in… must never be able to fail a clock-in".
Committing the attendance row before the H&S request is even sent makes that
invariant structurally true rather than dependent on correct ordering inside a
new handler. A composite endpoint would put a documented safety property at the
mercy of future edits to one function.

This matters at the observed rate: **60 of 297** self check-ins to date
returned `clearance='blocked'`. If a blocked clearance could abort the
clock-in, roughly one in five site workers would be unable to start a shift.

**Accepted cost.** Two HTTP calls means a worker who loses signal between them
is clocked in without a check-in. That gap already exists today for every
worker, and the officer board already surfaces it.

---

## Flow

For every worker clocking in:

1. Existing clock-in steps — selfie, consent, location. Unchanged.
2. **Clock-in commits.** Nothing after this point can undo it.
3. **Where are you working today?** — Office, or a project. Sticky default from
   yesterday's answer, so the common case is one tap.
4. Questions, branched on that answer:
   - **Site:** fit for duty, PPE complete, declared activities, optional hazard note.
   - **Office:** fit for duty only.
5. Outcome — cleared, or "report to your supervisor before starting work".

**Idempotency.** If the worker has already checked in today, steps 3–5 are
skipped. `hs_daily_checkins_one_self_per_day` (partial unique index on
`(staff_id, checkin_date) WHERE capture_mode='self'`) enforces one per day, and
the API already returns the existing row with `already_completed: true` rather
than erroring. No server change needed for a second clock-in on the same day.

**Re-prompting after abandonment.** The `/my` hub tile already badges an
outstanding check-in. Make that badge louder when the worker is currently
clocked in. No new nag mechanism.

---

## Data model

One migration on `hs_daily_checkins` (297 rows):

- Add `work_location` — `'site' | 'office'`, NOT NULL, default `'site'`.
- Relax `project_id` to nullable.
- Add `CHECK (work_location <> 'site' OR project_id IS NOT NULL)` — a site
  declaration still requires a project; an office one does not.
- Backfill existing rows to `'site'`. All 297 already carry a project.

Written for the first time by this change, though both columns already exist:

- `attendance_entry_id` — the soft link. Currently accepted by the API
  (`checkin.ts:159-171`) and never populated by any frontend.
- `gps_lat` / `gps_lon` — the clock-in already takes a fix; the standalone page
  sends nothing.

**Downstream impact of a nullable `project_id`:** the officer queries already
`LEFT JOIN projects` and treat the project filter as optional
(`checkinService.ts:148,190,194`). Office rows appear with no project name and
drop out of a project-filtered view, which is the correct behaviour. No caller
requires the column to be non-null.

**Clearance logic** (`checkinClearance.ts`) gains one branch: an office row can
block only on `self_declared_unfit`. The medical / height / plant rules are
site-only and would otherwise evaluate against fields the office path never
asked.

---

## Why the standalone page survives

Deleting `/my/hs-checkin` after this ships would strand real usage. Of 297 self
check-ins:

| Department | Check-ins | No attendance that day |
|---|---|---|
| Field Operations | 163 | 6 |
| Maintenance | 37 | 0 |
| Project Management | 36 | 1 |
| Field (casual) | 21 | 0 |
| Finance | 14 | 0 |
| Projects | 14 | 0 |
| Quality Assurance | 9 | 5 |
| Commercial & Strategy | 3 | 1 |

**13 check-ins had no attendance entry at all that day** — people declaring
fitness without clocking in, over a third of them QA. The standalone page is
their only route, and it is also the recovery path for anyone who abandoned the
combined flow.

What this change retires is the hub tile as the *primary* way in, not the page.
Revisit deletion once combined-flow data shows standalone submissions near zero.

---

## Failure modes

| Case | Outcome |
|---|---|
| H&S POST fails after clock-in committed | Time is kept. Check-in outstanding, visible on the officer board. |
| Worker declares unfit | Attendance stands, row marked `blocked`, outcome screen directs them to their supervisor. |
| Second clock-in same day | H&S steps skipped via the per-day unique index. |
| Signal lost mid-flow | Same as abandonment. Nothing to reconcile. |
| Worker picks the wrong location | Correctable only by an officer today — the per-day unique index prevents re-submission. See open questions. |

---

## Testing

- Unit: the site/office branch (question sets and clearance), the CHECK
  constraint, same-day idempotency, and that a failed H&S POST leaves the
  attendance row intact.
- Migration: applied against a real Postgres, not a mock — including that the
  CHECK rejects a site row with a null project.
- **Browser walk of both paths on dev.** The last two H&S features here each
  shipped a bug that only a real walkthrough caught
  (`project_hs_ppe_acknowledgement.md`). Needs a test staff account; a real
  worker's login is not usable for this.

---

## Out of scope

- The crew-lead flow (`/my/hs-checkin-crew`, 0 rows to date).
- Deleting the standalone check-in page.
- Populating `fleet_authorized_locations` — 0 rows today, which is why site
  cannot be derived from the geofence and is declared by the worker instead.
- Any change to what H&S officers see beyond the office rows arriving.

---

## Open questions

1. **Wrong-location correction.** A worker who picks Office and then goes to
   site cannot re-submit — the per-day unique index blocks it. Officer edit is
   the only route. Acceptable for v1; revisit if it happens.
2. **Clock-out.** This is a start-of-day declaration only. Nothing about the
   H&S flow attaches to clock-out.
