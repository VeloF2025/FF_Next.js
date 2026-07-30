# H&S Rollout Snapshot Date Timezone Design

## Goal

Make the operational rollout snapshot count PostgreSQL `date` values on their
stored calendar day in every runtime timezone, including SAST.

## Root cause and evidence

`hs_daily_checkins.checkin_date` is a PostgreSQL `date`. The rollout loader
currently selects it without a cast, accepts either `Date` or `string`, and
normalizes `Date` with `toISOString().slice(0, 10)`.

On the SAST dev server, node-postgres represents a stored `2026-07-30` as
midnight SAST, whose UTC instant is `2026-07-29T22:00:00.000Z`. The loader
therefore classifies all 30 July rows as 29 July.

At 2026-07-30 12:17 SAST:

- Direct PostgreSQL readback returned 9 check-ins for 30 July: 5 blocked and
  4 cleared.
- The same deployed loader reported 0 check-ins for 30 July and treated all
  23 clocked-in staff as missing a check-in.
- Direct staff-level comparison returned 8 clocked-in staff with a check-in
  and 15 without one.

## Chosen design

Follow the existing H&S pure-date boundary pattern:

1. Select `c.checkin_date::text AS checkin_date`.
2. Type `CheckinDbRow.checkin_date` as `string`.
3. Remove the JavaScript `Date`-to-UTC normalization and use the returned
   `YYYY-MM-DD` string directly.

The SQL `BETWEEN $1::date AND $2::date` filter and ordering remain on the raw
database column. There is no schema, API, or stored-data change.

## Alternatives rejected

- Formatting a returned `Date` in `Africa/Johannesburg` would repair this
  deployment but preserve a fragile driver/timezone dependency.
- Changing the global node-postgres date parser would affect unrelated queries
  and is too broad for this defect.

## Regression test

Extend `scripts/__tests__/hs-operational-rollout-live.test.ts`. The disposable
PostgreSQL adapter will emulate the production node-postgres boundary by
returning a SAST-midnight `Date` only when the check-in query omits the text
cast.

Before the production change, the existing adoption and blocker assertions
must fail because the row shifts to the previous UTC day. After the text cast,
the same real loader query returns plain date strings and all existing expected
counts and dates pass.

The test protects consumer-visible snapshot behavior; it does not merely scan
source text.

## Verification

- Observe the new regression fail before implementation.
- Run the focused rollout live-loader and pack suites after implementation.
- Run `npm run ci:quick`.
- Run the repository suite and report any environment-dependent baseline
  failures separately.
- After merge and dev deployment, compare the live loader adoption counts with
  direct read-only PostgreSQL counts for the same SAST date.

## Safety boundaries

- No database writes, schema migrations, medical overrides, contractor
  mappings, role changes, or announcement sends.
- The staff announcement draft and its wording are unaffected.
- Production deployment is outside this change; dev deployment follows the
  mandatory `scripts/deploy-local.sh dev` path.
