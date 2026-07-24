# QField Audit Reconciliation Report — Design

**Date:** 2026-07-24
**Branch:** `feat/qfield-audit-reconciliation`
**Status:** Approved design → implementation planning

---

## 1. Problem & goal

On 2026-07-23 the velo-server root disk saturated and QFieldCloud `delta_apply`
jobs failed for several projects; some field edits ("deltas") stuck in
`error`/`not_applied` instead of applying to the project GeoPackages. A field lead
reported "MOA PON 164 optical data" looked lost. Answering whether audit data
actually reached the server required hand-querying the QFieldCloud Postgres DB.

**The gap:** FibreFlow has no way to see, per project/PON, what audit data made it
to the server, what is stuck, and what is genuinely missing.

**Goal:** a **read-only reconciliation report** in FibreFlow that, per project (and
per PON where derivable), surfaces:

1. **Audit completeness** — optical & civil audits done vs outstanding.
2. **Stuck deltas** — anything `error`/`not_applied`/`conflict`, distinguishing
   *genuinely stuck* from *stale duplicate of a recovered edit*.
3. **Photo integrity** — each delta's referenced photos cross-checked against MinIO.
4. A clear **three-way breakdown: applied ✓ / stuck (recoverable) / never-captured.**

**Hard constraint:** read-only. The report NEVER mutates QFieldCloud data (no
re-applying, no deleting deltas, no writes to `qfieldcloud_db` or its MinIO bucket).

---

## 2. Ground truth (verified against live `FT_Mohadin`, 2026-07-24)

These facts were confirmed by direct read-only queries and drive the logic below.

### 2.1 Delta status distribution (`FT_Mohadin`)
`applied 6620 · conflict 396 · not_applied 216 · error 14`.

### 2.2 The PON-161 "stale duplicate" case
The 14 `error` rows are 14 distinct splitter features (`fid` 3506–3533,
`pon_no=161`, `Status="Optical Complete"`), created 2026-07-23 11:43 UTC. **Each has
exactly one `applied` twin** for the same feature (client re-sync at 14:49 UTC). So
the 14 errors are stale duplicates of successfully-applied edits — net complete.

### 2.3 The PON-164 "never captured" case
Optical coverage (applied `Optical Complete` splitter deltas) exists for PONs
…160, 161, 162, 163, **[164 absent]**, 165, 166, 167, 168…. **PON 164 has zero
deltas of any status.** Its neighbours are complete → genuine gap, not a server loss.

### 2.4 Civil for PON 164 (why the design layer is required)
Civil **pole** features carry only `label`+`zone`+geometry — **0 of 3593 pole
deltas carry `pon_no`.** Resolving "which poles belong to PON 164" required the
design layers in QFieldCloud storage:
- `MOAPons.gpkg` — 236 PON polygons, field `dp` = PON number (PON 164 = `dp='164'`,
  Zone 12, a real MULTIPOLYGON).
- `MOAPoles.gpkg` — pole points (`label`, `zone`, lat/lon).

Spatial join (poles within PON-164 polygon) → **23 poles**. Of those: **5** have a
civil delta (all `Pole Planted/ All Photos`, 1 photo each, applied 2026-07-08),
**0** are `Pole Verified/ Civil Complete`, **18** have no civil delta. All **5/5**
photos are present in MinIO. Conclusion: nothing lost, but civil-164 is mostly
outstanding field work — a result **only derivable with the design-layer join.**

### 2.5 Key JSON shapes in `core_delta.content`
- Feature identity: **`(kind, localPk)`**, where `localPk` is
  `content->>'localPk'` ( == `content->>'sourcePk'` ==
  `content->'old'->'attributes'->>'fid'` ) and `kind` is derived from
  `Status` (optical = splitters, civil = poles). `localPk` alone is only
  unique WITHIN a single QField layer — a splitter (optical) and a pole
  (civil) can share the same `localPk`, so keying on `localPk` alone silently
  merges cross-layer features into one. This was caught in testing: PON-161
  optical read 11/14 (3 of its 14 splitter features collided with civil pole
  deltas sharing the same `localPk` and were folded into the civil count)
  before the composite `(kind, localPk)` key fixed it. `(kind, localPk)` is
  the join key linking an `error` delta to its `applied` twin.
- `content->>'method'` ∈ `create|patch|delete`.
- `content->'new'->'attributes'->>'Status'` — audit outcome:
  - Optical: `"Optical Complete"`.
  - Civil: `"Pole Verified/ Civil Complete"` (complete), `"Pole Planted/ All Photos"`
    / `"Pole Planted - Photos Incomplete"` (partial). Other values exist
    (`String Complete`, `Pole Removed/Canceled`) — out of scope for v1 completeness.
- `content->'old'->'attributes'`: splitters carry `pon_no`, `zone_no`, `label`
  (`MOA.STS.8…`); poles carry `label` (`MOA.P.…`), `zone`, `Latitude`/`Longitude`.
