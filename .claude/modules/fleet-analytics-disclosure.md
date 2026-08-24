# Fleet operational aggregates — disclosure status

**Status: a published surface exists, and it is deliberately narrow. Read "What is published" and
"What is out of scope" before building anything on it.**

## History, because it is the argument for the current design

`fleet_operational_monthly_aggregates` (migration 518) was designed as a publishable anonymous
aggregate. Three successive designs tried to make it one, and each worked the same way: publish what
looks safe cell by cell, then search for what a reader could recover and withhold more until the
search comes up empty.

Each design was better than the last and each was broken by the next review.

| Round | What it added | What broke it |
|---|---|---|
| 1 | `contributor_count >= 5` per row | differencing a parent against its published children |
| 2 | cross-level residuals, then cross-KEY partitions | a chain: level relation into partition relation, one person's unconfirmed day |
| 3 | a full derivability closure over the relation graph | `contributor_count` differencing; histogram bucket residuals; combinations outside the closure's stated reach |

Round 3 also measured the cost of the approach: **about 82% of cells withheld** on an ordinary
month. A control that suppresses four rows in five and still has holes is failing at both ends.

So the question changed. **Publish only sets that are closed under the arithmetic** — sets in which
every quantity a reader can compute is one whose support already clears the threshold — and there is
nothing left to search for.

## What is published

Migration 527's `fleet_operational_monthly_aggregates_published` view, and nothing else. It is
narrower than the base table in two ways, both load-bearing:

- **Organisation and project rows only.** No site row is written at all: the release rule decides at
  organisation and project level and never builds a site cell. The view's predicate is therefore
  DEFENCE IN DEPTH — it bounds what a reader can see if a future writer or a hand-run backfill ever
  puts a site row there, and it keeps out the site rows earlier versions of this code did write,
  which are still in the table. A site is the smallest group there is and the one an outsider can
  most easily put a name to.
- **No `contributor_count`, no `sample_count`, no `sum_seconds`, no `bucket_*`.** These were
  disclosure CHANNELS, not metadata. `cc(scheduled) - cc(confirmed) = 1` names a single person
  without touching a numerator, and round 3 measured 658 such hits over 300 seeded months;
  `sum_seconds` over a `sample_count` of one IS that person's exact duration. The base table keeps
  both — the writer needs the count for its own CHECK, and the histogram is what keeps a median
  estimable after the underlying incident has been purged — and neither is anybody's to read.
- **No `checksum`**, which is the one that has to be reasoned about rather than seen.
  `canonicalize` hashes a fixed field order that INCLUDES all four of the columns above, and every
  other field in that preimage is published. The function is in the repository. So a reader holding
  the view holds a sha256 with one small unknown left in it, and a few thousand hashes recovers the
  contributor count exactly — for every row, and `sum_seconds` for timing rows besides. Removing
  three columns and publishing a fourth that reconstructs them is what a column list has to be read
  as a whole to catch. The writer compares checksums against the BASE table.

`generalized_from_level` is also absent, for a different reason: under the tier rule its value is a
function of the row's level, so it carries no information. The notion is gone from the code as well.

**A consequence worth knowing:** with the histogram columns dropped, a published `timing.*` row
carries a metric key and little else. Median estimation is now an internal capability, not a
published one. If the read path needs timings, that is a design conversation, not a column to add
back.

## The release rule

The unit of decision is a **(level, dimension, component)**. A component is a connected piece of
`metricRelations.ts`: presence is one; incidents, their outcomes and the two reliability ratios over
`incident.total` are one; driver input is one; each remaining reliability pair is one; each timing
key is a component by itself. Two variables in different components have no arithmetic between them.

Three tiers:

- **FULL** — every variable in the component clears `k`, or has nobody behind it at all: every
  member, every total, and every complement of every subset and partition relation. Publish the
  whole component, denominators included.
- **TOTAL_ONLY** — else, if the component's root total clears `k`, publish that one row and nothing
  else. One value per component means no difference can be taken inside it.
- **NONE** — otherwise nothing.

The organisation is decided differently, because it is the only level with published children.
Subtract the projects that published from the organisation and what is left is the sum of the ones
that did not, so that sum has to be safe. The organisation publishes at the highest tier `T` where
all three of these hold:

