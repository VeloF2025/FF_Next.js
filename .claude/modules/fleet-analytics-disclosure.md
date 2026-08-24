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

- **Organisation and project rows only.** Site aggregates are computed, stored, and never published.
  A site is the smallest group there is and the one an outsider can most easily put a name to.
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

The **organisation takes the minimum tier over its projects**, and must clear its own check at that
tier besides.

A component rooted on an internal tally has no row to publish at TOTAL_ONLY — `incident.total` is no
metric key — so for incidents the two lower tiers collapse into one.

### The proof

Three lines, which is the point of the redesign.

1. **Within a component at FULL**: any value a reader computes is a linear combination of that
   component's variables, and every one of them clears `k`.
2. **Within a component at TOTAL_ONLY**: one value is published, so there is no combination to take.
3. **Across levels**: every key the organisation publishes is published by EVERY project, because
   the organisation's tier is the minimum. So `organisation - sum(projects) = 0`. There is no
   residual to bound — which is what three earlier designs kept failing to do.

Across components there is no relation at all, so mixed tiers at one cell are safe by construction.

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

`hasCompleteAggregateCoverage` counts rows through the view, and the view no longer returns site
rows. A month aggregated by the OLD code whose stored rows are all site-level will therefore report
no coverage and its incidents will not be purged. Failing closed is the right direction for a
deletion gate, and the coverage question is already flagged below as needing an explicit per-month
record rather than an inference from row counts.

## What it costs, measured

On two projects — one of three sites and twenty staff, one of a single site and four — with `k = 5`:

| | value |
|---|---|
| informational rows published | 10 |
| components carrying information that publish | 4 of 15 (26.7%) |
| levels published | project only |

Remove the four-person project and the same fixture publishes 20 rows across organisation and
project. **Every organisation row disappears because one small project exists.** That is the minimum
rule doing exactly what it is specified and proved to do, and it is almost certainly not what anyone
wants.

The tighter rule that would fix it, for whoever picks this up: instead of taking the minimum, let
the organisation publish a component at tier T when the AGGREGATE of the projects not publishing at
T — treated as one virtual cell — itself passes the tier-T check. The proof survives, because
`organisation - sum(published projects)` is then that virtual cell, and it clears the threshold by
the same test every other cell does. The trap is the case of exactly ONE non-publishing project:
there the virtual cell IS that project, so it must pass the check in full, complements included —
which is where a naive "its total clears k" relaxation would leak.

## Where the code is

| File | What it holds |
|---|---|
| `metricRelations.ts` | the denominator table, the partitions, the subset pairs, the components |
| `metricCalculator.ts` | counts everything, complements included |
| `suppression.ts` | the tier rule and the organisation minimum |
| `aggregateSchema.ts` | the table's column allow-list and the view's, which is smaller |
| `scripts/migrations/sql/527_…` | the view |
| `__tests__/releaseOracle.ts` | the independent check, exact integer arithmetic |

The base table's application grant is unchanged, so the database would still permit a direct read of
it. `__tests__/aggregateViewContract.test.ts` is what stops one: it fails the build if any file
outside the writer names the base table in a SQL position, across `app`, `pages`, `src`, `scripts`
and `lib`, in `.ts`, `.tsx`, `.js`, `.mjs` and `.sql`. Splitting the writer onto its own role is what
would let the grant be withdrawn; that remains open.

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
