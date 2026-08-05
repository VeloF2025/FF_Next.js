# Portal Tracker Ingestion — Design

**Date:** 2026-08-05
**Status:** Awaiting approval
**Author:** Claude (with Hein)

## Problem

Of 23 active vehicles, only 7 appear on the fleet live map. The other 16 have no position
data because FibreFlow is wired to exactly one tracking platform — Velocity's own Cartrack
account, the only one with a REST API entitlement.

The remaining vehicles are tracked, but on platforms belonging to rental partners, reachable
only through web portals. This design pulls their position history through those portals and
lands it in the same `fleet_vehicle_positions` table the live map already reads.

## Goal

1. Backfill full available position history for every reachable vehicle.
2. Thereafter refresh every 2 hours, 24 hours a day. A few hours of lag is acceptable.
3. Never fail silently — a portal that stops producing data must raise an alert.

## Non-goals

- Real-time tracking for portal-sourced vehicles. The 2-minute Cartrack API poll stays as it
  is, for the 7 vehicles that support it. Portal vehicles are explicitly "hours behind".
- Replacing the Cartrack API integration.
- Changing the live map UI.

---

## Coverage: what is actually reachable

Established by direct inspection of each portal on 2026-08-05.

| Platform | Account | Vehicles on account | Ours |
|---|---|---|---|
| Cartrack (API) | Velocity | 8 devices | 7 mapped, **1 unnamed and unmapped** |
| Cartrack (portal) | Urent / Blitz | 5 | 3 active + 2 **retired** |
| Netstar VigilCloud | Europcar (multi-client reseller) | many | at least 1 confirmed, ~4 probable |
| Ituran via Soltrack | Avis / "Blitz Fibre" | 2 | 2 |

**Confirmed by sight:** `HG16TDGP`, `HW50KNGP`, `JZ29GJGP` (Cartrack) ·
`KW96KRGP`, `KX82PLGP` (Ituran) · `LN40MGGP` (Netstar).

**`KR27FNGP` is definitively on none of them** — checked against Velocity's Cartrack account
via the API (8 devices, no Land Cruiser), Urent's 5, and Ituran's 2. It is company-owned, so
fitting a tracker is an internal decision. Excluded from scope by agreement.

**The realistic ceiling is therefore 15 of 16**, and 22 of 23 active vehicles.

Precise per-vehicle attribution is deliberately NOT hardcoded here. Hand-scraping the Netstar
tree produced contradictory results (see Risks), and the design instead makes enumeration a
continuously-verified property of the system — see Discovery.

---

## What already exists and does not change

The July live-tracking work left a provider-blind pipeline this plugs straight into:

- `src/services/tracking/types.ts` — `TrackingProvider` interface. `ProviderKey` **already**
  includes `'netstar'` and `'ituran'`.
- `src/services/tracking/ingest.ts` — provider-blind, idempotent on
  `(provider, account_ref, provider_event_id)`, batched, synthesises deterministic event ids
  when a provider supplies none. **No change required.**
- `fleet_tracking_watermarks` — per `(provider, account_ref)` resume point, `last_error`,
  `consecutive_failures`.
- `fleet_vehicle_positions` / `fleet_vehicle_trackers` — the `provider` CHECK constraints
  already permit `netstar` and `ituran`. **No migration required for provider values.**
- `playwright`, `puppeteer`, `papaparse`, `xlsx` are already dependencies.

---

## Portal contracts (verified 2026-08-05)

### Netstar VigilCloud

Report builder: category → group → type. `Individual → Detailed → All Activity` is the
positional feed.

```
POST /VigilCloud4/Reports/ReportRepo/GenerateReport/
{
  "reportId":         "Mobiles.IndividualReports.AllActivity",
  "reportName":       "All Activity",
  "startTime":        "2026-08-03T22:00:00.000Z",
  "stopTime":         "2026-08-05T12:35:31.759Z",
  "selectedIds":      [1447952],
  "selectedNames":    ["LN40MGGP"],
  "selectedTimeZone": "South Africa Standard Time",
  "reportBy":         "Vehicle",
  "reportGroup":      "Detailed",
  "category":         "Individual",
  "sortAscending":    true
}
→ 200  "639215375838074231"        // job id — generation is ASYNCHRONOUS
```

Then `POST /VigilCloud4/Reports/Export` with output format `PDF | Excel | CSV`.

- **Hard limit: 31 days per report.** Exceeding it returns
  *"This report is limited to 31 days, please change the start or stop dates to be inside this limit"*.
- `selectedIds` / `selectedNames` are arrays — one call can cover many vehicles.
- Timestamps are ISO-8601 UTC with an explicit timezone parameter.
- `selectedIds` values are the `external_id` we need (e.g. `LN40MGGP` → `1447952`).
- Login inputs carry `readonly="readonly"` plus an `onmousedown` handler that clears it — an
  anti-autofill measure. The attribute must be removed before typing.
