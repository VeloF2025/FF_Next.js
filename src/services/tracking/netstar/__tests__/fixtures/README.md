# Netstar "All Activity" export — fixture

Captured 2026-08-05 from `profleet.netstar.co.za`, vehicle `LN40MGGP`
(Netstar internal id `1447952`), window 2026-08-04 00:00 → 2026-08-05 ~16:20 SAST.
Export format: **CSV** (via the portal's Export → CSV control).

Full export was 969 lines (968 data rows) for ~1.5 days of one vehicle. This
fixture keeps the header plus the first 50 data rows.

## Header row, verbatim

    Driver,Driver Department,Driver Unique Code,Time,Speed,Address,Status,Gps,Speed Limit,Latitude,Longitude,RPM,Battery Voltage,Odometer

Line endings are CRLF.

## The trap: comma is the decimal separator

Numeric fields are quoted and use a **comma** as the decimal point, not a period:

    "0,0"        → 0.0    km/h
    "-26,08975"  → -26.08975  degrees
    "28,35431"   → 28.35431   degrees
    "14,8"       → 14.8   volts
    "60,0"       → 60.0   km/h

A naive `Number(v.replace(/[^\d.-]/g, ''))` yields `-2608975` for that latitude —
a plausible-looking number that puts the vehicle nowhere on Earth. The parser must
convert the decimal comma explicitly.

`Odometer` is the exception: it is an unquoted integer with no separator (`54302`).

## Column semantics

| Column | Example | Meaning | Maps to `ProviderPosition` |
|---|---|---|---|
| `Driver` | `No driver` | Driver name, or the literal `No driver` | — (not carried) |
| `Driver Department` | *(empty)* | — | — |
| `Driver Unique Code` | *(empty)* | — | — |
| `Time` | `04/08/2026 07:26:38` | **DD/MM/YYYY HH:mm:ss**, SAST local, no zone marker | `recordedAt` |
| `Speed` | `"0,0"` | km/h, decimal comma | `speedKph` |
| `Address` | `"0.05 km from Tamarisk Road…"` | Reverse-geocoded text, contains commas | — |
| `Status` | `Timed Event` | Event type — see below | `ignition`, `isSpeeding` |
| `Gps` | `true` | GPS fix valid | drop the row when `false` |
| `Speed Limit` | `"60,0"` | km/h, decimal comma | `roadSpeedKph` |
| `Latitude` | `"-26,08975"` | decimal comma | `lat` |
| `Longitude` | `"28,35431"` | decimal comma | `lon` |
| `RPM` | `0` | engine RPM | — (no field) |
| `Battery Voltage` | `"14,8"` | volts, decimal comma | — (no field) |
| `Odometer` | `54302` | km, plain integer | `odometerKm` |

## `Status` values observed (968-row sample)

| Value | Count | Meaning |
|---|---|---|
| `Timed Event` | 271 | Periodic heartbeat — carries no ignition information |
| `Stopped` | 68 | Vehicle stationary |
| `Moving` | 63 | Vehicle in motion |
| `Ignition on` | 18 | Ignition transition |
| `Ignition off` | 17 | Ignition transition |
| `Speeding` | 14 | Over the road speed limit |
| `Idling` | 1 | Stationary, engine running |

**Ignition is a transition event, not a per-row state.** Only `Ignition on` /
`Ignition off` state it; every other row must emit `null`, never a guess. Inferring
"moving therefore ignition on" would fabricate data the provider did not supply,
which `types.ts` explicitly forbids.

`isSpeeding` is `true` only for `Status = Speeding`; `null` otherwise — the export
does not mark non-speeding rows as confirmed-not-speeding.

## Fields Netstar does not supply

`providerEventId`, `bearing`, `altitudeM`, `gpsFixType`, `linearG`, `lateralG` —
all `null`. There is no heading/bearing column at all.

## No registration column

The export identifies the vehicle nowhere in the file: it is implied by the request.
**Therefore one report must be requested per vehicle**, and the caller stamps
`externalId` onto every row. Requesting several vehicles in one report would return
rows that cannot be attributed.
