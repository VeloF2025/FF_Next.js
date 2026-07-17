# FNO Atlas — BetterPortal coverage contract (Letaba Networks)

Reference for ingesting operators that publish **no coverage map**. First and
currently only instance: Letaba Networks (`slug: letaba`, migration 443).

## Why this exists

Every other FNO Atlas source reads a coverage layer the operator's own site
publishes to the public (Frogfoot GeoJSON, Evotel/Net99 KML, Openserve/DFA
ArcGIS). Letaba publishes nothing of the sort — their site is a 7-page WordPress
install with no map library, no GeoJSON/KML/WMS/WFS, and no coverage page. Their
only coverage tool is a **BetterPortal** widget that answers one point at a time.

So Letaba is stored as **presence points** (mig 428), never coverage polygons
(mig 427). A centroid hit evidences presence in that town, not a boundary.

## The API contract

BetterPortal is a small white-label PaaS (betterportal.cloud). The ZA coverage
endpoint is **shared across tenants** — `iqe-services-za.betterportal.net` and
`embedded-theme-za.betterportal.net` both resolve to the same LB
(`eu.bplb.betterportal.net`).

```
POST https://iqe-services-za.betterportal.net/coverage
Content-Type: application/json
Accept: application/json          # REQUIRED — without it you get "Unknown theme view" HTML
Origin:  https://letaba.net       # REQUIRED — selects the tenant
Referer: https://letaba.net/apply/

{"lat": -23.8333, "lng": 30.1633}
```

Returns a JSON array of available services (empty array = no coverage):

```json
[{"name":"Fibre Uncapped Packages","provider":"trufibre","groupId":10,
  "lowestDownload":15,"highestDownload":200,"lowestCost":290,"highestCost":990,
  "installationCost":0}, ...]
```

**Tenant resolution is by `Origin`/`Referer`, not by host.** Without them, or
with an unrelated origin, the endpoint answers
`400 {"error":"Bad Request","message":"App/Tenant not active/does not exist"}`.
This is routing, not authentication — there is no key, login or credential, and
an unknown origin gets "tenant does not exist" rather than "access denied".

Verified discriminating (2026-07-17): Tzaneen → 3 services; Johannesburg, Cape
Town, Polokwane, Nelspruit, Kruger NP interior → all `[]`.

## Finding the contract on any BetterPortal site

The tell is a WordPress plugin `betterportal-theme-embedded` plus:
```html
<link rel="preconnect" href="https://embedded-theme-za.betterportal.net">
<div data-bpe-wp-import="https://embedded-theme-za.betterportal.net/import.js?div=...">
```
The loader mounts a Vue app from `/newcovchecker?service=new`, which contains the
`fetch(...)` call naming the coverage endpoint. Google Places resolves the
address → lat/lng client-side; only lat/lng reaches the API.

**Do not go hunting for other tenants by probing candidate ISP domains.**
BetterPortal publishes no customer list and it is a generic PaaS, not an SA-fibre
platform — a blind Origin sweep is a fishing expedition against a small vendor.
Reuse this contract *organically*: when an SA ISP's own site is observed
embedding BetterPortal, we already know how to read it.

## Ingest

`scripts/fno-atlas/ingest-letaba-presence.ts`

Provenance is deliberately split so neither half is hand-authored (mig 427
rejects "hand-authored claims"):

| Half | Source |
|------|--------|
| WHERE we probe | GeoNames ZA populated places (CC-BY 4.0) — `download.geonames.org/export/dump/ZA.zip` |
| WHETHER covered | Letaba's own coverage API answers for that exact point |

```bash
# dry-run (no DB writes, no operator row needed)
npx tsx scripts/fno-atlas/ingest-letaba-presence.ts --dry-run

# real run
ALLOW_FNO_ATLAS_DB_WRITE=1 npx tsx scripts/fno-atlas/ingest-letaba-presence.ts
```

Env knobs: `LETABA_MIN_POPULATION` (default 2000), `LETABA_PROBE_DELAY_MS`
(default 1000 — politeness against a third party; do not lower).

Footprint bbox = Vhembe/Mopani/Ehlanzeni (lat −25.2..−22.1, lng 29.5..31.6).
Probing the edges (Polokwane, Nelspruit) returns nothing, so the bbox is not
clipping real coverage.

**Towns returning `[]` are not stored** — one centroid miss is not evidence the
town is uncovered.

`network_type` is derived: `trufibre` = FTTH, `skyfibre`/`wireless` =
fixed-wireless → `mixed` if both, else `ftth` / `fixed_wireless`.
One point per town (not per provider) — per-provider points would stack
duplicate markers on the same coordinate. Full service list, pricing and
provenance live in `raw_properties`.

## Result (2026-07-17)

119 towns probed, **107 covered** (98 `fixed_wireless`, 9 `mixed`, 0 fibre-only —
Letaba is wireless-first). No `ftth`-only town exists.

## Gotchas

- **`Accept: application/json` is mandatory.** Omit it and every probe returns
  `Unknown theme view` HTML — including points you know are covered. Cost me a
  false "API is broken" reading during recon.
- **Zero Velocity AOI overlap.** 0 of 29 AOIs fall in the footprint; nearest is
  121 km (MAM). `compute-project-overlays.ts` will compute nothing for Letaba by
  construction. This layer is national-completeness only — do not expect overlap
  signal.
- **Presence points are ordered last** in `coverage-geometry`
  (`coverage=0, project_aoi=1, route=2, presence=3`) under
  `DEFAULT_FEATURE_LIMIT=5000`. On an unfiltered default load, 120k+ Openserve
  polygons crowd presence points out entirely. Filter by `operatorSlug=letaba`
  (`&featureKinds=presence`) to see them. Affects Fibertime equally — pre-existing.
- Geometry API params are camelCase: `operatorSlug`, `featureKinds`, `limit`
  (not `operators`/`kinds`).
