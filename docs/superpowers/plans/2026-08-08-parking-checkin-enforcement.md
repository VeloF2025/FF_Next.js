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

Put the gate **inside `executeClockInCommand`**
(`src/modules/attendance/portal/clockInCommand.ts`), not in the route adapter.

The earlier draft of this plan said the route, before the command call. That
breaks from the pattern this exact class of gate already follows: the command
carries a `stage` variable and blocks clock-in on outstanding conditions at
`consent_check`, `open_entry_check` and `required_action_check`, each with
structured rejection logging. A parking gate in the route would be the only
"you may not clock in yet" rule sitting outside that sequence, with no stage
label in the logs and nothing tying it to the others.

`executeClockInCommand` has exactly one caller today, so the route is not a
bypass risk — this is about consistency and debuggability, not security. Follow
`required_action_check`: add a stage, log the rejection with a `reason`, and
return the existing FORBIDDEN shape the route already maps.

Server-side is the enforcement; the client prompt is UX and must not be the
only thing standing between a driver and an undeclared address.

## The query

Needs two facts for `session.staffId`:

1. **Does an active or pending declaration exist?** — `fleet_vehicle_parking_locations`
   for the driver's assigned vehicle where `status IN ('active','pending')`.
   Pending counts: the driver has done their part.

   Know what this buys and what it does not. `pending` satisfying the gate
   means the gate is satisfiable **permanently without any address ever being
   approved**: submit one plausible-looking capture, and whether it is later
   rejected or simply never reviewed, the block never fires again. There is no
   cooldown after a rejection and validation only checks GPS accuracy (≤100m),
   not whether the location is plausibly a home. A driver can also declare,
   clock in, and withdraw the declaration immediately afterwards.

   This is accepted, deliberately: the gate's job is to make the queue
   non-empty and put the address on the record, not to adjudicate honesty.
   Adjudication is Lizelle's, and a rejected declaration is a conversation, not
   a lockout. But do not describe this gate as guaranteeing every driver has a
   *valid* address on file — it guarantees they have *engaged with the ask*.
   If a hard guarantee is wanted later, the lever is counting only
   `status = 'active'`, which trades the lockout risk back in.
2. **How many check-ins on/after the anchor?** — count from the attendance
   records used by `executeClockInCommand`. Confirm the exact table before
   writing; do not assume the name.

Block when (1) is false AND (2) >= 3.

### Which vehicle lookup governs — this is not interchangeable

Use **`resolveDriverVehicle`** (`src/modules/fleet/parking/driverParkingQueries.ts`),
the same function the driver's own POST uses. Do NOT gate on
`hasAssignedVehicle` from `/api/my/session`.

They disagree, and the disagreement is a lockout. `hasAssignedVehicle` is a
bare `EXISTS` over `vehicle_assignments`; `resolveDriverVehicle` INNER JOINs
`fleet_vehicles` on `registration`. Verified against prod 2026-08-08 — of 24
active assignments, **6 resolve differently**:

| Driver | Registration | Why they differ |
|---|---|---|
| Byron Viviers | EMN890GP | no `fleet_vehicles` row |
| Gladwell Mugadzaweta | EMN892GP | no `fleet_vehicles` row |
| Marthinus Van De Venter | EMN889GP | no `fleet_vehicles` row |
| Patrick Sithole | EMZ640GP | no `fleet_vehicles` row |
| Zain Alli | EMN891GP | no `fleet_vehicles` row |
| Jermain Denzil Rooi | KT42YMGP | vehicle is `retired` |

Gate on `hasAssignedVehicle` and these six are told to declare an address the
driver route will not let them submit — `resolveDriverVehicle` returns null, so
the POST has no vehicle to attach the declaration to. They would be blocked out
of clock-in with no action available to them. Gating on `resolveDriverVehicle`
means "if you cannot declare, you are not gated", which is the only safe pairing.

These 6 rows are themselves a data-quality bug worth fixing separately; the gate
must not wait on that, and must not assume it has happened.

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
- **A reassigned vehicle carries its old declaration.** Declarations key on
  `vehicle_id` and merely record `declared_by_staff_id`; `superseded` fires only
  when a *new* declaration for the same vehicle is approved
  (`approvalQueries.ts`), and nothing in the assignment path touches parking at
  all. So a driver handed a vehicle that already has an `active` declaration
  inherits "compliant" and is never gated, having declared nothing — and the
  address on file is the previous driver's home. Zero instances today (checked
  2026-08-08: no active declaration whose declarer differs from the assigned
  driver), but only because one declaration exists in total. Decide before
  building whether the gate matches on vehicle alone or on
  `(vehicle_id, declared_by_staff_id)`; the latter closes it with no new
  invalidation machinery.
- The soft phase needs an actual announcement. Enforcement that arrives
  unannounced reads as a bug.
- **Corrections to the premises this plan was written on** (re-verified against
  prod 2026-08-08): 22 of 23 vehicles have no declared address, not 23 — one
  pending declaration was created on the morning of the 8th, so the code must
  handle a non-empty table from day one. And assignments are not uniformly
  "months old": 6 of 24 active assignments started within the last 30 days, the
  newest 2 days ago. Neither changes the anchor-date design, but a test corpus
  built on "everything is old and empty" would not resemble production.
