# Parking declaration enforcement at check-in

**Status:** designed, not built. Item 2 of 3 from the parking-compliance follow-up.
Items 1 (approver narrowing, PR #2399) and 3 (tile grouping, PR #2400) are done.

**Why this is written down rather than built:** it is the only change in this
feature that can stop someone starting work. Get it wrong and 23 drivers cannot
clock in on Monday morning. The design below is settled; only the
implementation is deferred.

---

## Decisions already made (do not re-litigate)

| Decision | Choice | Why |
|---|---|---|
| Enforcement shape | Soft prompt, then hard block | Escalating, chosen over pure-soft and pure-hard |
| Grace period | Block on the **4th** check-in with no declaration | 3 chances |
| **Gate on** | **DECLARED, not approved** | The driver controls declaring. They do not control approval. Blocking on approval punishes a driver for an approver's latency — and approval is now two people (PR #2399), so that latency went up, not down |
| Counting | Check-ins **on or after an enforcement anchor date**, not since vehicle assignment | See below — this is the part that breaks Monday if got wrong |

## The anchor, and why it is not optional

All 23 active vehicles currently have **no declared address**, and their
assignments are months old. Counting "check-ins since vehicle assignment" means
every driver is already past 3 on day one — so the hard block fires for the
entire fleet the first morning, before anyone has seen a single prompt.

So enforcement counts only check-ins occurring **on or after a fixed anchor
date**, e.g. `PARKING_ENFORCEMENT_FROM=2026-08-11`. Day one prompts; nobody can
be blocked before their 4th check-in *after* that date.

Set the anchor a few days ahead of the announcement so the soft phase is real.

## Injection point

`pages/api/my/attendance/clock-in.ts`, **before** `executeClockInCommand`
(around line 38). The route already uses `withMySession` and returns
`apiResponse.forbidden` shapes, so the gate fits the existing error contract.

Server-side is the enforcement; the client prompt is UX and must not be the
only thing standing between a driver and an undeclared address.

## The query

Needs two facts for `session.staffId`:

1. **Does an active or pending declaration exist?** — `fleet_vehicle_parking_locations`
   for the driver's assigned vehicle where `status IN ('active','pending')`.
   Pending counts: the driver has done their part.
2. **How many check-ins on/after the anchor?** — count from the attendance
   records used by `executeClockInCommand`. Confirm the exact table before
   writing; do not assume the name.

Block when (1) is false AND (2) >= 3.

Drivers with **no assigned vehicle are never gated** — `hasAssignedVehicle` is
already the condition the ParkingTile uses.

## Client

- Soft phase: on opening `/my`, route to `/my/vehicle/parking` with a
  "Do this later" affordance. Skippable.
- Hard phase: clock-in returns the block; the clock screen shows why and links
  to the parking screen. It must say **how** to unblock, not merely that they
  are blocked.

## Tests — and the traps this codebase has already produced

Both of these happened this week; do not repeat them.

1. **Do not invent a schema.** The 483 migration tests created
   `staff (id, full_name)` — production has no `full_name`. 288 tests passed
   while `/api/fleet/parking/requests` 500'd on every call (fixed in #2398).
   Any scratch schema must mirror the real table.
2. **Mutation-test the gate.** A route test that mocks the gating query proves
   only the mapping. Delete the block in the *production* file and confirm a
   test fails. A self-approval test written this week passed with the guard
   removed — 99 tests green — because it sat at the route layer.

Required cases: no vehicle (never blocked), declared-and-pending (not blocked),
declared-and-approved (not blocked), undeclared with 1/2/3 check-ins after the
anchor (allowed, allowed, allowed) and the 4th (blocked), check-ins **before**
the anchor (never counted), and anchor unset (fail open — never block).

## Risks

- **Fail open, always.** If the gating query errors, clock-in must proceed. A
  driver who cannot start work because a parking lookup timed out is a far worse
  outcome than an undeclared address.
- Someone who works Mon/Tue then takes leave could return to a block having seen
  only two prompts. Accepted, given the anchor; revisit if it bites.
- The soft phase needs an actual announcement. Enforcement that arrives
  unannounced reads as a bug.
