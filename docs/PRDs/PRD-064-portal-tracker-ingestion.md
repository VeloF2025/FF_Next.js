# PRD-064 — Portal tracker ingestion for the untracked fleet

**Status:** Phase 1 shipped (PR #2379, unmerged) → Phases 2–3 blocked on decisions
**Owner:** Hein
**Created:** 2026-08-06 SAST
**Trigger:** The fleet live map shows 7 of 23 active vehicles. The other 16 are tracked — but on four platforms belonging to three rental partners, and FibreFlow is wired to only one of them. Coverage is not a hardware problem; it is an access problem.

---

## Problem

`/fleet/map` renders 7 vehicles. The remaining 16 have zero rows in `fleet_vehicle_positions`,
so there is no live position, no trip history, and no basis for the parking-compliance and
attendance features that read from that table.

Every one of those vehicles already carries a tracker. The devices belong to the rental
partners who own the vehicles, and report into the partners' own platforms:

| Platform | Account | Vehicles on account | Ours | Access |
|---|---|---|---|---|
| Cartrack REST API | Velocity `VELO00032` | 8 devices | 7 mapped, 1 unnamed | ✅ Live, 2-min poll |
| Cartrack portal | Urent / Blitz `UREN00016` | 5 | 3 active, 2 retired | ❌ No API key issued |
| Netstar VigilCloud | Europcar (reseller tree) | many | ~5 | ⚠️ Portal only |
| Ituran via Soltrack | Avis / "Blitz Fibre" | 2 | 2 | ⚠️ Portal only, WAF |
| — | — | — | `KR27FNGP` | No tracker fitted |

**A portal login is not API access.** Proven twice: Urent's portal credentials return
401 on the same Cartrack endpoint that returns 200 for Velocity's, and Velocity's *working*
API credential is a **64-character key** entirely distinct from its 13-character portal
password. Fleet API access is a per-account entitlement Cartrack must switch on.

## Goal

1. Backfill the full available position history for every reachable vehicle.
2. Refresh every 2 hours, 24 hours a day. Hours of lag is acceptable; silence is not.
3. Never fail silently — a portal that stops producing data must raise an alert to the
   fleet manager.

## Non-goals

- Real-time tracking for portal-sourced vehicles. The 2-minute Cartrack API poll stays as it
  is for the vehicles that support it; portal vehicles are explicitly "hours behind".
- Replacing the working Cartrack API integration.
- Changing the live map UI.
- `KR27FNGP` — no tracker is fitted. It is company-owned, so fitting one is an internal
  decision, not a partner negotiation. **The ceiling is 15 of 16, and 22 of 23 active vehicles.**

## Success criteria

- `/fleet/map` shows ≥20 of 23 active vehicles with a fix newer than 4 hours.
- `SELECT provider, count(*) FROM fleet_vehicle_positions GROUP BY provider` returns a non-zero
  row for every provider we have access to.
- The poll endpoint's `coverage.notOnPortal` lists exactly the vehicles genuinely absent from
  their portal — this is the standing, self-verifying answer to "have we got all of them?",
  replacing any hand-counted number.
- A portal outage produces an alert to the fleet manager within one tick (2 hours), and a
  sustained outage does not produce more than one alert per ~24 hours.
- Re-running the backfill inserts zero additional rows.

## Architecture

Every provider implements the existing provider-blind `TrackingProvider` interface, so
`ingestPositions()`, `fleet_tracking_watermarks`, and the live map need no changes and no
migration. The `provider` CHECK constraints already permit `netstar` and `ituran`.

```
                     ┌──────────────────────────┐
  Cartrack REST ────►│                          │
  (2 min, existing)  │                          │
                     │   ingestPositions()      │──► fleet_vehicle_positions
  Netstar portal ───►│   provider-blind,        │      (live map, parking,
  (2 h, Phase 1)     │   idempotent on          │       attendance)
                     │   provider+account+      │
  Cartrack ? ───────►│   provider_event_id      │
  (Phase 2)          │                          │
                     │                          │
  Ituran ? ─────────►│                          │
  (Phase 3)          └──────────────────────────┘
```

**Discovery is the coverage guarantee.** Before every poll, each provider's complete vehicle
list is reconciled against `fleet_vehicles` by normalised registration, in *both* directions:
our vehicles the portal does not carry, and the portal's vehicles we do not recognise. That
turns "which vehicles do we have?" from a number somebody counted once into a property
re-verified every 2 hours. It has already earned its place — during recon it surfaced a live
Cartrack subscription attached to no identifiable vehicle, and two retired vehicles still
being tracked on Urent's account.

## Phase 1 — Netstar VigilCloud ✅ built, PR #2379

7 vehicles. **Shipped as an HTTP client, not a browser scrape**, because VigilCloud's report
builder is backed by a JSON endpoint.

```
POST /VigilCloud4/Reports/ReportRepo/GenerateReport/   → "<jobId>"   (asynchronous)
POST /VigilCloud4/Reports/Export                       → CSV
```

Report: `Individual → Detailed → All Activity`. Hard cap **31 days per report**, so history is
walked in chunks.

**Four things the portal does that the code had to be built around**, none of which were
guessable from documentation:

1. **Comma decimal separator.** `"-26,08975"` means −26.08975. The obvious numeric parse yields
   −2608975 — a finite, type-valid number that places every vehicle nowhere on Earth, with no
   error raised anywhere.
2. **No registration column** in the export, so one report must be requested per vehicle and
   the caller stamps the vehicle id. Batching vehicles would misattribute every row.
3. **Single session.** Another login fires `POST /Authentication/Account/LogOff` and kills
   ours mid-run. Tolerable only because staff do not use the portal during the day.
4. **Multi-client reseller tree** containing other companies' fleets, so only mapped vehicles
   may ever be requested.

**Status:** 26 commits, 313 tests, PR #2379 open and unmerged. Not yet run live —
credentials are not in the server env.

## Phase 2 — Cartrack, Urent account ⚠️ blocked, decision required

5 vehicles on the account, 3 of them ours.

**The portal cannot be pulled from.** `Detail Trip Report CSV` has no download: the export
panel offers ONE-TIME / RECURRING, a vehicle selector, a date range, file format
"Microsoft Excel (csv)" — and a single **SEND EMAIL** button. The only data call the page
makes is `ct_fleet_get_report_preview {id:"674"}` over `/jsonrpc/index.php`, which returns
`application/pdf` — a preview image, not rows. The current receiver is
`josiasm@urentsa.co.za`, Urent's own staff.

Three routes, in order of preference:

1. **Request a Fleet API key for `UREN00016`** (`fleet-api@cartrack.com`). We already run
   Velocity's account through a working, reviewed Cartrack client. Urent needs **zero new
   code** — one credential block — and yields 2-minute freshness rather than hours. This is a
   commercial ask, not an engineering problem.
2. **Email ingestion.** Point the portal's RECURRING export at a Velocity mailbox, poll IMAP,
   parse the CSV attachment. Works without Cartrack's cooperation, but requires a mailbox,
   IMAP credentials, and attachment parsing, and is daily-granularity at best.
3. **Hunt for an undocumented data-returning RPC method.** May find nothing.

## Phase 3 — Ituran via Soltrack ⚠️ blocked on recon

2 vehicles (`KW96KRGP`, `KX82PLGP`), account "BlitzFibre-Avis Budget".

`Reports & Playback` offers Location · Mileage · Speeding · Stop · **Detailed** · Trip ·
Activity, and the live grid carries Time / Address / Speed / Mileage with an export control.
So history exists — correcting an earlier assumption that Ituran was current-position-only.

**The obstacle is automation defence, not access.** The portal sits behind **Reblaze**; a
headless request receives a JS challenge (HTTP 247, ~496 bytes, empty body) instead of a login
form. An ordinary browser session works normally. The export contract has not been captured,
so no adapter can be specified without inventing details.

Likely shape: a headless-browser transport rather than an HTTP client, isolated to these two
vehicles.

## Alerting

Three event types, registered beside the existing `fleet.*` events and delivered through the
existing notification bus to the fleet manager (**Lizelle Mouton**,
`80970f18-eaf6-484b-9eca-eb6bb072df9d`), configurable via `FLEET_ALERT_USER_IDS` so alerts
survive a role change.

| Event | WhatsApp | Fires when |
|---|---|---|
| `fleet.tracking_pull_failed` | yes | Auth failure during working hours — will not self-heal |
| `fleet.tracking_pull_degraded` | no | Auth failure overnight, or a 3rd consecutive transient failure |
| `fleet.tracking_data_gap` | no | Portal authenticated cleanly and returned nothing |

The third matters most: a portal that logs in fine and returns an empty report is
indistinguishable from a healthy run, and is the failure that would otherwise go unnoticed for
weeks. Channel policy rides on the **event type**, because the notification bus resolves
delivery from `DEFAULT_CHANNEL_PREFERENCES[event_type]` and ignores anything the caller
computes itself.

Overnight WhatsApp is suppressed by downgrading the event, not by scheduling a delayed
message — an auth failure does not self-heal, so the next daytime tick escalates it naturally.
Consequence, stated plainly: an auth failure that resolves overnight sends no WhatsApp at all.

## Risks

| Risk | Standing | Mitigation |
|---|---|---|
| Portal contracts change without notice | Inherent | Alerting above; parsers isolated from clients |
| Netstar single-session logs staff out | Confirmed | Staff do not use it by day; a dedicated automation account would remove it |
| Ituran's Reblaze blocks automation | Confirmed | Browser transport for 2 vehicles |
| Cartrack portal is email-only | Confirmed | Phase 2 decision above |
| `GetReportTree` response shape never captured live | Open | Zero-match guard refuses to deactivate trackers on an unmatched list; **watch the first live run** |
| Retention depth unknown on all portals | Open | Backfill discovers it rather than assuming |
| Partner accounts could be locked by retries | Mitigated | One re-auth then stop; paced requests; 31-day poll window cap |

## Open decisions

1. **Cartrack route** — API key request, email ingestion, both, or further recon.
2. **Ituran unblock** — grant the browser extension site permission, or supply a sample export.
3. **Backfill floor** — 24 months assumed; unbounded-until-retention is the alternative.
4. **Netstar dedicated account** — worth requesting to remove the single-session conflict.
5. **`KR27FNGP`** — fit a tracker, or accept 22 of 23 permanently.

## Operator actions before Phase 1 does anything

```bash
# /home/velo/fibreflow-dev/.env.local — values in .claude/credentials.local.md §3
NETSTAR_PORTAL_URL=https://profleet.netstar.co.za/VigilCloud4
NETSTAR_PORTAL_USER=
NETSTAR_PORTAL_PASS=
NETSTAR_ACCOUNT_REF=europcar
FLEET_ALERT_USER_IDS=80970f18-eaf6-484b-9eca-eb6bb072df9d
```

```cron
0 */2 * * * curl -fsS -H "x-cron-secret: $CRON_SECRET" \
  http://localhost:3005/api/cron/poll-portal-tracking \
  >> /home/velo/logs/poll-portal-tracking.log 2>&1
```

Then, on the first live run, confirm in order: the vehicle list is real and **deactivates
nothing**; a 31-day chunk is accepted; the export becomes ready within 10 × 3 s; parsed
coordinates land in South Africa rather than at −2608975; and the session survives one full
multi-vehicle pass.

---

**Design:** `docs/superpowers/specs/2026-08-05-portal-tracker-ingestion-design.md`
**Phase 1 plan:** `docs/superpowers/plans/2026-08-05-portal-tracker-ingestion-phase1-netstar.md`
