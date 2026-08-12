# Fleet tracking accuracy — Track A design

**Date:** 2026-08-12
**Status:** Design, awaiting implementation plan
**Supersedes requirement in:** `2026-08-05-portal-tracker-ingestion-design.md` §Goal item 2

---

## Why this exists

The live fleet map presents data from four feeds as though they were one. They are not
comparable, and the presentation does not say so. A vehicle whose last fix is two hours old
because that is its designed cadence is drawn identically to one whose tracker has failed.

The previous design (`2026-08-05-portal-tracker-ingestion-design.md`, line 20) set the portal
cadence deliberately: *"Thereafter refresh every 2 hours, 24 hours a day. A few hours of lag is
acceptable."* It listed real-time portal tracking and changing the live map UI as explicit
non-goals.

**That requirement has changed.** The tracking data is now used for live operations ("where is
this vehicle now") and exception monitoring (speeding, idling, unauthorised use), in addition to
after-the-fact reconstruction. Two of those three uses are not served by a 2-hourly cadence.

---

## Verified findings

Every claim below was measured against the production database or read from the code at
`origin/master`. Claims that are inferred rather than measured are marked as such.

### Feed inventory

23 active vehicles. Only 7 can answer "where is it now".

| Feed | Vehicles | Cadence | Path |
|---|---|---|---|
| `cartrack/velocity` | 7 | 2 min | REST API, `/api/cron/poll-tracking` |
| `netstar/europcar` | 6 | 2 h | Portal, `/api/cron/poll-portal-tracking` |
| `cartrack/urent` | 3 | 2 h | Portal, same endpoint |
| `ituran/avis` | 2 | 2 h (`30 */2 * * *`) | Portal, separate cron |
| No active tracker | 5 | — | — |

### All 11 portal vehicles are effectively snapshot-only

Measured across all stored history, counting fixes delivered for one vehicle in one poll batch:

| Account | Vehicle-poll batches | Max fixes, one vehicle, one poll | Batches with >1 |
|---|---|---|---|
| `velocity` (REST, control) | 27,558 | 487 | 26,203 (95%) |
| `urent` (Cartrack portal) | 73 | 2 | 2 |
| `europcar` (Netstar) | 146 | 1 | 0 |
| `avis` (Ituran) | 99 | 1 | 0 |

`cartrack` declares `granularity: 'history'` (`src/services/tracking/cartrack/provider.ts:76`),
but that holds only on the REST path. The `urent` **portal** path averages ~1.03 fixes per
vehicle per poll. Were it returning true history at the device's own reporting rate, a 2-hour
window would carry roughly a hundred fixes, as the velocity account does. It carries one.

`netstar` and `ituran` declare `granularity: 'snapshot'`
(`netstar/provider.ts:48`, `ituran/provider.ts:30`) and measure as pure snapshots — no poll has
ever returned more than one fix for one vehicle.

**Consequence 1:** raising the poll rate *does* fix live ops. A snapshot returns the device's
newest known fix, so a shorter interval cuts our sampling lag proportionally.

**Consequence 2:** raising the poll rate *cannot* fix exception monitoring. Speeding and idling
occur between samples. No cadence recovers points the portal never surrenders.

**Caveat, important:** our poll rate is not the device's reporting rate. LL92LYGP showed a
15-hour-old fix because the *device* had not reported since 17:15 SAST the previous day; six
successful polls in that window each returned the identical timestamp and were deduplicated.
Polling every 5 minutes would have shown the same 15-hour-old fix. Harder polling closes our
sampling gap, not the device's reporting gap.

### Alert thresholds are coupled to the 2-hour cadence

`src/services/tracking/alerts.ts:47` defines `GAP_REPEAT_TICKS = 12`, counted in **ticks, not
time**. Its own comment states the calibration: *"The job runs every 2 hours, so 12 ticks is
roughly one reminder a day."* At a 10-minute interval the same constant yields one reminder
every two hours — 12× the volume, producing precisely the outcome the comment warns against:
*"the recipient learns to ignore the channel."*

### Single-session eviction is currently classified as a credentials failure

`src/services/tracking/authFailure.ts:26` lists `'still logged out'` in the auth-failure
pattern. `PortalSession` throws `[portal-session] still logged out after re-auth` when Netstar's
single-session limit means a human has taken the session from us. That routes to `kind: 'auth'`
→ `fleet.tracking_pull_failed`, the event registered with `whatsapp: true`.

At a 2-hour cadence there are 12 opportunities per day to collide with a human. At 10 minutes
there are 144. **Inferred:** an operator working in the Netstar portal for an hour would
generate roughly six WhatsApp alerts for a correctly functioning system.

### Per-vehicle silence is invisible to alerting

Alerting is keyed on `fleet_tracking_watermarks`, which is per `(provider, account_ref)`. A
single silent vehicle among healthy account-mates produces no signal, despite the previous
design's goal 3: *"Never fail silently — a portal that stops producing data must raise an
alert."*

### Check-in odometer data is not trustworthy as a raw signal

Measured over 7 days, per vehicle, from `fleet_check_records`:

| Vehicle | Account | Odometer Δ | GPS fixes | Fixes/km |
|---|---|---|---|---|
| KX82PLGP | avis | **909,312 km** | 42 | — (impossible) |
| HG16TDGP | urent | 926 km | 32 | 0.035 |
| JZ29GJGP | urent | 547 km | 39 | 0.071 |
| HW50KNGP | urent | 167 km | 4 | 0.024 |

Two things follow. First, KX82PLGP's 909,312 km delta in one week is impossible, so odometer
*magnitude* cannot be used as a detector input without outlier rejection. Second, HW50KNGP —
which raw fix counts made look like a dead tracker — is within ~1.5× of its account-mates once
normalised for distance driven. Its low count is mostly low usage. Raw cross-vehicle fix counts
measure how much a vehicle drove, not whether its tracker works.

### Map presentation is mostly already correct

Provider-aware staleness and multi-state status labelling already shipped. Verified against
`origin/master`, not a working tree:

- `src/services/tracking/staleness.ts` — `staleAfterSecondsFor(provider, accountRef)` returns
  `DEFAULT_STALE_AFTER_SECONDS` (3 h) for portal feeds and `FAST_STALE_AFTER_SECONDS` (15 min)
  for the Cartrack REST account. It splits by **account**, not provider name, because Cartrack
  runs both a 2-minute REST feed and a 2-hourly portal feed.
- `pages/api/fleet/positions/live.ts` — `staleAfterSeconds` is already per-vehicle on
  `LiveVehicle`; the fleet-wide scalar has already been removed.
- `src/modules/fleet/utils/liveMapHelpers.ts` — `statusFor()` already returns six states
  (`speeding`, `lostContact`, `moving`, `parked`, `parkedSilent`, `unknown`), and the FleetMap
  popup renders `STATUS_STYLE[statusFor(v)].label`.

This existing code accounts for both observed cases exactly. LL92LYGP: netstar → 3 h threshold,
15 h old → stale; ignition false and quiet past `PARKED_SILENT_AFTER_SECONDS` (6 h) →
`parkedSilent` → "Parked · no contact (stale)". HW50KNGP: `cartrack/urent` → 3 h threshold, 1 h
old → **not** stale, hence no stale marker.

**One genuine defect remains.** `liveMapHelpers.ts:76`:

```ts
if (v.ignition === true) return v.isStale ? 'lostContact' : 'moving';
```

`'moving'` is returned whenever ignition is true and the fix is fresh, without ever consulting
speed. A vehicle idling with the engine running renders as "Moving · 0 km/h". That is the
HW50KNGP case.

### `staleness.ts` will become wrong the moment cadence is configurable

`staleness.ts` hardcodes its thresholds, and its header states the assumption plainly: *"The
cadence is set by cron."* Once cadence is per-account configuration that ramps (design item 1),
a hardcoded 3 h is wrong by construction — tightening the interval to 10 minutes would leave the
map calling fresh data stale for hours. The threshold must derive from the same
`poll_interval_minutes` the poller uses.

Its header also records a standing landmine worth respecting here: for Cartrack, an
*unrecognised* account is treated as FAST, so onboarding any second Cartrack account requires
revisiting that function.

---

## Goals

1. Cut sampling lag for the 11 portal vehicles from up to 2 hours to minutes, without provoking
   the partner portals we do not own.
2. Detect a tracker that has genuinely stopped reporting, per vehicle.
3. Make the map state what it actually knows, per feed.

## Non-goals

- **Exception monitoring.** The data does not exist for the 11 portal vehicles at any cadence.
  Claiming otherwise would repeat the inaccuracy that prompted this work. Addressed in Track B,
  or not at all.
- Changing `ingest.ts`, which stays provider-blind.
- Changing discovery's four guards or its refusal to resolve ambiguous registrations.
- Touching the dedup key. A position stored against the wrong vehicle is unrepairable, because
  the key carries no `vehicle_id` and a corrected re-insert collides and is dropped.
- Fixing the odometer data-quality defect. Real, but separately scoped.

## Accepted risk

Polling partner portals harder without their permission was chosen deliberately over pursuing
API entitlements first. The risks are account blocking, tripping bot detection, and contention
with human users for Netstar's single session. The design mitigates these with automatic
demotion and manual promotion, but does not eliminate them.

---

## Design

### 1. Cadence becomes configuration

`fleet_tracking_watermarks` gains one column, `poll_interval_minutes`. The table is already
keyed `(provider, account_ref)`, which is the correct grain — Netstar may tolerate 10 minutes
while Ituran does not, and each ramps independently.

The cron fires at the fastest supported rate. The handler skips a tick unless
`now() - last_run_at >= poll_interval_minutes`. `last_run_at` already exists, so this needs no
new timer and no new table. The existing advisory lock (`LOCK_KEY = 4417302`,
`pages/api/cron/poll-portal-tracking.ts`) already makes overlapping ticks safe.

### 2. Tick-counted thresholds become wall-clock

`GAP_REPEAT_TICKS` becomes `GAP_REPEAT_AFTER_MS` (24 h). `TRANSIENT_THRESHOLD` stays a count —
three consecutive failures means the same thing at any cadence.

This must land **before** any cadence change. It is the landmine described above.

### 3. Ramp with automatic demotion, manual promotion

Steps: 2 h → 30 m → 10 m.

- **Demotion is automatic.** On portal pushback — auth failure, block, or sustained eviction —
  the interval backs off one step and alerts.
- **Promotion is manual**, a single `UPDATE`, no deploy. Given we are polling a partner's system
  without permission, the only unattended movement should be backwards.
- A step is held for **at least 24 hours** at that interval with zero evictions and zero auth
  failures before it is eligible for promotion. 24 hours rather than a tick count, so the
  qualifying period does not shrink as the interval tightens — the same mistake as
  `GAP_REPEAT_TICKS`.

`cartrack/urent` needs the closest watching: its rejected-credential endpoint counts toward a
**lockout** (`authFailure.ts:37`).

### 4. Eviction becomes its own failure kind

Split `'still logged out after re-auth'` out of `isAuthFailure` into `kind: 'evicted'`:

- does **not** page — a human using their own portal is not an incident;
- backs the interval off one step for a cooldown, so we stop fighting for the session;
- escalates to auth-grade if eviction persists continuously past ~30 minutes, because a dead
  password could present the same way and must not hide behind the quiet path.

The remaining auth vocabulary — `login failed`, `HTTP 401/403`, `issued no session cookies`,
`still rejected after re-mint`, `login did not yield a session`, `bot challenge did not clear`,
`still unauthenticated after re-login` — keeps today's immediate-WhatsApp behaviour unchanged.

### 5. Per-vehicle silence detection

**Rejected — fixed threshold.** LL92LYGP legitimately goes 15 h quiet overnight while parked.
Any threshold tight enough to catch a dead unit fires nightly on healthy ones.

**Rejected — fix-count ratio against account-mates.** Per the odometer table above, usage
dominates the count. The ratio measures distance driven, not tracker health.

**Chosen — check-in-anchored silence.** A check-in is independent evidence that a human was
physically at the vehicle at a known time. The detector asks one binary question: a check-in
occurred at time T, and the tracker produced no fix within ±`T_window` — why not?

Properties that make this the right shape:

- No odometer magnitude, so the 909,312 km reading cannot poison it.
- No cross-vehicle comparison, so usage differences do not matter.
- Degrades honestly: a vehicle with no check-ins is *not assessed*, rather than assumed healthy.

Alert grade is `fleet.tracking_data_gap`-class — never WhatsApp. A dead tracker is a maintenance
item, not an incident, and the eviction path is already spending alert budget.

`T_window` must be calibrated against real check-in/fix alignment during implementation. It is
deliberately not guessed here.

### 6. Map presentation

Scope here is far smaller than originally drafted, because provider-aware staleness and
multi-state labelling already shipped. Two changes remain.

**Add an `idling` status.** `statusFor` currently ignores speed when ignition is true. Insert an
idling branch ahead of the existing moving/lostContact decision:

| ignition | speed | isStale | status |
|---|---|---|---|
| true | `> 0` | false | `moving` |
| true | `0` | false | **`idling`** (new) |
| true | `null` | false | `moving` (unchanged — no speed to contradict it) |
| true | any | true | `lostContact` (unchanged) |
| false | any | any | `parked` / `parkedSilent` (unchanged) |
| `null` | any | any | `unknown` (unchanged) |

`idling` needs its own `STATUS_STYLE` entry. A null speed deliberately keeps reporting `moving`
rather than inventing a state: only an explicit `0` is evidence of not moving, and treating
"unknown speed" as idle would misreport every provider that omits the field.

**Staleness derives from configured cadence, not a constant.** `staleAfterSecondsFor` takes the
account's `poll_interval_minutes` and returns `interval × 2`, tolerating exactly one missed tick,
rather than the hardcoded `DEFAULT_STALE_AFTER_SECONDS`. This is what stops the map calling fresh
data stale once the ramp tightens.

Two properties of the existing module must survive the change: it keys on **account**, not
provider name, because Cartrack runs a fast and a slow feed simultaneously; and an unrecognised
Cartrack account still resolves to the fast threshold, which its header flags as requiring
attention if a second Cartrack account is ever onboarded.

The lenient fallback stays for any account with no configured interval — a false "stale" is the
failure that module exists to remove.

**Explicitly not in scope:** the `via netstar` line, marker colours, the legend, and the
not-plotted list all already work. Leave them alone.

---

## Testing

Unit tests carry this; there is no new integration surface. Per DGTS, each test is checked that
it **fails** without its fix rather than passing vacuously.

- `liveMapHelpers` — the new `idling` branch, and specifically that a **null** speed with
  ignition on still returns `moving`. Existing `statusFor` cases must be asserted unchanged;
  `liveMapHelpers.test.ts` already exists and is the regression net for them.
- `staleness.ts` — threshold derived from a configured interval; account-keyed dispatch
  preserved; unrecognised Cartrack account still resolving FAST; lenient fallback when no
  interval is configured.
- `alerts.ts` — gap repeat on wall-clock; `still logged out after re-auth` no longer reaching a
  WhatsApp-grade event; persistent eviction escalating past cooldown; `login failed` and
  `HTTP 401/403` retaining today's behaviour.
- Cadence gate — tick-due arithmetic; demotion on pushback; promotion never automatic.
- Silence detector — check-in-anchored; a vehicle with no check-ins asserted as *not assessed*
  rather than healthy.

**Known verification gaps:**

- Nothing here proves the ramp is safe against the live portals. Only the staged rollout does,
  which is why demotion is automatic and promotion manual.
- CI never runs `next build`. No API contract change remains in scope, but the `statusFor` union
  gains a member, and every exhaustive `Record<VehicleStatus, …>` must still compile — so this
  needs a real build before shipping.
- This spec was first drafted against a working tree 133 commits behind `origin/master`, which
  is how it originally proposed work that had already shipped. Every code reference here has
  since been re-verified against `origin/master`. Anyone extending it should do the same rather
  than trusting a local checkout.

---

## Track B — follow-on, not part of this commitment

Verify or kill Netstar's history path (`src/services/tracking/netstar/history.ts`). The repo
marks it **UNVERIFIED** against the live portal, and it was documented in the same pass that had
the vehicle list pointing at `/Reports/ReportRepo/GetReportTree`, an endpoint that always 404'd.

If it works, exception monitoring becomes real for the 6 Netstar vehicles. If it does not,
exception monitoring for portal vehicles requires a commercial route — a REST entitlement, or
moving those vehicles onto Velocity's own Cartrack account, which per the previous design is
*"the only one with a REST API entitlement"*.

Track B is scoped as a spike because its payoff is unknown until someone hits the live endpoint,
and Track A's value does not depend on it.