1. its own numbers pass the tier-`T` check;
2. **every project is all-in or all-out** — it publishes at `T` or better, or it publishes nothing;
3. the projects publishing nothing, aggregated into ONE VIRTUAL CELL with supports unioned and
   complements taken from the calculator's own tallies, pass the tier-`T` check themselves.

A component rooted on an internal tally has no row to publish at TOTAL_ONLY — `incident.total` is no
metric key — so for incidents the two lower tiers collapse into one.

### The proof

1. **Within a component at FULL**: any value a reader computes is a linear combination of that
   component's variables, and every one of them clears `k`.
2. **Within a component at TOTAL_ONLY**: one value is published, so there is no combination to take.
3. **Across levels**: by condition 2 the projects divide into those publishing at least the
   organisation's key set and those publishing nothing. So for every key the organisation publishes,
   `organisation - sum(publishing projects)` is exactly the virtual cell's value for that key — and
   by condition 3 the virtual cell passed the same check every real cell passes. At FULL that means
   every one of its variables clears `k`, complements included; at TOTAL_ONLY, its root does.
4. **The reader recovers the virtual cell's WHOLE component**, not one key of it, which is why the
   check is the full tier check and not merely "its total clears `k`". Where only one project is
   silent the virtual cell IS that project, so that project must pass in full.
5. **Where no project is silent** the virtual cell has nobody behind anything, every check passes
   vacuously, and the difference across levels is zero.

Across components there is no relation at all, so mixed tiers at one cell are safe by construction.

Conditions 2 and 3 were both learned from the randomised sweep rather than designed, and both are
worth stating as traps:

- **A project half-in is not safe.** An earlier version asked only that the silent projects be safe.
  A project publishing its ROOT while the organisation published MEMBERS couples the two groups
  through the organisation's member values, and seed 196 pinned a four-person residual through that
  coupling. Hence all-in or all-out.
- **The virtual cell's complements are load-bearing, and only the SUBSET ones.** A partition
  member's complement is the union of the other members, so it clears whenever they do — checking it
  is free but adds nothing. A subset complement is counted separately by `metricCalculator` because
  it cannot be inferred from the members at all: two silent projects can have six people between
  them sending and receiving notifications while the notifications that FAILED belong to two.

This replaced taking the MINIMUM tier over the projects — the special case that refuses whenever any
project is silent. It was sound and needlessly lossy: one small project silenced the organisation
entirely.

### Why the complements have to be counted, not inferred

`input.requests_sent - input.responses_received` is the requests nobody answered: a real quantity,
with people behind it, and no metric key to carry it. The FULL check turns on how many people that
is, and the only place it can be counted exactly is `metricCalculator`, off the same fact that counts
the pair. Reconstructing it later from the two contributor sets gives a BOUND, and the bound
understates badly enough to over-suppress on its own.

Counting them exactly also turned up a gap between the model and the fact CONTRACT: nothing in
`metricCalculator` required `driverInputOnTime` to imply `driverInputResponded`, while the release
rule asserts `responses_on_time ⊆ responses_received`. In production the two cannot disagree —
`incidentFactQueries.ts` derives both from `sub.first_submitted_at`, and the on-time expression
tests it for NULL before comparing — so this was never a data bug. The calculator now gates one on
the other anyway, the same way both are gated on `driverInputRequested`: defence in depth, and the
invariant the rule depends on becomes structural rather than a property of one query.

## What this actually guarantees, and what is out of scope

**Guaranteed.** No published value, and no combination of published values, is a quantity whose
support is between one and `k-1` people. That follows from the tier rule directly rather than from a
search, and `__tests__/releaseOracle.ts` checks it independently over randomised months by solving
the reader's whole system in exact integer arithmetic.

**Out of scope, explicitly:**

- **Anything about site-level data.** It is not published, so it is not protected — it is absent.
- **l-diversity.** `k` bounds how many people are in a bucket, never how much of it belongs to one of
  them. A residual of 1,005 over six people can be 1,000 one person's and 1 each for the other five.
  Read `contributor_count >= 5` as "at least k people are in the bucket", never as "no individual is
  exposed".
