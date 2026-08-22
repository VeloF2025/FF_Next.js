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
so this changes no classification today. It is the defensible one, and it is the
one that stays right if the tracker's sampling policy changes.

### `ignition` and `speed_kph` do not filter the sample

97% of positions (298,120 of 306,675) already carry `ignition = true` — the
tracker mostly reports only while the engine runs, so parked-with-ignition-off
dwell is invisible either way and filtering on it would discard almost nothing.
Filtering to `speed_kph = 0` was measured and moves dominant shares by 0.6–2.3pp
(MW67LZGP 67.8% → 69.2%, MW94RBGP 83.9% → 86.2%) while discarding ~70% of the
sample for the high-volume vehicles. It flips no classification and costs
statistical power, so it is not applied. The 900s gap cap already recovers most
ignition-off parking, because the silence before the next ignition-on ping is
credited up to the cap.

### The confidence threshold is 70%

Measured dominant dwell shares, sorted:

```
100% ×9 · 90.4 · 86.2 · 83.9 · 79.6 | 67.8 · 64.8 · 54.2 · 29.7
```

There is an 11.8pp empty band between 79.6% and 67.8%. 70% sits inside it, and
the nearest vehicle to the line is 2.2pp away, so no vehicle is decided by a
coin-flip. Anything from 69% to 79% would classify identically today.

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

Two real AOIs genuinely overlap (Thembisa POP 1 and POP 3 share 14% of POP 1's
area), so a position inside N AOIs contributes 1/N to each. Shares still sum to 1.

## Why the evidence and the decision are two tables

Migration 522 splits `fleet_site_inference_evidence` (machine) from
`fleet_site_inference_decisions` (human). "A recompute must never overwrite a
human's answer" is then not a rule anyone has to remember: the recompute's
statement targets a table that has no column for a decision to live in. The
decision row also stores the project the human settled on rather than pointing
at the evidence, so a later recompute cannot strand or reinterpret it.
