# Fleet operational aggregates — disclosure status

**Status: INTERNAL. Not a published anonymous dataset. Do not expose through an API, an export,
a report, or a UI without doing the design work in "What is still open" below.**

`fleet_operational_monthly_aggregates` (migration 518) was designed as a publishable anonymous
aggregate. Adversarial review on 2026-08-23 (PR #2594) demonstrated that it is not one. The table,
the `contributor_count >= 5` CHECK, and the suppression in
`src/modules/fleet/incidents/analytics/suppression.ts` are all retained and all still do useful
work — but the guarantee originally claimed for them does not hold, and the claim has been removed
from the code rather than left standing.

Its one consumer today is retention's coverage gate: `hasCompleteAggregateCoverage` in
`aggregateRepository.ts`, which retention consults before purging a month. Nothing reads it for
analytics, because the read path (stage 8 tasks 6–10) is not built.

## What the guarantee was meant to be

> No group of fewer than 5 distinct staff can be identified from the published aggregates.

## What actually holds

- **Row shape.** No column can hold a person. The allow-list in `aggregateSchema.ts` and the
  forbidden-token test are real enforcement, checked against `information_schema`.
- **Per-row threshold.** `contributor_count >= 5` is a table CHECK. A group of four cannot be
  stored, so it cannot leak through a query bug.
- **Cross-level differencing.** Subtracting a parent's published children from the parent yields a
  residual describing at least `k` people. Siblings are withheld smallest-first, by contributor
  UNION, until that holds. Verified against the configurations that broke the first attempt.
- **Metric support.** A metric is described by whoever actually contributed to it, never by the
  wider site roster, at every level. No row publishes a value whose support is a single person.
- **Writers.** `replaceMonth` is the only writer, reached only from `aggregationService`, whose
  rows come straight from `releaseAnonymousGroups`.

## What is still open — read before exposing anything

### 1. The metric keys are not independent (the blocking one)

They partition into sums whose totals are published as the denominators of the surviving rows:

| Partition | Sums to | Published as |
|---|---|---|
| `presence.{confirmed,unconfirmed,vehicle_only}_days` | `presence.scheduled_days` | the denominator on all three |
| all 8 `outcome.*` | `outcome.reviewed_total` | their shared denominator |
| all 14 `incident.*` | `incident.total` | denominator of `reliability.{evidence_available,recurrence}` |

Suppression compares siblings **within one metric key** and never compares arithmetically related
keys. So withholding one key while publishing its siblings and their shared denominator recovers
the withheld value by subtraction. Reproduced, single site, single month:

```
presence:  160 - 157 - 0 = 3 unconfirmed days,  support = 1 person
incident:  incident.total(10) - published(8) = 2 accident_sos, support = 1 person
```

And `contributor_count` arithmetic across keys attributes it:
`k(incident.total) - k(incident.late) = 1` — one named person, at a named site, in a named month.

**Closing it needs partition-aware suppression:** treat a partition as one unit, and apply the same
residual rule across its keys — withhold members until the withheld members' combined support
clears the threshold — and never publish a denominator whose partition has a sub-threshold
residual.

### 2. Retired rows are unprotected

`is_active = false` rows are never deleted and nothing but a `WHERE` predicate protects them. There
is no view, no RLS, no grant. The first reader that forgets `AND is_active = true` reads withheld
groups. If a read path ships, it must go through a view that hard-codes the predicate — not through
a convention.

### 3. Weaker, documented, not closed

- **Cross-month differencing.** Nothing published is cumulative, so this isolates no individual
  directly; what it leaks is the publication decision itself — a site present one month and absent
  the next says a specific small group crossed the threshold.
- **Absence as inference.** A metric's absence at a level implies a support between 1 and `k-1`
  (or zero — zero-support metrics are also withheld, which is what provides the cover).

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

- Migration 518 shipped the schema with a comment asserting the table "cannot smuggle an exact
  duration into `sum_seconds`". That was false: a `timing.*` row with `sample_count = 1` is one
  person's exact duration. The migration is applied and is not edited; this note is the correction.
- Two rounds of adversarial review, five findings between them, one of which was introduced by the
  fix for an earlier one. The pattern — each fix revealing another channel — is why the published
  surface is now treated as unbuilt rather than patched again.
