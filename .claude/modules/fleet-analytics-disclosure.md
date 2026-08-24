# Fleet operational aggregates — disclosure status

**Status: INTERNAL. Still not a published anonymous dataset — read "What is still open" before
exposing it, and treat section 3 as live.**

The two items that blocked a read path were first declared closed on 2026-08-24. Two blind reviews
of PR #2604 reopened the first of them, five working attacks between them, and it has now been
closed three times. What that history is worth recording for:

1. The first rule was *local* — it asked what had been published at the cell in front of it. Both
   attacks walked to a neighbouring cell and came back.
2. The second was global but *incomplete*: it dropped relations that had no known variable, it did
   not model the incidents nobody reviewed, and it forgot that a published row prints its own
   DENOMINATOR — so a withheld population could be sitting in full in a surviving row's denominator
   column.

Read the state below as of the third attempt, and read "What this actually guarantees" before
treating it as settled.

- **Cross-key differencing (open item 1)** — closed by `derivability.ts`, which decides against what
  a reader can DERIVE rather than against what was published anywhere in particular.
  `metricPartitions.ts` and `applyPartitionRule` survive as heuristics that make good local choices
  first; they are no longer what carries the guarantee. See "The metric keys are not independent"
  below.
- **Retired rows (open item 2)** — closed by migration 527's
  `fleet_operational_monthly_aggregates_published` view, which hard-codes `is_active = true`, plus
  a CI guard that fails the build if any file outside the writer queries the base table. The guard's
  sampling frame was itself too narrow until the same review; it now covers `pages`, `src`,
  `scripts` and `lib`, and `.js`/`.mjs` as well as `.ts`.

What has NOT changed: everything in section 3, and the fact that `contributor_count >= 5` bounds
how many people are in a bucket and never how much of it belongs to one of them.