- A built-in scheduler exists (Daily/Weekly/Monthly → PDF/Excel/CSV), retained as a fallback.

### Cartrack portal (Urent / Blitz)

Backed by JSON-RPC at `/jsonrpc/index.php`. The report catalogue is categorised
(ALERTS, CAN, DRIVER, FUEL, GEOFENCE, HISTORY, IDLE, LOCATION, …) with a per-report EXPORT.

- **`Detail Trip Report CSV`** — a report whose stated purpose is CSV output. This is the target.
- `LOCATION` category is last-position only; `HISTORY` is log books. Trip reports hold the
  positional history.
- Login has separate **Admin** and **Sub-user** tabs. Stored credentials include a sub-user
  name, so the Sub-user tab is likely correct — unconfirmed, and must be settled before the
  adapter makes repeated attempts, to avoid lockout.

### Ituran / Soltrack

`Reports & Playback` → Location · Mileage · Speeding · Stop · **Detailed** · Trip · Activity.
The live grid carries Time / Address / Speed / Mileage columns and an export control.

- **Sits behind Reblaze bot mitigation.** A headless request receives a JS challenge
  (HTTP 247, ~496 bytes, empty body) rather than a login form. An ordinary browser session
  works normally.
- Reports open in a popup window.

---

## Architecture

Three providers implementing the existing interface. Everything downstream is untouched.

```
src/services/tracking/
├── types.ts                              (unchanged)
├── ingest.ts                             (unchanged)
├── portal/
│   ├── session.ts        NEW  cookie-jar login; re-auth on mid-run session kill
│   └── csv.ts            NEW  papaparse → ProviderPosition[]
├── netstar/{client,provider,parse}.ts    NEW
├── cartrack2/{client,provider,parse}.ts  NEW
└── ituran/{client,provider,parse}.ts     NEW
```

Each `fetchPositions(from, to)`: authenticate → request report → download CSV → parse → return
`ProviderPosition[]`. `ingestPositions()` deduplicates and writes.

**Transport is per-provider, chosen on evidence rather than uniformity:**

| Provider | Transport | Why |
|---|---|---|
| Netstar | HTTP client | Contract captured and proven |
| Cartrack portal | HTTP client (JSON-RPC) | Structured backend observed |
| Ituran | Headless browser | Reblaze rejects non-browser clients |

The adapter interface is identical either way, so the difference is invisible downstream.
Files stay under the 300-line limit; parsers are separate from clients so they can be tested
without network access.

### Credentials

Read from environment variables only. Values live in the server env file and, for reference,
in the gitignored `.claude/credentials.local.md`. **No credential appears in this document or
any tracked file.** Variable names to be finalised at implementation, following the existing
`CARTRACK_*` convention in `pages/api/cron/poll-tracking.ts`.

---

## Discovery — the guarantee that no vehicle is missed

Runs before every poll, per provider:

1. Request the portal's **complete** vehicle list (internal id + registration).
2. Normalise registrations (uppercase, strip spaces and hyphens) and match against
   `fleet_vehicles.registration`.
3. Upsert `fleet_vehicle_trackers` rows `(provider, account_ref, external_id, vehicle_id)`.
4. **Reconcile in both directions** and report:
   - active FibreFlow vehicles matched to no portal — the coverage gap;
   - portal vehicles matching no active FibreFlow vehicle — unmapped or retired devices.

Step 4 is what converts "which vehicles do we have?" from a one-off manual count into a
standing, self-correcting property. It re-checks every 2 hours and flags a vehicle the moment
a rental partner swaps one out.

It has already proven its worth during recon, surfacing two things by hand that it would
otherwise find automatically:

- Cartrack device `544524626` on **Velocity's own account** — a Foton Truck Mate with no
  vehicle name, matching none of the 4 Fotons in FibreFlow. A live subscription attached to
  nothing identifiable.
- `HW50JYGP` and `JZ29GCGP` are **retired** in FibreFlow but still tracked on Urent's account.
  Possible ongoing subscription cost for returned vehicles.

---

## Backfill

A one-off, resumable script:

```bash
node scripts/backfill-tracking.ts --provider=netstar --floor=2024-08-01
```

- Walks **backwards** from now in provider-max chunks (Netstar: 31 days).
- Stops when two consecutive chunks return zero rows — the retention edge, discovered rather
  than assumed — or when the floor is reached.
- Writes through `ingestPositions()`, which is idempotent, so an interrupted run is safe to
  repeat and may overlap live polling without creating duplicates.
- Sequential and rate-limited. These are partner-owned accounts; the backfill must not look
  like an attack.
- Logs, per chunk: provider, window, rows fetched, rows inserted, rows skipped unmapped.