- **Cross-month differencing.** Nothing published is cumulative, so this isolates no individual
  directly; what it leaks is the publication DECISION — a component published one month and absent
  the next says its variables crossed the threshold.
- **Absence as inference.** A component's absence implies a support between 1 and `k-1`, or zero.
- **Timing content.** See above: the view publishes no histogram, so a timing row is nearly empty.

## Deploying this

Migration 527 must be applied before this code serves a read. It is, automatically:
`scripts/deploy-local.sh` is a launcher that fetches and runs `deploy-local-main.sh` from
`origin/master`, and that script applies pending migrations at **step 3a, before the build** —
`run-pending-migrations.sh`, failing the deploy on a migration error rather than continuing. So the
ordering is structural, not something to remember.

Two things about it are worth knowing:

- **The database is shared between dev and production.** Applying 527 on a dev deploy creates the
  view for production at the same moment. That is safe here only because nothing in production reads
  it yet.
- **The migration DROPs and recreates the view** rather than using `CREATE OR REPLACE`. Postgres
  refuses to drop a column from a view in a replacement, and this column list narrowed twice during
  review. Verified 2026-08-24: neither the view nor the migration exists in the shared database, so
  no deployed reader is disturbed.

### Operational consequence: months that will stop reporting coverage

`hasCompleteAggregateCoverage` counts rows through the view, and the view returns no site rows. A
month whose STORED rows are all site-level — written by an earlier version of this code, before the
rule stopped producing them — will therefore count zero and report no coverage. Its incidents are
then never purged.

- **Direction.** It fails CLOSED. Nothing is deleted that should not have been; the gate simply stops
  authorising deletion for those months.
- **Is anything deleting today?** No. `live_retention_enabled` defaults to `false` in migration 518
  and reads `false` in the shared database (checked 2026-08-24). The retention run reports what it
  WOULD delete rather than deleting it, so this consequence is inert until that flag is turned on.
  Check it before enabling: `SELECT live_retention_enabled FROM fleet_operational_analytics_settings`.
- **Which months.** Only those outside the nightly recompute window. A month still inside the window
  is recomputed on the next run and gets organisation and project rows like any other.
- **The backfill.** Re-run the aggregation cron for the affected months — the same job, over an older
  range. It recomputes them under the current rule and writes organisation and project rows, at
  which point coverage reports normally. No data migration and no SQL by hand.
- **The underlying problem is still the one below**: coverage is INFERRED from the presence of rows
  rather than recorded per month. Until that changes, "no rows" and "no qualifying data" are the same
  observation.

## What it costs, measured

On two projects — one of three sites and twenty staff, one of a single site and six — with `k = 5`:

| | value |
|---|---|
| informational rows published | 21 |
| components carrying information that publish | 12 of 15 (80.0%) |
| levels published | organisation and project |

Under the minimum rule the same fixture published 10 rows, 4 of 15 components, and **no organisation
row at all**.

One case the virtual cell cannot rescue, and no rule can: a project of four people, with `k = 5`.
The residual an organisation row would leave is those four, however it is computed. That is the
threshold refusing, not the rule being lossy, and `belowThresholdMonth` in the fixtures keeps it
where it belongs — the organisation goes quiet and the project rows still publish.

## Running the checks

```bash
npx vitest run src/modules/fleet/incidents/analytics          # the unit suite; ~32 randomised months
SEEDS=400 npx vitest run …/__tests__/releaseDisclosure.test.ts  # the extended sweep
npm run typecheck:analytics-tests                             # the tests themselves, which the root tsconfig excludes
TEST_DATABASE_URL=… npm run test:migrations -- tests/migrations/527_fleet_aggregates_published_view.test.ts
```

`typecheck:analytics-tests` is deliberately not wired into a CI gate: its only errors today are
pre-existing ones in `src/modules/fleet/operations`, reached transitively, and turning it into a gate
would mean fixing those first. The analytics tree and its `__tests__` are clean under it.

## Where the code is

