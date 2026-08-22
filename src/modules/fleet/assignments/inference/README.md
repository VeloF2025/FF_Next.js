# GPS site inference

Proposes which project each vehicle's driver works at, from where the vehicle
actually stood. Every output is a suggestion a person edits; nothing here
reaches the roster without someone pressing Assign and then Apply.

## The three tuning decisions, and the measurements behind them

All figures measured against production on 2026-08-21 over 2026-07-16 → 2026-08-21
(306,675 positions, 18 vehicles with GPS, 24 vehicles with an active driver).

### Dwell is time-weighted, not ping-counted

Median gap between consecutive pings, by speed:

| state | pings | median gap | mean gap |
|---|---|---|---|
| moving (>20 km/h) | 87,762 | 11s | 22s |
| slow (0–20 km/h) | 138,638 | 3s | 20s |
| stopped (0 km/h) | 79,249 | 30s | 389s |

The tracker samples far harder while moving, so raw ping-share **under**-weights
standing still — the exact signal "worked at this site" needs. Each position is
therefore credited with the seconds until the next one, capped at 900s
(p99 of all gaps is 1,028s), so one weekend of silence cannot outweigh a month
of work. The last position in the window is credited 0 rather than a full cap:
`LEAST(NULL, 900)` returns **900** in Postgres, and written the obvious way every
vehicle silently banks 15 minutes it never spent.

In practice the two metrics rank the same project first for all 18 vehicles and
differ by at most 7pp (MW67LFGP Lawley: 46.9% ping-share vs 54.1% dwell-share),
so this changed no classification on the day it was measured. It is the defensible one, and it is the
one that stays right if the tracker's sampling policy changes.

### `ignition` and `speed_kph` do not filter the sample

97% of positions (298,120 of 306,675) already carry `ignition = true` — the
tracker mostly reports only while the engine runs, so parked-with-ignition-off
dwell is invisible either way and filtering on it would discard almost nothing.
Filtering to `speed_kph = 0` was measured and moves dominant shares by 0.6–2.3pp
(MW67LZGP 67.8% → 69.2%, MW94RBGP 83.9% → 86.2%) while discarding ~70% of the
sample for the high-volume vehicles. It flipped no classification on the day it was
measured and costs statistical power, so it is not applied. The 900s gap cap already recovers most
ignition-off parking, because the silence before the next ignition-on ping is
credited up to the cap.

### The confidence threshold is 70%, and one vehicle sits on the line

Measured dominant dwell shares on 2026-08-22, sorted:

```
100% x8 · 97.5 · 89.8 · 86.2 · 85.7 · 85.0 · 70.9 | 67.2 · 55.9 · 29.7
```

70% separates the two groups, but **MW67LZGP is only 0.9pp above it**, and that
is not a stable position. The same vehicle measured 67.8% on 2026-08-21: it was
classified `roaming` one day and `confident` on Lawley the next. Two things
changed between the runs — the window slid a day, and Thembisa POP 1's AOI was
corrected — and no attempt is made here to attribute the move to one of them,
because the point is that a 3pp swing happened at all while the margin is 0.9pp.
Switching `ST_Contains` to `ST_Intersects` was measured separately and is not the
cause: on an identical window it changed one ping out of 37,000 and moved no
share by a measurable amount.

Two conclusions, and the second matters more than the first:

1. No threshold fixes this. Moving the line to 75% or 65% only changes *which*
   vehicle is borderline, because the distribution has no wide empty band once
   more than a month of data is in it. (It had one on 2026-08-21 — 11.8pp between
   79.6% and 67.8% — which is exactly the kind of gap that looks like signal for
   a day and then closes.)
2. This is why the output is a proposal and not an answer. A vehicle near the
   line is displayed with its full breakdown (MW67LZGP: Lawley 71%, Thembisa
   POP 1 ~26%), so a person can see for themselves that it is marginal and
   decide, rather than being handed a verdict whose confidence the number does
   not actually support.

Day-to-day variance is largest for the low-sample vehicles, as expected:
LG94NLGP moved 79.6% -> 85.7% and KNK878EC 100% -> 97.5% over the same day.
Read a single day's classification as a starting point for a conversation, not
as a measurement.

### Minimum sample: ≥50 in-AOI pings and ≥3 distinct SAST days

Days are counted in `Africa/Johannesburg`, not UTC — a 21:00 UTC ping and a
22:30 UTC ping are two different working days in SAST.

The only vehicle this abstains on is HW50KNGP: 38 in-AOI pings spread over five
projects across 15 days. It is the vehicle most easily mistaken for a roamer,
and 38 pings is not evidence of anything.

## AOI source

`project_aois`, never `fno_atlas_project_aois`. The atlas table has no project
link and carries overlapping live duplicates for the same place (`LAW` and
`Lawley` are both live rows), which would split one vehicle's dwell in two and
manufacture roaming. `project_aois` has a real FK to `projects` and exactly one
AOI per project.

Two real AOIs genuinely overlap: Thembisa POP 1 covers 13.91% of Thembisa POP 3's
area (re-measured 2026-08-22, after the AOI correction below, so this is a real
overlap and not an artefact). A position inside N AOIs therefore contributes 1/N
to each, and shares still sum to 1.

**`project_aois` is only as good as the poles behind it.** On 2026-08-21 a single
mis-assigned pole — captured in QField as "New pole", 145 km out — inflated
Thembisa POP 1's convex hull from 4.1 km² to 258.9 km², a 63x blow-up, and this
module read that hull. It has since been corrected (2,815 poles, 4.10 km²) and
migration 523 adds a detect-and-flag guard, but nothing in this module validates
its input: a distorted hull would silently credit dwell to the wrong project and
the output would look entirely ordinary. Sanity-check AOI areas before trusting a
run. All nine currently sit between 1.47 and 9.72 km².

Containment uses `ST_Intersects`, not `ST_Contains`. The AOI is a convex hull of
the project's poles, so a position at a hull vertex lies exactly on the boundary;
`ST_Contains` excludes the boundary and would credit that position to no project
at all. A vehicle standing on the edge of a site is at the site. This is rare
enough that it changes no vehicle's classification today, but it is now a
deliberate choice with a test on both sides of the edge rather than a default.

## Concurrency between two people

`fleet_site_inference_decisions.revision` is a compare-and-set token: a caller
sends back the `decisionRevision` they read, and the update is conditional on it,
so the second of two people editing the same vehicle is told rather than silently
losing. `decided_at` was tried first and is the wrong token twice over —
`timestamptz` keeps microseconds a JS `Date` cannot round-trip (so the
precondition would have failed for *every* caller, not just stale ones), and two
writes inside one millisecond are indistinguishable by clock. An integer has
neither problem.

Note the asymmetry this closes. The machine-to-human direction was already
structural: the recompute cannot touch a decision because it writes to a table
with no decision columns. The revision counter is about the human-to-human
direction, which that split does nothing for.

## Why the evidence and the decision are two tables

Migration 522 splits `fleet_site_inference_evidence` (machine) from
`fleet_site_inference_decisions` (human). "A recompute must never overwrite a
human's answer" is then not a rule anyone has to remember: the recompute's
statement targets a table that has no column for a decision to live in. The
decision row also stores the project the human settled on rather than pointing
at the evidence, so a later recompute cannot strand or reinterpret it.