**Default floor: 24 months**, stopping earlier at the retention edge. Assumption pending
confirmation — the alternative is unbounded until the portals run dry.

---

## Schedule

New endpoint `pages/api/cron/poll-portal-tracking.ts`, on its own advisory lock. The existing
2-minute `poll-tracking` endpoint is untouched and continues serving the 7 API-reachable
vehicles.

```cron
0 */2 * * * curl -fsS -H "x-cron-secret: $CRON_SECRET" \
  http://localhost:3005/api/cron/poll-portal-tracking >> /home/velo/logs/poll-portal-tracking.log 2>&1
```

- Window: from the provider's watermark to now, with deliberate overlap. Dedup makes overlap
  free, and a missed tick self-heals on the next one.
- One provider failing must never block the others.
- The watermark advances only from positions actually accepted for storage — the existing
  `maxIngestedAt` contract in `ingest.ts`.

---

## Failure alerting

Recipient: **Lizelle Mouton** (fleet manager), via the existing notification system.

Two new event types registered in `src/modules/notifications/constants/index.ts` alongside the
existing `fleet.*` entries:

| Event | Severity | in-app | email | WhatsApp |
|---|---|---|---|---|
| `fleet.tracking_pull_failed` | warning | yes | yes | auth failures only |
| `fleet.tracking_data_gap` | warning | yes | yes | no |

Behaviour:

| Condition | Response |
|---|---|
| Session killed mid-run | Re-authenticate once, continue silently |
| Authentication rejected | Alert immediately — will not self-heal |
| Transient error | Retry next tick; alert after 3 consecutive failures |
| Zero rows for a vehicle that reported in the previous run | Alert — `fleet.tracking_data_gap` |

The last row is the important one. A portal that authenticates cleanly and returns an empty
report is the failure mode that would otherwise go unnoticed for weeks.

**Recipients are configurable, not a hardcoded UUID.** Lizelle's `staff.position` currently
reads "Staff" rather than a fleet-manager role, so role-based routing would not find her; and
hardcoding an individual means alerts silently stop if she changes role.

**Overnight handling (assumption, pending confirmation):** email and in-app fire immediately at
any hour; WhatsApp is reserved for auth failures and held until 07:00 SAST if raised overnight.
The job runs at 02:00 and 04:00, and a transient blip that self-heals should not wake anyone.

---

## Testing

- **Parsers** are pure functions over fixture CSVs — no network. One fixture per provider,
  captured from a real export.
- **Clients** take an injected `fetch`, following the existing `cartrack/client.ts` pattern.
- **Discovery matching** unit-tested against registration-normalisation edge cases (spacing,
  case, retired vehicles, portal vehicles absent from FibreFlow).
- **Live smoke tests** gated the same way as the existing `smoke.test.ts`.
- No test asserts a tautology; no mock stands in for a real implementation.

---

## Risks

| Risk | Standing | Mitigation |
|---|---|---|
| **Netstar enforces a single session** — a second login fires `POST /Authentication/Account/LogOff` on the first | Confirmed | Staff do not use the portal during the day. A dedicated Netstar automation account would remove it entirely — worth requesting. |
| **Ituran sits behind Reblaze** | Confirmed | Headless browser transport for those 2 vehicles |
| **Netstar `/Reports/Export` returned 503 once** | Unresolved | Pin down during implementation; do not assume export is free |
| **Retention depth unknown on all three** | Unknown | Backfill discovers it rather than assuming |
| **Cartrack sub-user vs admin login mode** | Unconfirmed | Settle before repeated attempts; lockout risk |
| **Portal contracts change without notice** | Inherent | Alerting above; parsers isolated from clients |
| **Netstar account is a multi-client reseller tree** | Confirmed | Filter to our registrations; `ingest.ts` already drops unmapped trackers |

### A note on the coverage count

An attempt to enumerate the Netstar vehicle tree by driving its filter box produced
contradictory results between passes — `LG88LJGP` matched, then did not — because the
single-session behaviour was invalidating the session mid-scan. That list was discarded rather
than reported. The authoritative enumeration is the Discovery step above, run once with a
dedicated session.

---

## Open questions

1. **Backfill floor** — 24 months (assumed) or unbounded until retention runs out?
2. **Overnight WhatsApp** — hold until 07:00 (assumed) or send regardless of hour?
3. **Cartrack login mode** — Admin tab or Sub-user tab?

None block starting work; all three are settled before the code paths they affect are written.

## Security note

The Netstar portal password was exposed on 2026-08-05 when Playwright's `fill()` error log
echoed the value into a session transcript. The recon tooling was fixed to scrub secrets from
all output before this document was written.

**Rotation was considered and declined by Hein on 2026-08-05.** The credential remains in use
unchanged. Recorded here as an accepted risk: the value persists in that transcript, so
anyone with access to it holds the Netstar login. Revisit if transcript access widens.