| File | What it holds |
|---|---|
| `metricRelations.ts` | the denominator table, the partitions, the subset pairs, the components |
| `metricCalculator.ts` | counts everything, complements included |
| `suppression.ts` | the tier rule and the organisation minimum |
| `aggregateSchema.ts` | the table's column allow-list and the view's, which is smaller |
| `scripts/migrations/sql/527_…` | the view |
| `__tests__/releaseOracle.ts` | the independent check, exact integer arithmetic |
| `operationsAggregateQueries.ts` | the only reader of the view: project and organisation branches, no site |
| `operationsScope.ts` | the retention boundary, and which filters are refused over a purged month |

The base table's application grant is unchanged, so the database would still permit a direct read of
it. `__tests__/aggregateViewContract.test.ts` is what stops one: it fails the build if any file
outside the writer names the base table in a SQL position, across `app`, `pages`, `src`, `scripts`
and `lib`, in `.ts`, `.tsx`, `.js`, `.mjs` and `.sql`. Splitting the writer onto its own role is what
would let the grant be withdrawn; that remains open.

## The read path that consumes this (PR 8 task 7)

`GET /api/fleet/analytics/operations` and `GET /api/fleet/analytics/operations/drill-down`, both
gated on `fleet.incidents:view`. What they do with this table, and why it is consistent with the
rule above:

- **They read the published view only, and only for purged months.** A month whose identifiable
  detail still exists is derived LIVE from facts. The boundary is the purge's own and the purge
  works by DAY, so a month counts as retained only when its FIRST day is at or after
  `resolveCutoffWorkDate`; a half-purged month is read from the aggregates, which were written while
  all of its detail existed, rather than derived from the days that happened to survive.
- **They never ask for a site.** The view publishes organisation and project rows only, so `op_site`
  is refused with a 400 over any purged month rather than answered from the site's project row —
  which would widen the answer to every other site in that project. It is answered normally over
  retained months, where the facts still carry a site.
- **They never ask for an incident attribute either.** `op_driver`, `op_vehicle`, `op_type`,
  `op_severity`, `op_outcome` and `op_evidence` name attributes of one incident, and none survives
  into a monthly count. Same 400, same reason: dropping a filter WIDENS the answer without saying so.
- **A TOTAL_ONLY component renders as a total with nothing under it.** The members are omitted from
  the response — never rendered as zero, which would say the opposite of what happened — and a notice
  says the narrower figures were withheld. The total's denominator stays null for the same reason.
- **No histogram is reported for a purged month.** The view has no bucket columns; null says "we no
  longer hold the durations" where an empty bucket array would say "none were recorded".

**The live half carries no k-anonymity, deliberately.** It is not read from the aggregates even
though they cover recent months, because those rows are k-anonymised and a manager of a three-person
site would find their own current numbers withheld from them by machinery meant to protect data that
outlives the retention window. The live half needs none: access is already confined to the projects
the viewer manages under `fleet.incidents:view`, and every incident behind a number is one they can
open in their own queue.

**That is a property of the gate, not of the numbers.** A caller reaching this code with a wider
audience — an export handed to a client, a public dashboard, a broader permission — invalidates the
reasoning above rather than merely changing the figures. Re-derive it before widening the audience.

## Consequences of withholding zero-support metrics

A metric nobody contributed to has an empty support and is withheld, rather than published as a
roster-sized zero. That closed a real leak — see `anonymitySetFor` — but it means a month can
legitimately store NO rows, and `hasCompleteAggregateCoverage` reads stored rows as proof that a
month was aggregated. A month with no qualifying data therefore reports no coverage and its
incidents are never purged.

Failing closed is the right direction for a deletion gate, but it is not a working retention path.
**Coverage should be recorded explicitly per month on the aggregation run, not inferred from the
presence of aggregate rows.** That needs a migration and is the next piece of work here.

## History

- Migration 518's comment says a **non-timing** row "cannot smuggle an exact duration into
  `sum_seconds`" — which is true, and enforced by `histogram_pairing`. An earlier draft of this
  note quoted it with the subject dropped and called it false; that was this note's own error, now
  corrected. The substantive point stands on its own: a `timing.*` row with `sample_count = 1` IS
  one person's exact duration, no schema constraint can prevent it, and the calculator is what
  does.
- Two rounds of adversarial review, five findings between them, one of which was introduced by the
  fix for an earlier one. The pattern — each fix revealing another channel — is why the published
  surface is now treated as unbuilt rather than patched again.