- `content->'new'->'files_sha256'` — object mapping `DCIM/<file>.jpg` → sha256.

### 2.6 MinIO object model
Bucket `qfieldcloud-prod`; a photo `DCIM/x.jpg` exists iff objects exist under
prefix `projects/<project_id>/files/DCIM/x.jpg/` (each version is a suffixed
object). Presence check = "≥1 object under the logical-key prefix".

---

## 3. Architecture

All three data sources are reachable from the FibreFlow app process **on velo**
(where dev:3005 / prod:3000 already run) — verified this session:

| Source | Access mechanism | Purpose |
|---|---|---|
| QFieldCloud PG `localhost:5433` | new **read-only `pg.Pool`** (`QFIELDCLOUD_DATABASE_URL`) | `core_project`, `core_delta`, `core_job` |
| MinIO `qfieldcloud-prod` | `docker exec qfieldcloud-minio-1 mc …` (existing `photo-proxy` pattern) | photo-presence listing + fetch design GPKGs |
| Design GPKGs | Python `geopandas` resolver via `child_process` | pole→PON spatial map |

No PostGIS dependency (spatial join runs in geopandas). No MinIO credentials needed
(the container's pre-configured `local` mc alias is used, as in `photo-proxy`).

### 3.1 Request data flow — `GET /api/qfield/reconciliation?projectId=<uuid>`
```
withAuth
 └─ 1. ponMapService.getMap(projectId)
 │      • find latest design-GPKG versions in MinIO (qfcDeltaRepo → filestorage_*)
 │      • cache hit on (project_id, gpkg_version)?  → return cached pole→PON map
 │      • miss → resolve_pon_poles.py (mc cat GPKGs → geopandas sjoin → JSON) → cache
 ├─ 2. qfcDeltaRepo.getAuditDeltas(projectId)   (projected fields only, not full JSONB)
 ├─ 3. minio.listDcimKeys(projectId)            (one `mc ls --recursive …/DCIM/`)
 ├─ 4. reconciliationService.build(deltas, ponMap, presentKeys)  ← PURE
 └─ 5. apiResponse.success(res, model)
```

### 3.2 Module layout (FF conventions)
```
src/lib/qfieldcloud/qfcPool.ts            # read-only pg.Pool, mirrors src/lib/db.ts sizing/guards
src/lib/qfieldcloud/minio.ts             # mc ls/cat wrapper (shell-injection guard from photo-proxy)
scripts/qfield-recon/resolve_pon_poles.py # geopandas: discover design layers, sjoin, emit JSON
src/modules/qfield-recon/
  types/index.ts                          # ReconModel, PonSummary, FeatureRecon, PhotoFlag, …
  services/qfcDeltaRepo.ts                # QFieldCloud SELECTs (audit deltas, projects, design files)
  services/ponMapService.ts               # resolver orchestration + FF-DB cache
  services/reconciliationService.ts       # PURE classification logic
  components/                             # ReconDashboard, BreakdownCards, PonCompletenessTable,
                                          #   StuckDeltaTable, PhotoIntegrityList, ProjectSelector
  index.ts
pages/api/qfield/reconciliation.ts        # GET, withAuth → ReconModel
pages/api/qfield/reconciliation-projects.ts # GET project list for the selector
pages/qfield/reconciliation.tsx           # page: selector + dashboard
sql/NNN_qfield_pole_pon_cache.sql         # FF-DB cache table (+ sql/rollback_NNN_…)
```

### 3.3 `reconciliationService` — the pure core (unit-tested)
Input: projected audit deltas, pole→PON map, present-photo-key set.
Per **feature** (`localPk`), aggregate its deltas and classify:

- `applied` — has an applied audit delta (net complete).
- `stale_duplicate` — has a stuck delta **and** an applied twin → recovered noise
  (the PON-161 case). Feature counts as complete; the stuck rows are surfaced as
  informational "stale".
- `stuck_recoverable` — has a stuck (`error|not_applied|conflict`) delta and **no**
  applied twin → genuinely needs attention.
- `never_captured` — present in the design (PON polygon / pole) but **zero** deltas.

Roll up per **PON** (`dp`), splitting **optical** (splitter `pon_no`, direct) and
**civil** (pole→PON via the design map):
```
PON 164
  optical: 0/1 splitter        NEVER CAPTURED
  civil:   5/23 poles planted, 0 verified, 18 no-audit
  photos:  5/5 present ✓
```
**Photo integrity:** each delta's `files_sha256` keys are checked against the
present-key set; misses are flagged with feature label, status, and delta id.

**Graceful degradation:** `resolve_pon_poles.py` *discovers* design layers (a
polygon layer with a PON-like field + a point layer with pole labels). If a project
has none, civil-per-PON is reported "unavailable — no design layer" while
optical-per-PON still works. `never_captured` optical for such projects falls back
to observed-PON-sequence-gap detection (still catches a 164-style gap).

### 3.4 Caching
FF-DB table `qfield_pole_pon_cache(project_id, gpkg_version, pole_label, pon_no,
zone, resolved_at)`, keyed by `(project_id, gpkg_version)`. Reads become pure SQL
and carry provenance ("resolved from design version X"). Recomputed only when a new
GPKG version appears in MinIO. (Alternative considered: in-process TTL memo — avoids
a migration but loses persistence/provenance and recomputes per instance. Table
chosen for durability; additive migration, safe on the shared DB.)

### 3.5 Credentials (hard-rule compliant)
`QFIELDCLOUD_DATABASE_URL` lives ONLY in the server env (fibreflow-dev /
fibreflow-production systemd env) and `.claude/credentials.local.md` (gitignored) —
never a tracked file. Code reads `process.env.QFIELDCLOUD_DATABASE_URL`. Hardening
note: a dedicated read-only PG role in `qfieldcloud_db` is preferable to the admin
creds (broader than needed); v1 may use existing creds but the report only ever
issues SELECTs.

---

## 4. API contract

`GET /api/qfield/reconciliation-projects` → `{ projects: [{ id, name,
data_last_updated_at }] }` (from `core_project`).

`GET /api/qfield/reconciliation?projectId=<uuid>` → `ReconModel`:
```ts
interface ReconModel {
  project: { id: string; name: string };
  designLayer: { available: boolean; gpkgVersion: string | null; resolvedAt: string | null };
  totals: { applied: number; stuckRecoverable: number; staleDuplicate: number; neverCaptured: number };
  optical: PonSummary[];   // per PON: features applied/stuck/stale/neverCaptured, photo flags
  civil:   PonSummary[];   // per PON (or "unassigned" bucket if no design layer)
  stuckDeltas: StuckDelta[];   // label, status, lastStatus, createdAt, supersededByAppliedTwin
  photoFlags: PhotoFlag[];     // referenced photo absent from MinIO
  notes: string[];             // e.g. sync-photos-to-local cron flagged out of scope
}
```
Standard `apiResponse.success` / `apiResponse.badRequest` (missing/invalid
`projectId`) / `apiResponse.databaseError`. `503` if run off-velo (docker/mc
unavailable) — mirrors `photo-proxy` behaviour.

---

## 5. UI (`/qfield/reconciliation`)

Project selector (default `FT_Mohadin`), then:
- **Three-way breakdown cards** — applied ✓ / stuck (recoverable) / never-captured.
- **PON completeness table** — optical + civil per PON, with never-captured rows
  highlighted (PON 164).
- **Stuck-delta table** — feature label, status, timestamp, and a
  `superseded?` badge (stale-duplicate vs genuinely-stuck).
- **Photo-integrity list** — any referenced photo missing from MinIO.
- Files < 300 lines, components < 200 lines; `log` from `@/lib/logger`; no
  `console.log`.

---

## 6. Testing (acceptance criteria → fixtures)

`reconciliationService` is pure → the acceptance criteria become **vitest**
fixtures (no DB/MinIO needed):
1. **PON 161 twin case** — 14 error features each with an applied twin →
   classified `stale_duplicate`, PON 161 net-complete, stuck rows flagged stale.
2. **PON 164 gap** — design has PON 164 + 23 poles, zero optical deltas, 5 civil
   planted deltas → optical `never_captured`, civil `5/23 planted, 0 verified,
   18 never_captured`.
3. **Missing-photo case** — a delta references a `files_sha256` key absent from the
   present-key set → `photoFlags` entry.
4. **No-design-layer project** — civil marked "unavailable", optical falls back to
   sequence-gap detection.

Live verification on velo/dev deploy: run the report for `FT_Mohadin` and confirm
the three ground-truth facts (§2.2–2.4) render. `npm run ci:quick` before PR.

---

## 7. Non-goals (flagged, not fixed)

- **`scripts/sync-photos-to-local.js`** cron failing on the stale `neondb_owner`
  credential — the report does **not** use that path, so it is noted here and not
  touched by this work.
- No mutation/recovery of stuck deltas (a future "recover" action is out of scope).
- Non-audit statuses (`String Complete`, `Pole Removed/Canceled`) are surfaced only
  as counts, not part of completeness.

---

## 8. Open items for implementation planning

- Exact `sql/NNN_…` migration number (MAX+1 at implementation time; check live).
- Whether to extract `photo-proxy`'s shell-guard into the shared `minio.ts` and
  refactor `photo-proxy` to use it (nice-to-have; keep surgical if it grows scope).
- Confirm `geopandas`/`ogr` availability on the deploy env matches this dev box
  (present here; verify the fibreflow systemd env `PATH`/python before relying on it
  in prod — else the resolver runs via `docker exec qfieldcloud-app-1` which has GDAL).