`fleet_operational_monthly_aggregates` (migration 518) was designed as a publishable anonymous
aggregate. Adversarial review on 2026-08-23 (PR #2594) demonstrated that it is not one. The table,
the `contributor_count >= 5` CHECK, and the suppression in
`src/modules/fleet/incidents/analytics/suppression.ts` are all retained and all still do useful
work — but the guarantee originally claimed for them does not hold, and the claim has been removed
from the code rather than left standing.

Its one consumer today is retention's coverage gate: `hasCompleteAggregateCoverage` in
**`src/modules/fleet/incidents/retention/retentionRepository.ts`** — the only implementation, and
the one `retentionService` calls. (A second, identical copy briefly existed in
`aggregateRepository.ts` with no production caller; it was removed. Two implementations of a gate
that authorises deletion is the pair that drifts, and the one with no caller drifts silently.)
Nothing reads the table for analytics, because the read path (stage 8 tasks 6–10) is not built.

## What the guarantee was meant to be

> No group of fewer than 5 distinct staff can be identified from the published aggregates.

## What actually holds

- **Row shape.** No column can hold a person. The allow-list in `aggregateSchema.ts` and the
  forbidden-token test are real enforcement, checked against `information_schema` in a blocking CI
  step. Limit worth knowing: the check applies migration 518 into a scratch schema, so it pins
  edits to 518 — a LATER migration doing `ALTER TABLE … ADD COLUMN` would not appear there and
  would be caught by neither contract test.
- **Per-row threshold.** `contributor_count >= 5` is a table CHECK. A group of four cannot be
  stored, so it cannot leak through a query bug.
- **Cross-level differencing.** Subtracting a parent's published children from the parent yields a
  residual whose SUPPORT is at least `k` people. Siblings are withheld smallest-first, by
  contributor UNION, until that holds. Verified against the configurations that broke the first
  attempt, and independently against 200,000 randomised configurations with 0 violations.

  **This bounds how many people are in the residual, not how much of it is any one of them.**
  There is no l-diversity and no bounded-contribution rule. A residual of 1,005 over six people can
  be 1,000 one person's and 1 each for the other five:

  ```
  sites: a = 5 people num 5 | b = 5 people num 5 | c = 1 person num 1000
  published: site b (5), project (1010, cc=11)
  residual = 1005 over 6 people — of which 1000 belongs to one of them
  ```

  Anyone who knows the site is dominated by one driver recovers that driver's figure. Read the
  claim as "at least k people are in the bucket", never as "no individual is exposed".
- **Metric support.** A metric is described by whoever actually contributed to it, never by the
  wider site roster, at every level. No row publishes a value whose support is a single person.
- **Writers.** `replaceMonth` is the only writer *in this codebase*, reached only from
  `aggregationService`, whose rows come straight from `releaseAnonymousGroups`. This is a property
  of the code, not of the database: the application role holds full DML on the table (see open
  item 2), so a stray query or a future module can write it directly.

## What is still open — read before exposing anything

### 1. The metric keys are not independent — CLOSED 2026-08-24, REOPENED and closed again the same day

They partition into sums whose totals are published as the denominators of the surviving rows:

| Partition | Sums to | Published as |
|---|---|---|
| `presence.{confirmed,unconfirmed,vehicle_only}_days` | `presence.scheduled_days` | the denominator on all three |
| all 8 `outcome.*` | `outcome.reviewed_total` | their shared denominator |
| all 14 `incident.*` | `incident.total` | denominator of `reliability.{evidence_available,recurrence}` |

And they nest, which the first attempt missed entirely — a pair with no total and no partition, just
one key counting a subset of another:

| Superset | Subset | What the pair publishes |
|---|---|---|
| `input.requests_sent` | `input.responses_received`, `input.responses_on_time` | requests nobody answered |
| `input.responses_received` | `input.responses_on_time` | responses that came in late |
| `reliability.notifications_sent` | `reliability.notifications_delivered` | notifications that failed |
| `reliability.monitor_runs_expected` | `reliability.monitor_runs_completed` | runs that never happened |

The complement has no metric key, so no rule that iterates over metric keys was ever going to see
it. Its support is taken as superset-minus-subset: contributors who appear in the one and not the
other must be in the complement, and that is a LOWER bound, which is the safe direction for a
threshold test.

Suppression compares siblings **within one metric key** and never compares arithmetically related
keys. So withholding one key while publishing its siblings and their shared denominator recovers
the withheld value by subtraction. Reproduced, single site, single month:

```
presence:  160 - 157 - 0 = 3 unconfirmed days,  support = 1 person
incident:  incident.total(10) - published(8) = 2 accident_sos, support = 1 person
```

And `contributor_count` arithmetic across keys attributes it:
`k(incident.total) - k(incident.late) = 1` — one named person, at a named site, in a named month.

**Why the first attempt did not hold.** `partitionSacrifices` decides at one cell, against what was
published at that cell. Both reproductions in the PR #2604 review start there and walk somewhere
else:

```
project confirmed 110 (cc 12) - site s2 confirmed 50 (cc 6)  = site s1 confirmed 60
site s1 scheduled 100 - 60 - site s1 vehicle-only 39         = 1 unconfirmed day, ONE person
```

```
input.requests_sent 6 (cc 6) - input.responses_received 5 (cc 5)
  = one driver at a named site who answered nothing
```

The first chains a level relation into a partition relation; the second uses a relation that was
not modelled at all. Neither cell was ever examined by the rule that was supposed to protect it.

**How it is closed now.** `derivationModel.ts` names every value a reader could hold — one metric
key at one cell, plus the two internal denominator tallies and the subset complements — and every
identity between them: a parent is the sum of its children, a partition's total is the sum of its
members, a superset is its subset plus the complement. The nesting pairs are DERIVED from
`metricCalculator`'s `DENOMINATOR_OF` rather than listed by hand, because a hand-written list is
exactly what missed three of them.

A variable is known if a published row states it, if a published row PRINTS IT AS A DENOMINATOR, or
if nobody is behind it. `derivability.ts` row-reduces the resulting linear system and then asks, of
each small group of withheld variables, whether the reader can pin down some combination of exactly
those. That is a question about the row SPACE, not about the basis the elimination happened to
produce — a randomised sweep found a pair of withheld incident cells whose sum was pinned by a
combination no basis row named.

`suppression.ts#repairDerivability` then withholds rows — smallest support first, ties on the row's
identity, so a re-run stays byte-identical — until no such combination remains. It terminates
because every round withholds a row that was published, and it is correct in the limit for the same
reason: with nothing published, no relation is anchored and nothing is derivable.

Four things about this are worth knowing:

- **Row reduction, not propagation.** The first version of the closure handed over the last unknown
  in a relation and repeated. That is strictly weaker, and the randomised property test found a
  residual it could not see within 56 configurations — three cells across two sites, pinned only by
  ADDING two relations together.
- **A relation with no known variable is still a constraint.** Admitting only anchored relations
  reads as harmless and is not: an anchorless relation hands over no number by itself, but combines
  with an anchored one to pin something neither could pin alone. The anchor test belongs AFTER
  elimination, on the reduced row, where "did the published rows give this away" can be asked.
- **A published row prints its denominator.** `input.requests_sent` can be withheld from the cube
  and printed in full in the denominator column of the `input.responses_received` row beside it.
  Three families were exposed this way.
- **Incidents nobody reviewed.** `outcome.reviewed_total` is bumped only where an incident HAS an
  outcome. The difference from `incident.total` is a quantity with people behind it, no metric key,
  and no partition — until it was modelled, nothing could see it.
- **Withholding every member is not always enough.** Where a partition's members do not between
  them cover everyone the total counts, the total is still published with nothing left to hide the
  residual behind. So the total goes too — `presence.scheduled_days` for presence, and
  `reliability.evidence_available` / `reliability.recurrence` for incidents, both of which are
  ratios over `incident.total`. This is the "never publish a denominator whose partition has a
  sub-threshold residual" half, and a 20,000-case randomised property test is what surfaced it.
- **An incident member does not publish `incident.total`.** `incident.*` rows are bare counts with
  no denominator, so a surviving member gives a reader nothing to subtract from. Only the two
  reliability carriers do. Treating them like presence and outcome members over-suppressed every
  incident partition that had a small member.
- **The axes interact.** A sacrifice made across keys can withhold a parent whose children the
  cross-level rule had already published, so the "a withheld parent publishes nothing beneath it"
  invariant is re-established after every round (`cascadeWithholding`).

**Where the test oracle lives, and why it is written twice.** `__tests__/derivabilityOracle.ts`
answers the same question by a deliberately different method, and shares as little with the code it
audits as can be managed:

| | `derivability.ts` | the oracle |
|---|---|---|
| arithmetic | floating point, zero within 1e-9 | exact `bigint` rationals |
| question | does the row space meet these variables' span? | is this combination uniquely determined? |
| computed from | the row space | the NULL space |
| anchoring | anchors carried through the reduction | the system solved twice, with and without the published rows |
| relations | `metricPartitions.ts` | rebuilt from `metricCalculator`'s tables |

The first version of the oracle shared all five and was worth very little. Four of the five findings
against this module were reproduced by the sweep the oracle drives; the fifth was found by reading.

## What this actually guarantees

Stated precisely, because "no group of fewer than 5 can be identified" is not what is enforced:

- **Complete** for single values. No withheld metric cell, partition total or subset complement is
  recoverable while fewer than `k` people are behind it. All five reproduced attacks were of this
  shape or one step from it.
- **Complete for pairs and triples** of withheld CELLS whose combined support is under the
  threshold — the residual rule, extended past the elimination basis to the whole row space.
- **NOT searched:** combinations of four or more withheld cells. None has been observed across
  450 randomised configurations of every relation-carrying family plus 4,000 presence-only ones,
  but that is a bound on the search, not a proof.
- **NOT searched:** combinations that include a subset COMPLEMENT. Those are checked one at a time,
  where their support means something. A complement's support is a lower BOUND, and summing bounds
  stops meaning anything — the three complements of one presence partition add up to twice its
  total, so their bounds union to fewer people than the total's own support. Judging that a
  disclosure is an artefact of how it was written down.
- **Still not** l-diversity. Everything in the "What actually holds" section above about a residual
  of 1,005 over six people stands unchanged.

### 2. Retired rows — CLOSED 2026-08-24

`is_active = false` rows are never deleted and nothing but a `WHERE` predicate protects them. There
was no view and no RLS, and the first reader that forgot `AND is_active = true` would have read
withheld groups — silently, because the omission returns more rows rather than an error.

Migration 527 adds `fleet_operational_monthly_aggregates_published`, a `security_barrier` view over
the allow-listed columns with `is_active = true` hard-coded, and `retentionRepository.ts`'s coverage
gate — the only reader that existed — now goes through it.

(It was written as migration 525 and renumbered when master landed a 525 and a 526 of its own.)

**The grant is unchanged, and that is the residual risk.** `fibreflow_user` keeps `SELECT` on the
base table because Postgres requires it for any column named in an `UPDATE`'s `WHERE` or
`RETURNING`, so revoking it would break `replaceMonth` and the purge with it. Splitting the writer
onto its own role is what would let the grant be withdrawn; that is an architectural change, not a
migration, and remains open. Until then the database would still permit a direct read, and the
thing that actually stops one is `aggregateViewContract.test.ts`, which fails the build if any file
outside the writer names the base table in a `FROM`/`JOIN`/`INTO`/`UPDATE` position.

That guard is only as good as where it looks and what it matches, and it was weak on both counts
until the PR #2604 review. It scanned `src/modules/fleet` and `.ts`/`.tsx` only, which excluded the
`pages/api/**` handlers that write raw SQL, `src/services`, `src/lib`, `scripts/`, and every `.js`
and `.mjs` file; and its pattern demanded whitespace straight after the keyword and a bare name, so
`FROM public.x` and `FROM "x"` both went past. Both are fixed, the frame is asserted by a test of its
own, and the fix was checked by planting a real offender under `pages/api/fleet` and watching the
guard name it.

Note also that raising `k` is exactly the case that recomputes a month to nothing (see
`replaceMonth`), which leaves the PRE-TIGHTENING, more disclosive generation sitting in the table
with only `is_active = false` between it and a reader.

### 3. Weaker, documented, not closed

- **Cross-month differencing.** Nothing published is cumulative, so this isolates no individual
  directly; what it leaks is the publication decision itself — a site present one month and absent
  the next says a specific small group crossed the threshold.
- **Absence as inference.** A metric's absence at a level implies a support between 1 and `k-1`
  (or zero — zero-support metrics are also withheld, which is what provides the cover).
- **A subset complement's support is bounded, not known.** The pairs in section 1 publish a
  difference whose people we can only bound from below: contributors in the superset and not in the
  subset. Someone who appears in both may also sit in the complement, and nothing counts them. The
  guard is therefore sound in the direction that matters — it never UNDER-states the complement's
  exposure — but the number it protects is a bound, not the support. Counting the complement
  properly means tallying it as its own key in `metricCalculator.ts`, which is a schema change.
- **`generalized_from_level` announces suppression outright.** A project row carrying
  `generalized_from_level = 'site'` states that at least one site beneath it was withheld. That is
  a stronger signal than absence, and it is published on the row.

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
