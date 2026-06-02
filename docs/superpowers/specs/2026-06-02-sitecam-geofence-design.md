# SiteCam GPS-Geofence — Design

**Date:** 2026-06-02
**Module:** `src/modules/sitecam`
**Status:** Approved design — ready for implementation plan

## Goal

Show the planned GPS / PON / zone for a site on the SiteCam confirmation card,
capture the technician's device GPS, and **warn + allow + flag for QA review**
(never hard-block) when the technician is more than 25 m from the planned
location, or when the location can't be verified. This mirrors the existing
SiteCam VLM **fail-open** philosophy: never stop a field technician from doing
their job; surface anything suspect to QA instead.

## Non-goals (YAGNI)

- No hard block on out-of-range capture.
- No live map / pin-drop / "navigate to site" UI — coordinates are displayed as text only.
- No retro-active geofencing of historic submissions.
- No background / continuous location tracking — GPS is read at two discrete moments only.

## Enforcement model (settled — do not re-litigate)

Out-of-range, missing planned GPS, and missing/denied device GPS all resolve to
**warn (where actionable) + allow + flag for QA** — consistent with the VLM
fail-open pattern. The geofence never prevents capture or submission.

## Architecture overview

Three touch points, two GPS reads:

1. **Site lookup API** returns planned coordinates + PON + zone.
2. **Entry card** displays them (2-column meta grid) and runs the geofence check
   on **Start Capture** (GPS read #1 → 4-state outcome → optional warning).
3. **Submit** re-reads device GPS (read #2, audit datapoint) and persists the
   full geofence record to the submission row.

---

## 1. Data layer — `GET /api/sitecam/site/:id`

File: `pages/api/sitecam/site/[id].ts`

Extend both the DR query (`drops`) and the pole query (`poles`) to also select
`latitude`, `longitude`, `pon_no`, `zone_no`. All four columns are confirmed
present on both `public.drops` and `public.poles`
(`latitude`/`longitude` = numeric, `pon_no`/`zone_no` = integer).

Add to the `SiteInfo` response (and the `SiteInfo` interface in
`src/modules/sitecam/hooks/useSiteCamCapture.ts`):

```ts
plannedLat: number | null;   // drops/poles.latitude
plannedLon: number | null;   // drops/poles.longitude
pon: number | null;          // pon_no
zone: number | null;         // zone_no
```

Coerce numeric columns to JS `number` (pg returns numeric as string) and pass
`null` through when absent. No change to the existing auth (`withAuth`) or to
`dropNumberCandidates` / `toDrSiteId`.

## 2. Card UI — `SiteCamEntry.tsx` (2-column meta grid)

Add a bordered meta grid to the existing confirmation card, below the address
row and above the project name / Start Capture button:

```
┌────────────────────────────┐
│ [Activation]   DR1854086     │
├────────────────────────────┤
│ John Customer                │
│ 📍 123 Main Rd, Mohadin      │
│ ┌─────────┬─────────┐        │
│ │ PON 12  │ Zone 4  │        │
│ ├─────────┴─────────┤        │
│ │ 📍 -26.12, 27.56  │        │
│ └───────────────────┘        │
│ [   Start Capture   ]        │
└────────────────────────────┘
```

- Two-column top row: `PON {pon}` | `Zone {zone}`.
- Full-width bottom row: planned coordinates (`📍 {lat}, {lon}`), 5–6 dp.
- **Null handling:** hide an individual cell when its value is null. If both PON
  and zone are null, hide the top row; if planned coords are null, hide the
  coord row. If the whole grid would be empty, omit it entirely.
- Civils (poles) have no `customerName` / `address` (API returns null), so this
  grid is the primary detail block for civil jobs — render the same way.
- Keep the existing dark Tailwind palette (`neutral-*`, borders `neutral-800`),
  consistent with the surrounding card chrome.

## 3. Geofence check — 4-state outcome (Start Capture)

On **Start Capture** (`handleStart` in `SiteCamEntry.tsx`), before navigating to
the wizard, call `navigator.geolocation.getCurrentPosition` with a sane timeout
(e.g. `{ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }`).

Classification precedence (first match wins):

| Order | Condition | `status` | Technician sees | QA outcome |
|---|---|---|---|---|
| 1 | planned coords missing | `no_planned_coords` | nothing (silent) | benign audit note — geofence not checked |
| 2 | device GPS denied / timeout / unavailable (planned exists) | `device_gps_off` | gentle warning → "Continue" | flag: "location not captured" |
| 3 | `distance − accuracy > 25 m` | `out_of_range` | warning incl. distance → "Continue anyway" | flag: "out of range" |
| 4 | otherwise (within range) | `on_site` | brief ✓ "On site" | none |

**Precedence rationale:** `no_planned_coords` outranks `device_gps_off` — there
is no point prompting a technician to enable GPS when there is nothing to compare
against.

**Distance:** haversine between device `(lat, lon)` and planned `(lat, lon)`,
in metres.

**Accuracy slack (decided):** classify `out_of_range` only when
`distance − accuracy > 25 m`, where `accuracy` is the device-reported
`coords.accuracy` (metres). Phone GPS is typically ±10–30 m, so a strict 25 m
line would false-flag technicians standing on-site. Always store the raw
`gps_accuracy_m` so QA can judge borderline cases.

**Warning UX (decided):** an **inline warning banner** rendered on the entry
card after Start Capture is tapped, with a "Continue anyway" / "Continue" button.
Navigation to the wizard is deferred until the technician confirms. Do **not**
use a blocking modal or `window.confirm` — native dialogs trip the
browser-dialog freeze rule and are heavier than needed for warn+allow.

The resolved geofence result is carried into the wizard (route state or a small
shared store) so it can be included in the submission payload.

## 4. Persistence

### Submit payload

`submitAll` (in `useSiteCamCapture.ts`) currently posts
`{ jobType, siteId, photos }` to `POST /api/sitecam/upload`. Add a `geofence`
object:

```ts
geofence: {
  status: 'on_site' | 'out_of_range' | 'device_gps_off' | 'no_planned_coords';
  distanceM: number | null;       // haversine result, null when not computed
  deviceLat: number | null;       // GPS read #1 (Start Capture)
  deviceLon: number | null;
  plannedLat: number | null;      // snapshot from site lookup
  plannedLon: number | null;
  accuracyM: number | null;       // coords.accuracy from read #1
  submitLat: number | null;       // GPS read #2 (at submit, audit datapoint)
  submitLon: number | null;
}
```

At **submit** time, re-read `navigator.geolocation.getCurrentPosition` to fill
`submitLat` / `submitLon`. This second read is best-effort: if it fails, leave
them null — it must never block submission.

### Upload endpoint

File: `pages/api/sitecam/upload.ts`. It already `UPDATE`s the submission row per
job type and sets `pwa_vlm_unavailable_steps`. Extend both branches to also write
the geofence columns:

- `jobType === 'activations'` → `dr_photo_unified_reviews`
- `jobType === 'civils'` → `pole_install_sessions`

### Migration

Add the same nullable columns to **both** `dr_photo_unified_reviews` and
`pole_install_sessions` (mirrors the `pwa_vlm_unavailable_steps` precedent):

- `geofence_status` text
- `geofence_distance_m` numeric
- `device_lat` numeric, `device_lon` numeric
- `planned_lat` numeric, `planned_lon` numeric  (snapshot — keeps the record
  self-contained if `drops`/`poles` coords change later)
- `gps_accuracy_m` numeric
- `submit_lat` numeric, `submit_lon` numeric

Follow the project migration conventions: next version = `MAX(DB max, ls max)+1`,
file under `scripts/migrations/sql/`, register in the `migrations` table
(`executed_at` + varchar `version`). Verify live schema with `\d` before writing.
All columns nullable — no backfill required.

## 5. Edge cases

- **Both planned and device GPS missing** → `no_planned_coords` (precedence rule
  1). Silent; no actionable warning.
- **Device GPS read times out** → treated as `device_gps_off`.
- **HTTPS requirement:** `navigator.geolocation` requires a secure context;
  `app.fibreflow.app` / `dev.fibreflow.app` are HTTPS, so this is satisfied in
  all deploy environments. Local dev over `http://localhost` is also a secure
  context per the browser spec.
- **Submit-time GPS failure** → leave `submitLat/Lon` null; never block submit.
- **`accuracy` absent / 0** → treat slack as 0 (strict 25 m).

## 6. Testing

- **Unit:** haversine distance (known coordinate pairs) and the 4-state
  classifier — table-driven, including the accuracy-slack boundary
  (`distance − accuracy` just above / below 25 m) and each precedence transition.
- **Component:** `SiteCamEntry` renders the meta grid; verify per-cell null
  hiding (PON/zone/coords individually and the whole-grid-empty case); verify the
  inline warning banner appears for `out_of_range` / `device_gps_off` and not for
  `on_site` / `no_planned_coords`.
- **Browser (playwriter):** mock `navigator.geolocation.getCurrentPosition` to
  drive each of the four states and assert the technician-facing behaviour
  (silent / warning / ✓), then confirm the `geofence` payload reaches
  `/api/sitecam/upload`.

## Files touched

- `pages/api/sitecam/site/[id].ts` — return planned coords + PON + zone.
- `src/modules/sitecam/hooks/useSiteCamCapture.ts` — `SiteInfo` fields, geofence
  state carried through, `submitAll` payload, submit-time GPS read.
- `src/modules/sitecam/components/SiteCamEntry.tsx` — meta grid, Start-Capture
  GPS read, inline warning banner.
- New: geofence helper (haversine + classifier) in `src/modules/sitecam/` —
  small, pure, independently testable.
- `pages/api/sitecam/upload.ts` — persist geofence columns (both job types).
- New migration under `scripts/migrations/sql/`.
