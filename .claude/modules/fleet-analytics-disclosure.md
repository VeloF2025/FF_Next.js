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
is no view and no RLS; the grant that exists makes it worse rather than better — migration 518
grants `SELECT, INSERT, UPDATE, DELETE` on this table to `fibreflow_user`, the application role, so
the "only writer" property below is a property of the codebase and not one the database enforces.
The first reader that forgets `AND is_active = true` reads withheld groups. If a read path ships,
it must go through a view that hard-codes the predicate — not through a convention.

Note also that raising `k` is exactly the case that recomputes a month to nothing (see
`replaceMonth`), which leaves the PRE-TIGHTENING, more disclosive generation sitting in the table
with only `is_active = false` between it and a reader.

### 3. Weaker, documented, not closed

- **Cross-month differencing.** Nothing published is cumulative, so this isolates no individual
  directly; what it leaks is the publication decision itself — a site present one month and absent
  the next says a specific small group crossed the threshold.
- **Absence as inference.** A metric's absence at a level implies a support between 1 and `k-1`
  (or zero — zero-support metrics are also withheld, which is what provides the cover).
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
