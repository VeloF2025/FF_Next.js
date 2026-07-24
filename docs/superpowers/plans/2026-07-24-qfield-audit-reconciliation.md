# QField Audit Reconciliation Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only FibreFlow report that reconciles QFieldCloud audit data per project/PON into applied ✓ / stuck (recoverable) / never-captured, with stale-duplicate detection and MinIO photo-integrity checks.

**Architecture:** A new Pages-API + App-Router page reads live QFieldCloud Postgres (`localhost:5433`, read-only pool) and MinIO (`docker exec … mc`, the existing photo-proxy pattern). Pole→PON scoping comes from the project design GeoPackages (`MOAPons`/`MOAPoles`), resolved by a Python/geopandas child-process and cached in an FF-DB table keyed by GPKG version. All classification lives in one **pure** service that is unit-tested against the real incident fixtures.

**Tech Stack:** Next.js (Pages API + App Router), TypeScript, `pg` (8.16), vitest (0.34), Python 3 + geopandas (present on velo), MinIO `mc` via `docker exec`.

## Global Constraints

- **Read-only.** Never mutate `qfieldcloud_db` or the `qfieldcloud-prod` MinIO bucket. Only `SELECT` against 5433; only `mc ls`/`mc cat` against MinIO. No re-apply, no delete.
- **Runs on velo.** DB 5433, docker, `mc`, and geopandas are only reachable on velo-server (where dev:3005/prod:3000 run). Off-velo the report returns `503` (mirror `photo-proxy`).
- **No credentials in tracked files.** `QFIELDCLOUD_DATABASE_URL` lives only in server env + `.claude/credentials.local.md` (gitignored). Code reads `process.env.QFIELDCLOUD_DATABASE_URL`.
- **FF code quality:** no `console.log` (use `log` from `@/lib/logger`); no empty catch; 100% types; files < 300 lines, components < 200 lines.
- **Conventions:** API routes use `withAuth` from `@/lib/auth` and `apiResponse` from `@/lib/apiResponse`. FF-DB access via `@/lib/db-pool` (`sql`/`query`/`queryOne`).
- **Feature identity** = `content->>'localPk'` (ties an `error` delta to its `applied` twin). **Design↔field join** = feature `label` (design GPKG has no `localPk`).
- **Migrations:** `scripts/migrations/sql/NNN_*.sql`. 458 and 460 are already taken (460 = WA Cloud P1.5, merged 2026-07-24) → use **460**. **Re-verify MAX+1 at build time** (`ls scripts/migrations/sql | grep -oE '^[0-9]+' | sort -n | tail -1`) — parallel sessions may have taken 460 too; bump if so. Add `rollback_460_*.sql`. Idempotent (`IF NOT EXISTS`). Auto-applied by `scripts/run-pending-migrations.sh` on deploy.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/modules/qfield-recon/types/index.ts` | All shared types (`AuditDelta`, `PonMap`, `ReconModel`, …) |
| `src/modules/qfield-recon/services/reconciliationService.ts` | **Pure** classification: deltas + ponMap + present-photo-keys → `ReconModel` |
| `src/modules/qfield-recon/services/__tests__/reconciliationService.test.ts` | Unit tests = the incident acceptance criteria |
| `src/lib/qfieldcloud/qfcPool.ts` | Read-only `pg.Pool` singleton to 5433 |
| `src/modules/qfield-recon/services/qfcDeltaRepo.ts` | QFieldCloud SELECTs: projects, audit deltas, design-GPKG versions |
| `src/lib/qfieldcloud/minio.ts` | `mc ls`/`mc cat` wrappers (shell-injection guard from photo-proxy) |
| `scripts/qfield-recon/resolve_pon_poles.py` | geopandas: discover design layers, spatial join → JSON |
| `src/modules/qfield-recon/services/ponMapService.ts` | Resolver orchestration + FF-DB cache read/write |
| `scripts/migrations/sql/460_qfield_pole_pon_cache.sql` (+ rollback) | FF-DB cache table |
| `pages/api/qfield/reconciliation-projects.ts` | GET project list for selector |
| `pages/api/qfield/reconciliation.ts` | GET the `ReconModel` for a project |
| `app/(main)/qfield/reconciliation/page.tsx` | The page (client): selector + dashboard |
| `src/modules/qfield-recon/components/*` | Presentational components |

---

## Task 1: Types + pure reconciliation service (the core, TDD)

**Files:**
- Create: `src/modules/qfield-recon/types/index.ts`
- Create: `src/modules/qfield-recon/services/reconciliationService.ts`
- Test: `src/modules/qfield-recon/services/__tests__/reconciliationService.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `buildReconciliation(input)` and all types below. Later tasks import types from `@/modules/qfield-recon/types` and call `buildReconciliation`.

- [ ] **Step 1: Write the types file**

Create `src/modules/qfield-recon/types/index.ts`:

```ts
export type LastStatus =
  | 'applied' | 'conflict' | 'not_applied' | 'error' | 'started' | 'pending';

export type AuditKind = 'optical' | 'civil';
export type FeatureClass =
  | 'applied' | 'stale_duplicate' | 'stuck_recoverable' | 'never_captured';

/** One audit delta, projected from core_delta (never the full JSONB). */
export interface AuditDelta {
  id: string;
  featureKey: string;      // content->>'localPk'
  label: string | null;    // old/new attributes 'label'
  kind: AuditKind;         // derived from Status
  status: string;          // new.attributes.Status, e.g. 'Optical Complete'
  lastStatus: LastStatus;
  ponNo: number | null;    // splitter pon_no (optical); null for poles
  zone: string | null;
  createdAt: string;       // ISO 8601
  photoKeys: string[];     // keys of files_sha256 (e.g. 'DCIM/x.jpg')
}

/** Design topology resolved from the project GeoPackage. */
export interface PonMap {
  available: boolean;            // false when the project has no design layer
  gpkgVersion: string | null;    // version key the cache is stored under
  resolvedAt: string | null;
  designPons: number[];          // all PON numbers in design (MOAPons.dp)
  poleToPon: Record<string, { pon: number; zone: string | null }>; // pole label -> PON
}

export interface PhotoFlag {
  deltaId: string;
  featureKey: string;
  label: string | null;
  photoKey: string;              // DCIM key referenced by the delta but absent in MinIO
}

export interface StuckDelta {
  deltaId: string;
  featureKey: string;
  label: string | null;
  kind: AuditKind;
  status: string;
  lastStatus: LastStatus;
  ponNo: number | null;
  createdAt: string;
  supersededByAppliedTwin: boolean;  // true => stale duplicate (recovered); false => genuinely stuck
}

export interface PonSummary {
  ponNo: number | null;          // null = poles with no resolvable PON (no design layer)
  kind: AuditKind;
  designFeatures: number;        // expected count from design (0 if unknown)
  applied: number;               // features net-complete (includes staleDuplicate)
  stuckRecoverable: number;
  staleDuplicate: number;        // subset of applied that also had a stuck twin
  neverCaptured: number;
  missingPhotos: number;
}

export interface ReconModel {
  project: { id: string; name: string };
  designLayer: { available: boolean; gpkgVersion: string | null; resolvedAt: string | null };
  totals: {
    applied: number; stuckRecoverable: number;
    staleDuplicate: number; neverCaptured: number;
  };
  optical: PonSummary[];
  civil: PonSummary[];
  stuckDeltas: StuckDelta[];
  photoFlags: PhotoFlag[];
  notes: string[];
}

export interface BuildInput {
  project: { id: string; name: string };
  deltas: AuditDelta[];
  ponMap: PonMap;
  presentPhotoKeys: Set<string>;  // logical DCIM keys present in MinIO
  notes?: string[];
}
```

- [ ] **Step 2: Write the failing test**

Create `src/modules/qfield-recon/services/__tests__/reconciliationService.test.ts`. Uses **relative** imports (avoids the vitest `@/lib`→`./lib` alias gotcha; this file has no `@/lib` deps):

```ts
import { describe, it, expect } from 'vitest';
import { buildReconciliation } from '../reconciliationService';
import type { AuditDelta, PonMap, BuildInput } from '../../types';

const project = { id: 'p1', name: 'FT_Mohadin' };

function optical(featureKey: string, pon: number, lastStatus: AuditDelta['lastStatus'], photos: string[] = []): AuditDelta {
  return { id: `${featureKey}-${lastStatus}`, featureKey, label: `MOA.STS.${featureKey}`, kind: 'optical',
    status: 'Optical Complete', lastStatus, ponNo: pon, zone: '12', createdAt: '2026-07-23T11:43:00Z', photoKeys: photos };
}
function civil(label: string, lastStatus: AuditDelta['lastStatus'], status = 'Pole Planted/ All Photos', photos: string[] = []): AuditDelta {
  return { id: `${label}-${lastStatus}`, featureKey: label, label, kind: 'civil',
    status, lastStatus, ponNo: null, zone: '12', createdAt: '2026-07-08T12:39:00Z', photoKeys: photos };
}
const emptyMap: PonMap = { available: false, gpkgVersion: null, resolvedAt: null, designPons: [], poleToPon: {} };

describe('buildReconciliation', () => {
  it('PON 161: 14 error deltas each with an applied twin are stale duplicates, PON net-complete', () => {
    const deltas: AuditDelta[] = [];
    for (let i = 0; i < 14; i++) {
      deltas.push(optical(String(3506 + i), 161, 'applied'));
      deltas.push(optical(String(3506 + i), 161, 'error'));
    }
    const map: PonMap = { available: true, gpkgVersion: 'v', resolvedAt: 'now', designPons: [161], poleToPon: {} };
    const input: BuildInput = { project, deltas, ponMap: map, presentPhotoKeys: new Set() };
    const model = buildReconciliation(input);
    const pon161 = model.optical.find(p => p.ponNo === 161)!;
    expect(pon161.applied).toBe(14);
    expect(pon161.staleDuplicate).toBe(14);
    expect(pon161.stuckRecoverable).toBe(0);
    expect(pon161.neverCaptured).toBe(0);
    expect(model.stuckDeltas.filter(s => s.lastStatus === 'error')).toHaveLength(14);
    expect(model.stuckDeltas.every(s => s.supersededByAppliedTwin)).toBe(true);
    expect(model.totals.stuckRecoverable).toBe(0);
  });

  it('PON 164: in design, zero optical deltas -> never_captured', () => {
    const deltas = [optical('3506', 163, 'applied'), optical('3600', 165, 'applied')];
    const map: PonMap = { available: true, gpkgVersion: 'v', resolvedAt: 'now', designPons: [163, 164, 165], poleToPon: {} };
    const model = buildReconciliation({ project, deltas, ponMap: map, presentPhotoKeys: new Set() });
    const pon164 = model.optical.find(p => p.ponNo === 164)!;
    expect(pon164.neverCaptured).toBe(1);
    expect(pon164.applied).toBe(0);
    expect(model.totals.neverCaptured).toBeGreaterThanOrEqual(1);
  });

  it('PON 164 civil: 23 design poles, 5 planted -> 5 applied, 18 never_captured', () => {
    const poleToPon: PonMap['poleToPon'] = {};
    const labels: string[] = [];
    for (let i = 744; i <= 764; i++) { const l = `MOA.P.D${i}`; poleToPon[l] = { pon: 164, zone: '12' }; labels.push(l); }
    poleToPon['MOA.P.A208'] = { pon: 164, zone: '12' }; labels.push('MOA.P.A208');
    poleToPon['MOA.P.A209'] = { pon: 164, zone: '12' }; labels.push('MOA.P.A209'); // 23 total
    const deltas = ['MOA.P.D753','MOA.P.D756','MOA.P.D757','MOA.P.D758','MOA.P.D759']
      .map(l => civil(l, 'applied', 'Pole Planted/ All Photos', [`DCIM/civil-${l}.jpg`]));
    const map: PonMap = { available: true, gpkgVersion: 'v', resolvedAt: 'now', designPons: [164], poleToPon };
    const present = new Set(deltas.flatMap(d => d.photoKeys));
    const model = buildReconciliation({ project, deltas, ponMap: map, presentPhotoKeys: present });
    const pon164 = model.civil.find(p => p.ponNo === 164)!;
    expect(pon164.designFeatures).toBe(23);
    expect(pon164.applied).toBe(5);
    expect(pon164.neverCaptured).toBe(18);
    expect(pon164.missingPhotos).toBe(0);
  });

  it('missing photo is flagged', () => {
    const deltas = [civil('MOA.P.D753', 'applied', 'Pole Planted/ All Photos', ['DCIM/present.jpg', 'DCIM/gone.jpg'])];
    const map: PonMap = { available: true, gpkgVersion: 'v', resolvedAt: 'now', designPons: [164], poleToPon: { 'MOA.P.D753': { pon: 164, zone: '12' } } };
    const model = buildReconciliation({ project, deltas, ponMap: map, presentPhotoKeys: new Set(['DCIM/present.jpg']) });
    expect(model.photoFlags).toHaveLength(1);
    expect(model.photoFlags[0].photoKey).toBe('DCIM/gone.jpg');
  });

  it('no design layer: optical never_captured via observed-sequence gap', () => {
    const deltas = [163, 165, 166].map(pon => optical(`s${pon}`, pon, 'applied'));
    const model = buildReconciliation({ project, deltas, ponMap: emptyMap, presentPhotoKeys: new Set() });
    expect(model.designLayer.available).toBe(false);
    const gap = model.optical.find(p => p.ponNo === 164);
    expect(gap?.neverCaptured).toBe(1);
    // civil with no design layer lands in the null-PON bucket, not per-PON
    expect(model.civil.every(p => p.ponNo === null || p.designFeatures === 0)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /home/hein/Workspace/FF_Next.js-qfield-recon && npx vitest run src/modules/qfield-recon/services/__tests__/reconciliationService.test.ts`
Expected: FAIL — `Failed to resolve import "../reconciliationService"` / `buildReconciliation is not a function`.

- [ ] **Step 4: Write the implementation**

Create `src/modules/qfield-recon/services/reconciliationService.ts`:

```ts
import type {
  AuditDelta, BuildInput, PonMap, PonSummary, ReconModel, StuckDelta, PhotoFlag,
} from '../types';

const STUCK: ReadonlySet<string> = new Set(['error', 'not_applied', 'conflict']);

interface FeatureAgg {
  featureKey: string;
  label: string | null;
  kind: AuditDelta['kind'];
  ponNo: number | null;
  hasApplied: boolean;
  hasStuck: boolean;
  deltas: AuditDelta[];
}

function aggregateFeatures(deltas: AuditDelta[]): Map<string, FeatureAgg> {
  const map = new Map<string, FeatureAgg>();
  for (const d of deltas) {
    let a = map.get(d.featureKey);
    if (!a) {
      a = { featureKey: d.featureKey, label: d.label, kind: d.kind, ponNo: d.ponNo,
            hasApplied: false, hasStuck: false, deltas: [] };
      map.set(d.featureKey, a);
    }
    a.deltas.push(d);
    if (d.lastStatus === 'applied') a.hasApplied = true;
    if (STUCK.has(d.lastStatus)) a.hasStuck = true;
    // Prefer a non-null label / pon / zone from any delta.
    if (!a.label && d.label) a.label = d.label;
    if (a.ponNo == null && d.ponNo != null) a.ponNo = d.ponNo;
  }
  return map;
}

/** Empty per-PON accumulator. */
function emptySummary(ponNo: number | null, kind: AuditDelta['kind']): PonSummary {
  return { ponNo, kind, designFeatures: 0, applied: 0, stuckRecoverable: 0,
           staleDuplicate: 0, neverCaptured: 0, missingPhotos: 0 };
}

export function buildReconciliation(input: BuildInput): ReconModel {
  const { project, deltas, ponMap, presentPhotoKeys } = input;
  const notes = [...(input.notes ?? [])];

  const features = aggregateFeatures(deltas);

  // Resolve a feature's PON: optical carries pon on the delta; civil resolves via label.
  const ponOf = (a: FeatureAgg): number | null => {
    if (a.kind === 'optical') return a.ponNo;
    const label = a.label ?? '';
    return ponMap.poleToPon[label]?.pon ?? null;
  };

  const optical = new Map<number | null, PonSummary>();
  const civil = new Map<number | null, PonSummary>();
  const bucket = (kind: AuditDelta['kind'], pon: number | null): PonSummary => {
    const m = kind === 'optical' ? optical : civil;
    let s = m.get(pon);
    if (!s) { s = emptySummary(pon, kind); m.set(pon, s); }
    return s;
  };

  const stuckDeltas: StuckDelta[] = [];
  const photoFlags: PhotoFlag[] = [];
  const totals = { applied: 0, stuckRecoverable: 0, staleDuplicate: 0, neverCaptured: 0 };

  // Track observed PON per kind (for design comparison / sequence-gap fallback).
  const observedOpticalPons = new Set<number>();
  // Track which design pole labels were audited (by label).
  const auditedLabels = new Set<string>();

  for (const a of features.values()) {
    const pon = ponOf(a);
    const s = bucket(a.kind, pon);
    if (a.kind === 'optical' && pon != null) observedOpticalPons.add(pon);
    if (a.label) auditedLabels.add(a.label);

    if (a.hasApplied) {
      s.applied += 1; totals.applied += 1;
      if (a.hasStuck) { s.staleDuplicate += 1; totals.staleDuplicate += 1; }
    } else if (a.hasStuck) {
      s.stuckRecoverable += 1; totals.stuckRecoverable += 1;
    } else {
      // only started/pending — not applied yet; surface as recoverable/attention.
      s.stuckRecoverable += 1; totals.stuckRecoverable += 1;
    }

    // Stuck-delta rows + supersession (superseded iff the feature has an applied twin).
    for (const d of a.deltas) {
      if (STUCK.has(d.lastStatus)) {
        stuckDeltas.push({
          deltaId: d.id, featureKey: d.featureKey, label: d.label, kind: d.kind,
          status: d.status, lastStatus: d.lastStatus, ponNo: pon, createdAt: d.createdAt,
          supersededByAppliedTwin: a.hasApplied,
        });
      }
      // Photo integrity (check every referenced key once).
      for (const key of d.photoKeys) {
        if (!presentPhotoKeys.has(key)) {
          photoFlags.push({ deltaId: d.id, featureKey: d.featureKey, label: d.label, photoKey: key });
          s.missingPhotos += 1;
        }
      }
    }
  }

  // never_captured — optical
  if (ponMap.available && ponMap.designPons.length > 0) {
    for (const pon of ponMap.designPons) {
      if (!observedOpticalPons.has(pon)) {
        const s = bucket('optical', pon);
        s.neverCaptured += 1; totals.neverCaptured += 1;
      }
    }
  } else if (observedOpticalPons.size > 0) {
    // Fallback: gaps in the observed PON sequence (min..max) with no delta.
    const arr = [...observedOpticalPons].sort((x, y) => x - y);
    for (let p = arr[0]; p <= arr[arr.length - 1]; p++) {
      if (!observedOpticalPons.has(p)) {
        const s = bucket('optical', p);
        s.neverCaptured += 1; totals.neverCaptured += 1;
      }
    }
  }

  // never_captured — civil (design poles that were never audited)
  if (ponMap.available) {
    const designByPon = new Map<number, number>();
    for (const [label, { pon }] of Object.entries(ponMap.poleToPon)) {
      designByPon.set(pon, (designByPon.get(pon) ?? 0) + 1);
      if (!auditedLabels.has(label)) {
        const s = bucket('civil', pon);
        s.neverCaptured += 1; totals.neverCaptured += 1;
      }
    }
    for (const [pon, count] of designByPon) bucket('civil', pon).designFeatures = count;
  }

  const byPon = (a: PonSummary, b: PonSummary) =>
    (a.ponNo ?? Number.POSITIVE_INFINITY) - (b.ponNo ?? Number.POSITIVE_INFINITY);

  return {
    project,
    designLayer: { available: ponMap.available, gpkgVersion: ponMap.gpkgVersion, resolvedAt: ponMap.resolvedAt },
    totals,
    optical: [...optical.values()].sort(byPon),
    civil: [...civil.values()].sort(byPon),
    stuckDeltas: stuckDeltas.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    photoFlags,
    notes,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/hein/Workspace/FF_Next.js-qfield-recon && npx vitest run src/modules/qfield-recon/services/__tests__/reconciliationService.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-qfield-recon && git add src/modules/qfield-recon/types src/modules/qfield-recon/services/reconciliationService.ts src/modules/qfield-recon/services/__tests__ && git commit -m "feat(qfield-recon): pure reconciliation service + incident fixtures"
```

---

## Task 2: QFieldCloud read-only pool + delta repo

**Files:**
- Create: `src/lib/qfieldcloud/qfcPool.ts`
- Create: `src/modules/qfield-recon/services/qfcDeltaRepo.ts`

**Interfaces:**
- Consumes: `AuditDelta` type from Task 1.
- Produces: `qfcQuery(text, params)`, and `getProjects()`, `getAuditDeltas(projectId)`, `getDesignGpkgVersion(projectId)`.

- [ ] **Step 1: Write the read-only pool**

Create `src/lib/qfieldcloud/qfcPool.ts` (mirrors `src/lib/db.ts` sizing; separate DB):

```ts
/**
 * Read-only pg.Pool for the QFieldCloud database (localhost:5433).
 * SELECT-only — this pool must never be used to mutate qfieldcloud_db.
 * Connection string comes from env (QFIELDCLOUD_DATABASE_URL); never hardcoded.
 */
import { Pool } from 'pg';
import { log } from '@/lib/logger';

const connectionString = process.env.QFIELDCLOUD_DATABASE_URL;

let pool: Pool | null = null;

export function getQfcPool(): Pool {
  if (!connectionString) {
    throw new Error('QFIELDCLOUD_DATABASE_URL is not set (report only runs on velo).');
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: false, // localhost:5433 only — never a remote host, so no TLS needed
      application_name: `ff-qfc-recon-${process.env.PORT || 'app'}`,
      max: 3,
      min: 0,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on('error', (err) => log.error('qfc-pool', { message: err.message }, 'idle client error'));
  }
  return pool;
}

export async function qfcQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string, params: unknown[] = [],
): Promise<T[]> {
  const res = await getQfcPool().query<T>(text, params);
  return res.rows;
}
```

- [ ] **Step 2: Write the delta repo**

Create `src/modules/qfield-recon/services/qfcDeltaRepo.ts`:

```ts
import { qfcQuery } from '@/lib/qfieldcloud/qfcPool';
import type { AuditDelta, LastStatus } from '../types';

export interface QfcProject { id: string; name: string; dataLastUpdatedAt: string | null; }

export async function getProjects(): Promise<QfcProject[]> {
  const rows = await qfcQuery<{ id: string; name: string; d: string | null }>(
    `SELECT id::text AS id, name,
            to_char(data_last_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS d
       FROM core_project ORDER BY name`);
  return rows.map(r => ({ id: r.id, name: r.name, dataLastUpdatedAt: r.d }));
}

interface DeltaRow {
  id: string; feature_key: string | null; label: string | null; status: string | null;
  last_status: string; pon_no: number | null; zone: string | null;
  created_at: string; photo_keys: string[];
}

/** Kind from the field Status value; null => not an optical/civil audit (skip). */
function kindOf(status: string | null): AuditDelta['kind'] | null {
  if (!status) return null;
  if (status === 'Optical Complete') return 'optical';
  if (status.startsWith('Pole ')) return 'civil';
  return null;
}

export async function getAuditDeltas(projectId: string): Promise<AuditDelta[]> {
  const rows = await qfcQuery<DeltaRow>(
    `SELECT
        d.id::text AS id,
        d.content->>'localPk' AS feature_key,
        COALESCE(d.content->'old'->'attributes'->>'label',
                 d.content->'new'->'attributes'->>'label') AS label,
        d.content->'new'->'attributes'->>'Status' AS status,
        d.last_status,
        NULLIF(d.content->'old'->'attributes'->>'pon_no','')::int AS pon_no,
        COALESCE(d.content->'old'->'attributes'->>'zone_no',
                 d.content->'old'->'attributes'->>'zone') AS zone,
        to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
        COALESCE(ARRAY(SELECT jsonb_object_keys(
                 COALESCE(d.content->'new'->'files_sha256','{}'::jsonb))), '{}') AS photo_keys
     FROM core_delta d
     WHERE d.project_id = $1::uuid
       AND d.content->'new'->'attributes'->>'Status' IS NOT NULL`,
    [projectId]);

  const out: AuditDelta[] = [];
  for (const r of rows) {
    const kind = kindOf(r.status);
    if (!kind || !r.feature_key) continue;
    out.push({
      id: r.id, featureKey: r.feature_key, label: r.label, kind,
      status: r.status as string, lastStatus: r.last_status as LastStatus,
      ponNo: r.pon_no, zone: r.zone, createdAt: r.created_at, photoKeys: r.photo_keys,
    });
  }
  return out;
}

/** Latest MOAPons+MOAPoles version key, or null if the project has no design layer. */
export async function getDesignGpkgVersion(projectId: string): Promise<string | null> {
  const rows = await qfcQuery<{ name: string; v: string }>(
    `SELECT f.name,
            to_char(max(fv.created_at),'YYYYMMDDHH24MISS') AS v
       FROM filestorage_file f
       JOIN filestorage_fileversion fv ON fv.file_id = f.id
      WHERE f.project_id = $1::uuid
        AND (f.name ILIKE '%MOAPons.gpkg' OR f.name ILIKE '%MOAPoles.gpkg')
      GROUP BY f.name`,
    [projectId]);
  const pons = rows.find(r => r.name.toLowerCase().endsWith('moapons.gpkg'));
  const poles = rows.find(r => r.name.toLowerCase().endsWith('moapoles.gpkg'));
  if (!pons || !poles) return null;
  return `MOAPons:${pons.v}|MOAPoles:${poles.v}`;
}
```

- [ ] **Step 3: Live smoke check (no unit test — needs the live DB on velo)**

Set the env and run a one-off check. `QFIELDCLOUD_DATABASE_URL` value: see `.claude/credentials.local.md` (added in Task 4-step-0). Password source: `/opt/qfieldcloud/docker-compose.override.yml` → `POSTGRES_PASSWORD`.

```bash
cd /home/hein/Workspace/FF_Next.js-qfield-recon
export QFIELDCLOUD_DATABASE_URL='postgresql://qfieldcloud_db_admin:<pw>@localhost:5433/qfieldcloud_db'
npx tsx -e "import('./src/modules/qfield-recon/services/qfcDeltaRepo').then(async m=>{const ps=await m.getProjects();const moa=ps.find(p=>p.name==='FT_Mohadin');console.log('projects',ps.length,'moa',moa?.id);const d=await m.getAuditDeltas(moa!.id);console.log('audit deltas',d.length,'errors',d.filter(x=>x.lastStatus==='error').length,'gpkg',await m.getDesignGpkgVersion(moa!.id));process.exit(0);})"
```
Expected: `projects` ≥ 2; `audit deltas` in the thousands; `errors 14`; `gpkg MOAPons:…|MOAPoles:…`.

- [ ] **Step 4: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-qfield-recon && git add src/lib/qfieldcloud/qfcPool.ts src/modules/qfield-recon/services/qfcDeltaRepo.ts && git commit -m "feat(qfield-recon): read-only QFieldCloud pool + audit-delta repo"
```

---

## Task 3: MinIO wrapper (photo presence + object fetch)

**Files:**
- Create: `src/lib/qfieldcloud/minio.ts`

**Interfaces:**
- Produces: `listDcimKeys(projectId): Promise<Set<string>>`, `catObject(objectPath): Promise<Buffer>`, `MINIO_UNAVAILABLE` error marker.

- [ ] **Step 1: Write the wrapper**

Create `src/lib/qfieldcloud/minio.ts` (reuses photo-proxy's shell-injection guard and 503-detection):

```ts
/**
 * MinIO access for QFieldCloud storage via `mc` inside the container.
 * Only reachable on velo (docker). Read-only: `mc ls` and `mc cat` only.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { log } from '@/lib/logger';

const execAsync = promisify(exec);
const BUCKET = process.env.MINIO_BUCKET || 'qfieldcloud-prod';
export class MinioUnavailableError extends Error {}

const SHELL_UNSAFE = /[;`$|&\\(){}\[\]!#]/;

function assertSafe(path: string): void {
  if (SHELL_UNSAFE.test(path)) throw new Error('Invalid characters in object path');
}

/** Every logical DCIM key present under a project (version suffix stripped). */
export async function listDcimKeys(projectId: string): Promise<Set<string>> {
  assertSafe(projectId);
  const prefix = `local/${BUCKET}/projects/${projectId}/files/DCIM/`;
  const cmd = `docker exec qfieldcloud-minio-1 mc ls --recursive '${prefix}' 2>&1`;
  try {
    const { stdout } = await execAsync(cmd, { maxBuffer: 64 * 1024 * 1024 });
    const keys = new Set<string>();
    for (const line of stdout.split('\n')) {
      // mc ls line: "[date] size STANDARD <relpath>/<version>"; relpath is DCIM/<file>/<version>
      const rel = line.trim().split(/\s+/).slice(4).join(' ');
      if (!rel) continue;
      const withoutVersion = rel.replace(/\/v\d{14}-[a-f0-9]+$/i, '');
      if (withoutVersion.startsWith('DCIM/')) keys.add(withoutVersion);
    }
    return keys;
  } catch (err) {
    const msg = (err as { stderr?: string; message?: string }).stderr
      || (err as Error).message || '';
    if (/Cannot connect to the Docker daemon|No such container|command not found|permission denied/.test(msg)) {
      throw new MinioUnavailableError('MinIO not reachable (off-velo)');
    }
    log.error('qfc-minio', { message: msg.slice(0, 200) }, 'listDcimKeys failed');
    throw err;
  }
}

/** Fetch one object's bytes (used by the resolver to pull GPKGs). */
export async function catObject(objectPath: string): Promise<Buffer> {
  assertSafe(objectPath);
  const p = objectPath.startsWith('/') ? objectPath.slice(1) : objectPath;
  const cmd = `docker exec qfieldcloud-minio-1 mc cat 'local/${BUCKET}/${p}' 2>&1`;
  const { stdout } = await execAsync(cmd, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  return stdout as Buffer;
}
```

- [ ] **Step 2: Live smoke check (velo)**

```bash
cd /home/hein/Workspace/FF_Next.js-qfield-recon
npx tsx -e "import('./src/lib/qfieldcloud/minio').then(async m=>{const k=await m.listDcimKeys('bec5f353-2e83-4f6b-989a-fca83ad94e16');console.log('DCIM keys',k.size);console.log('has D753 photo', k.has('DCIM/civil-audit_20260708104624360.jpg'));process.exit(0);})"
```
Expected: `DCIM keys` in the thousands; `has D753 photo true`.

- [ ] **Step 3: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-qfield-recon && git add src/lib/qfieldcloud/minio.ts && git commit -m "feat(qfield-recon): MinIO mc wrapper (DCIM key listing + object fetch)"
```

---

## Task 4: Python resolver + cache migration + ponMapService

**Files:**
- Create: `.claude/credentials.local.md` entry (gitignored — step 0)
- Create: `scripts/qfield-recon/resolve_pon_poles.py`
- Create: `scripts/migrations/sql/460_qfield_pole_pon_cache.sql`
- Create: `scripts/migrations/sql/rollback_460_qfield_pole_pon_cache.sql`
- Create: `src/modules/qfield-recon/services/ponMapService.ts`

**Interfaces:**
- Consumes: `PonMap` type; `getDesignGpkgVersion` from Task 2.
- Produces: `getPonMap(projectId): Promise<PonMap>`.

- [ ] **Step 0: Record the credential (gitignored file, not the plan)**

Append to `.claude/credentials.local.md` (never committed):
```
## QFieldCloud DB (read-only reconciliation report)
QFIELDCLOUD_DATABASE_URL=postgresql://qfieldcloud_db_admin:<POSTGRES_PASSWORD>@localhost:5433/qfieldcloud_db
# <POSTGRES_PASSWORD> from /opt/qfieldcloud/docker-compose.override.yml
```
Also add `QFIELDCLOUD_DATABASE_URL` to the fibreflow-dev and fibreflow-production systemd env files on velo (deploy step, not in-repo).

- [ ] **Step 1: Write the resolver**

Create `scripts/qfield-recon/resolve_pon_poles.py`:

```python
#!/usr/bin/env python3
"""Resolve pole->PON for a QFieldCloud project from its design GeoPackages.

Reads MOAPons (PON polygons, field 'dp') and MOAPoles (pole points, 'label')
from MinIO via `mc cat`, spatially joins poles within PON polygons, and emits:
  {"available": true, "designPons": [..], "poleToPon": {"MOA.P.X": {"pon": N, "zone": "Z"}}}
Read-only. Never writes to MinIO or the DB. On any missing layer -> available:false.
"""
import json, subprocess, sys, tempfile, os, warnings
warnings.filterwarnings("ignore")

BUCKET = os.environ.get("MINIO_BUCKET", "qfieldcloud-prod")

def mc_cat(object_path: str, dest: str) -> bool:
    r = subprocess.run(
        ["docker", "exec", "qfieldcloud-minio-1", "mc", "cat", f"local/{BUCKET}/{object_path}"],
        capture_output=True)
    if r.returncode != 0 or not r.stdout:
        return False
    with open(dest, "wb") as f:
        f.write(r.stdout)
    return True

def latest_version(project_id: str, filename: str) -> str | None:
    # List versions under the file prefix; pick the lexically-last (timestamped) key.
    prefix = f"local/{BUCKET}/projects/{project_id}/files/{filename}/"
    r = subprocess.run(["docker", "exec", "qfieldcloud-minio-1", "mc", "ls", "--recursive", prefix],
                       capture_output=True, text=True)
    versions = [ln.strip().split()[-1] for ln in r.stdout.splitlines() if ln.strip()]
    return sorted(versions)[-1] if versions else None

def main() -> int:
    project_id = sys.argv[sys.argv.index("--project-id") + 1]
    import geopandas as gpd
    with tempfile.TemporaryDirectory() as tmp:
        out = {"available": False, "designPons": [], "poleToPon": {}}
        pons_v = latest_version(project_id, "MOAPons.gpkg")
        poles_v = latest_version(project_id, "MOAPoles.gpkg")
        if not pons_v or not poles_v:
            print(json.dumps(out)); return 0
        pons_p, poles_p = f"{tmp}/pons.gpkg", f"{tmp}/poles.gpkg"
        base = f"projects/{project_id}/files"
        if not mc_cat(f"{base}/MOAPons.gpkg/{pons_v}", pons_p): print(json.dumps(out)); return 0
        if not mc_cat(f"{base}/MOAPoles.gpkg/{poles_v}", poles_p): print(json.dumps(out)); return 0
        pons = gpd.read_file(pons_p)
        poles = gpd.read_file(poles_p).to_crs(pons.crs)
        design_pons = sorted({int(v) for v in pons["dp"].dropna() if str(v).strip().isdigit()})
        joined = gpd.sjoin(poles, pons[["dp", "geometry"]], predicate="within", how="inner")
        pole_to_pon = {}
        for _, row in joined.iterrows():
            label = row.get("label")
            dp = row.get("dp")
            if not label or dp is None or not str(dp).strip().isdigit():
                continue
            zone = row.get("zone")
            pole_to_pon[str(label)] = {"pon": int(dp), "zone": None if zone is None else str(zone)}
        print(json.dumps({"available": True, "designPons": design_pons, "poleToPon": pole_to_pon}))
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Verify the resolver against live data (velo)**

Run: `cd /home/hein/Workspace/FF_Next.js-qfield-recon && python3 scripts/qfield-recon/resolve_pon_poles.py --project-id bec5f353-2e83-4f6b-989a-fca83ad94e16 | python3 -c "import json,sys; d=json.load(sys.stdin); print('available',d['available']); print('pons',len(d['designPons']),'has164',164 in d['designPons']); pon164=[l for l,v in d['poleToPon'].items() if v['pon']==164]; print('pon164 poles',len(pon164))"`
Expected: `available True`; `has164 True`; `pon164 poles 23`.

- [ ] **Step 3: Write the migration + rollback**

Create `scripts/migrations/sql/460_qfield_pole_pon_cache.sql` (re-check the number is still MAX+1 first):

```sql
-- Migration: 460_qfield_pole_pon_cache.sql
-- Description: Cache of resolved pole->PON design maps for the QField audit
--              reconciliation report. One row per (project, design-GPKG version);
--              payload is the resolver output. Read cache only — never a source of truth.
-- Created: 2026-07-24

BEGIN;

CREATE TABLE IF NOT EXISTS qfield_pole_pon_cache (
  project_id   UUID        NOT NULL,
  gpkg_version TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  resolved_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, gpkg_version)
);

COMMIT;
```

Create `scripts/migrations/sql/rollback_460_qfield_pole_pon_cache.sql`:

```sql
-- Rollback: 460_qfield_pole_pon_cache.sql
BEGIN;
DROP TABLE IF EXISTS qfield_pole_pon_cache;
COMMIT;
```

- [ ] **Step 4: Apply the migration (FF DB)**

Run: `cd /home/hein/Workspace/FF_Next.js-qfield-recon && bash scripts/run-pending-migrations.sh 2>&1 | tail -5`
Expected: `460_qfield_pole_pon_cache` applied (or "up to date" on re-run).

- [ ] **Step 5: Write ponMapService**

Create `src/modules/qfield-recon/services/ponMapService.ts`:

```ts
import { exec } from 'child_process';
import { promisify } from 'util';
import { query, queryOne } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { getDesignGpkgVersion } from './qfcDeltaRepo';
import type { PonMap } from '../types';

const execAsync = promisify(exec);
const RESOLVER = 'scripts/qfield-recon/resolve_pon_poles.py';
const UNAVAILABLE: PonMap = { available: false, gpkgVersion: null, resolvedAt: null, designPons: [], poleToPon: {} };

interface ResolverOut { available: boolean; designPons: number[]; poleToPon: PonMap['poleToPon']; }

async function runResolver(projectId: string): Promise<ResolverOut> {
  const { stdout } = await execAsync(
    `python3 ${RESOLVER} --project-id '${projectId}'`,
    { maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  return JSON.parse(stdout) as ResolverOut;
}

export async function getPonMap(projectId: string): Promise<PonMap> {
  const version = await getDesignGpkgVersion(projectId);
  if (!version) return UNAVAILABLE;

  const cached = await queryOne<{ payload: ResolverOut; resolved_at: string }>(
    `SELECT payload, to_char(resolved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS resolved_at
       FROM qfield_pole_pon_cache WHERE project_id = $1 AND gpkg_version = $2`,
    [projectId, version]);
  if (cached) {
    return { available: true, gpkgVersion: version, resolvedAt: cached.resolved_at,
             designPons: cached.payload.designPons, poleToPon: cached.payload.poleToPon };
  }

  let resolved: ResolverOut;
  try {
    resolved = await runResolver(projectId);
  } catch (err) {
    log.error('qfc-ponmap', { message: err instanceof Error ? err.message : String(err) }, 'resolver failed');
    return UNAVAILABLE;
  }
  if (!resolved.available) return UNAVAILABLE;

  await query(
    `INSERT INTO qfield_pole_pon_cache (project_id, gpkg_version, payload)
       VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (project_id, gpkg_version)
       DO UPDATE SET payload = EXCLUDED.payload, resolved_at = now()`,
    [projectId, version, JSON.stringify({ designPons: resolved.designPons, poleToPon: resolved.poleToPon })]);

  return { available: true, gpkgVersion: version, resolvedAt: new Date().toISOString(),
           designPons: resolved.designPons, poleToPon: resolved.poleToPon };
}
```

- [ ] **Step 6: Live smoke check (velo — resolves + caches)**

```bash
cd /home/hein/Workspace/FF_Next.js-qfield-recon
export QFIELDCLOUD_DATABASE_URL='postgresql://qfieldcloud_db_admin:<pw>@localhost:5433/qfieldcloud_db'
npx tsx -e "import('./src/modules/qfield-recon/services/ponMapService').then(async m=>{const p=await m.getPonMap('bec5f353-2e83-4f6b-989a-fca83ad94e16');console.log('available',p.available,'pons',p.designPons.length,'poles',Object.keys(p.poleToPon).length);process.exit(0);})"
```
Expected: `available true`, `pons` ~236, `poles` in the hundreds. Second run returns from cache (fast).

- [ ] **Step 7: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-qfield-recon && git add scripts/qfield-recon scripts/migrations/sql/460_qfield_pole_pon_cache.sql scripts/migrations/sql/rollback_460_qfield_pole_pon_cache.sql src/modules/qfield-recon/services/ponMapService.ts && git commit -m "feat(qfield-recon): pole->PON resolver, cache table, ponMapService"
```

---

## Task 5: API routes

**Files:**
- Create: `pages/api/qfield/reconciliation-projects.ts`
- Create: `pages/api/qfield/reconciliation.ts`

**Interfaces:**
- Consumes: `getProjects`, `getAuditDeltas` (Task 2), `listDcimKeys`/`MinioUnavailableError` (Task 3), `getPonMap` (Task 4), `buildReconciliation` (Task 1).
- Produces: `GET /api/qfield/reconciliation-projects`, `GET /api/qfield/reconciliation?projectId=…`.

- [ ] **Step 1: Projects route**

Create `pages/api/qfield/reconciliation-projects.ts`:

```ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { getProjects } from '@/modules/qfield-recon/services/qfcDeltaRepo';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  try {
    return apiResponse.success(res, { projects: await getProjects() });
  } catch (error) {
    log.error('qfield-recon-projects', error instanceof Error ? { message: error.message } : { error });
    return apiResponse.databaseError(res, error);
  }
}
export default withAuth(handler);
```

- [ ] **Step 2: Reconciliation route**

Create `pages/api/qfield/reconciliation.ts`:

```ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { getAuditDeltas, getProjects } from '@/modules/qfield-recon/services/qfcDeltaRepo';
import { getPonMap } from '@/modules/qfield-recon/services/ponMapService';
import { listDcimKeys, MinioUnavailableError } from '@/lib/qfieldcloud/minio';
import { buildReconciliation } from '@/modules/qfield-recon/services/reconciliationService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  const { projectId } = req.query;
  if (!projectId || typeof projectId !== 'string' || !/^[0-9a-f-]{36}$/i.test(projectId)) {
    return apiResponse.badRequest(res, 'Valid projectId (uuid) required');
  }
  try {
    const projects = await getProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) return apiResponse.notFound(res, 'Project', projectId);

    const [deltas, ponMap, presentPhotoKeys] = await Promise.all([
      getAuditDeltas(projectId),
      getPonMap(projectId),
      listDcimKeys(projectId),
    ]);

    const notes: string[] = [];
    if (!ponMap.available) notes.push('No design layer (MOAPons/MOAPoles) found — civil is per-zone only; optical never-captured uses observed-sequence gaps.');

    const model = buildReconciliation({
      project: { id: project.id, name: project.name },
      deltas, ponMap, presentPhotoKeys, notes,
    });
    return apiResponse.success(res, model);
  } catch (error) {
    if (error instanceof MinioUnavailableError) {
      return res.status(503).json({ success: false, error: 'Reconciliation report only runs on the velo server (MinIO unavailable).' });
    }
    log.error('qfield-recon', error instanceof Error ? { message: error.message } : { error });
    return apiResponse.databaseError(res, error);
  }
}
export default withAuth(handler);
```

- [ ] **Step 3: Live smoke check (velo dev server)**

Start dev with the env set, then curl with an auth cookie (or run against the deployed dev). Minimal check via tsx that exercises the handler pieces is already covered in Tasks 2-4; here confirm the assembled model:

```bash
cd /home/hein/Workspace/FF_Next.js-qfield-recon
export QFIELDCLOUD_DATABASE_URL='postgresql://qfieldcloud_db_admin:<pw>@localhost:5433/qfieldcloud_db'
npx tsx -e "
import('./src/modules/qfield-recon/services/qfcDeltaRepo').then(async repo=>{
  const {getPonMap}=await import('./src/modules/qfield-recon/services/ponMapService');
  const {listDcimKeys}=await import('./src/lib/qfieldcloud/minio');
  const {buildReconciliation}=await import('./src/modules/qfield-recon/services/reconciliationService');
  const pid='bec5f353-2e83-4f6b-989a-fca83ad94e16';
  const [d,pm,keys]=await Promise.all([repo.getAuditDeltas(pid),getPonMap(pid),listDcimKeys(pid)]);
  const m=buildReconciliation({project:{id:pid,name:'FT_Mohadin'},deltas:d,ponMap:pm,presentPhotoKeys:keys});
  const o164=m.optical.find(p=>p.ponNo===164); const c164=m.civil.find(p=>p.ponNo===164); const o161=m.optical.find(p=>p.ponNo===161);
  console.log('optical 164 neverCaptured',o164?.neverCaptured);
  console.log('civil 164 applied/never',c164?.applied,c164?.neverCaptured,'design',c164?.designFeatures);
  console.log('optical 161 applied/stale',o161?.applied,o161?.staleDuplicate);
  console.log('totals',JSON.stringify(m.totals));
  process.exit(0);
});"
```
Expected: `optical 164 neverCaptured 1`; `civil 164 applied/never 5 18 design 23`; `optical 161 applied/stale 14 14`.

- [ ] **Step 4: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-qfield-recon && git add pages/api/qfield/reconciliation.ts pages/api/qfield/reconciliation-projects.ts && git commit -m "feat(qfield-recon): reconciliation API routes"
```

---

## Task 6: UI page + components

**Files:**
- Create: `src/modules/qfield-recon/hooks/useReconciliation.ts`
- Create: `src/modules/qfield-recon/components/ReconDashboard.tsx`
- Create: `src/modules/qfield-recon/components/BreakdownCards.tsx`
- Create: `src/modules/qfield-recon/components/PonCompletenessTable.tsx`
- Create: `src/modules/qfield-recon/components/StuckDeltaTable.tsx`
- Create: `src/modules/qfield-recon/components/PhotoIntegrityList.tsx`
- Create: `app/(main)/qfield/reconciliation/page.tsx`

**Interfaces:**
- Consumes: `ReconModel`, `PonSummary`, `StuckDelta`, `PhotoFlag` types; the two API routes.
- Produces: the `/qfield/reconciliation` page.

- [ ] **Step 1: Data hook**

Create `src/modules/qfield-recon/hooks/useReconciliation.ts`:

```ts
'use client';
import { useEffect, useState } from 'react';
import type { ReconModel } from '../types';

export interface ProjectOption { id: string; name: string; dataLastUpdatedAt: string | null; }

export function useProjects() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/qfield/reconciliation-projects')
      .then(r => r.json())
      .then(j => setProjects(j.data?.projects ?? j.projects ?? []))
      .catch(e => setError(String(e)));
  }, []);
  return { projects, error };
}

export function useReconciliation(projectId: string | null) {
  const [model, setModel] = useState<ReconModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!projectId) return;
    setLoading(true); setError(null); setModel(null);
    fetch(`/api/qfield/reconciliation?projectId=${encodeURIComponent(projectId)}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; })
      .then(j => setModel((j.data ?? j) as ReconModel))
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [projectId]);
  return { model, loading, error };
}
```

- [ ] **Step 2: Presentational components**

Create `src/modules/qfield-recon/components/BreakdownCards.tsx` (three-way totals):

```tsx
import type { ReconModel } from '../types';

const CARDS: Array<{ key: keyof ReconModel['totals']; label: string; tone: string }> = [
  { key: 'applied', label: 'Applied ✓', tone: 'text-green-600' },
  { key: 'stuckRecoverable', label: 'Stuck (recoverable)', tone: 'text-amber-600' },
  { key: 'neverCaptured', label: 'Never captured', tone: 'text-red-600' },
  { key: 'staleDuplicate', label: 'Stale duplicates (recovered)', tone: 'text-gray-500' },
];

export function BreakdownCards({ totals }: { totals: ReconModel['totals'] }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {CARDS.map(c => (
        <div key={c.key} className="rounded-lg border p-4">
          <div className={`text-3xl font-bold ${c.tone}`}>{totals[c.key]}</div>
          <div className="text-sm text-gray-600">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
```

Create `src/modules/qfield-recon/components/PonCompletenessTable.tsx`:

```tsx
import type { PonSummary } from '../types';

export function PonCompletenessTable({ title, rows }: { title: string; rows: PonSummary[] }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 font-semibold">{title}</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-gray-500">
            <th className="py-1 pr-4">PON</th><th className="pr-4">Design</th><th className="pr-4">Applied</th>
            <th className="pr-4">Stuck</th><th className="pr-4">Stale</th><th className="pr-4">Never captured</th><th>Missing photos</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.kind}-${r.ponNo ?? 'na'}`} className={r.neverCaptured > 0 ? 'bg-red-50' : ''}>
                <td className="py-1 pr-4 font-medium">{r.ponNo ?? '—'}</td>
                <td className="pr-4">{r.designFeatures || '—'}</td>
                <td className="pr-4 text-green-700">{r.applied}</td>
                <td className="pr-4 text-amber-700">{r.stuckRecoverable}</td>
                <td className="pr-4 text-gray-500">{r.staleDuplicate}</td>
                <td className="pr-4 text-red-700">{r.neverCaptured}</td>
                <td>{r.missingPhotos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

Create `src/modules/qfield-recon/components/StuckDeltaTable.tsx`:

```tsx
import type { StuckDelta } from '../types';

export function StuckDeltaTable({ rows }: { rows: StuckDelta[] }) {
  if (rows.length === 0) return <p className="mt-6 text-sm text-gray-500">No stuck deltas.</p>;
  return (
    <section className="mt-6">
      <h3 className="mb-2 font-semibold">Stuck deltas ({rows.length})</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-gray-500">
            <th className="py-1 pr-4">Feature</th><th className="pr-4">Kind</th><th className="pr-4">Status</th>
            <th className="pr-4">Last status</th><th className="pr-4">Created (UTC)</th><th>Verdict</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.deltaId}>
                <td className="py-1 pr-4 font-mono text-xs">{r.label ?? r.featureKey}</td>
                <td className="pr-4">{r.kind}</td>
                <td className="pr-4">{r.status}</td>
                <td className="pr-4">{r.lastStatus}</td>
                <td className="pr-4">{r.createdAt.replace('T', ' ').replace('Z', '')}</td>
                <td>{r.supersededByAppliedTwin
                  ? <span className="text-gray-500">stale duplicate (recovered)</span>
                  : <span className="font-medium text-amber-700">genuinely stuck</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

Create `src/modules/qfield-recon/components/PhotoIntegrityList.tsx`:

```tsx
import type { PhotoFlag } from '../types';

export function PhotoIntegrityList({ flags }: { flags: PhotoFlag[] }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 font-semibold">Photo integrity</h3>
      {flags.length === 0
        ? <p className="text-sm text-green-700">All referenced photos present in storage ✓</p>
        : (
          <ul className="text-sm text-red-700">
            {flags.map(f => (
              <li key={`${f.deltaId}-${f.photoKey}`} className="font-mono text-xs">
                {(f.label ?? f.featureKey)} → {f.photoKey} <span className="text-red-500">MISSING</span>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
```

Create `src/modules/qfield-recon/components/ReconDashboard.tsx` (composes the above; < 200 lines):

```tsx
'use client';
import type { ReconModel } from '../types';
import { BreakdownCards } from './BreakdownCards';
import { PonCompletenessTable } from './PonCompletenessTable';
import { StuckDeltaTable } from './StuckDeltaTable';
import { PhotoIntegrityList } from './PhotoIntegrityList';

export function ReconDashboard({ model }: { model: ReconModel }) {
  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-600">
        Design layer: {model.designLayer.available
          ? `resolved (${model.designLayer.gpkgVersion}) at ${model.designLayer.resolvedAt}`
          : 'unavailable — see notes'}
      </div>
      {model.notes.map((n, i) => <p key={i} className="rounded bg-amber-50 p-2 text-sm text-amber-800">{n}</p>)}
      <BreakdownCards totals={model.totals} />
      <PonCompletenessTable title="Optical (per PON — splitter pon_no)" rows={model.optical} />
      <PonCompletenessTable title="Civil (per PON — poles resolved via design layer)" rows={model.civil} />
      <StuckDeltaTable rows={model.stuckDeltas} />
      <PhotoIntegrityList flags={model.photoFlags} />
    </div>
  );
}
```

- [ ] **Step 3: The page**

Create `app/(main)/qfield/reconciliation/page.tsx` (mirror the client-page style of `app/(main)/qfield/qa/page.tsx`):

```tsx
'use client';
import { useState } from 'react';
import { useProjects, useReconciliation } from '@/modules/qfield-recon/hooks/useReconciliation';
import { ReconDashboard } from '@/modules/qfield-recon/components/ReconDashboard';

export default function ReconciliationPage() {
  const { projects } = useProjects();
  const [projectId, setProjectId] = useState<string | null>(null);
  const { model, loading, error } = useReconciliation(projectId);

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-bold">QField Audit Reconciliation</h1>
      <select
        className="mb-6 rounded border p-2"
        value={projectId ?? ''}
        onChange={e => setProjectId(e.target.value || null)}
      >
        <option value="">Select a project…</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      {loading && <p>Loading reconciliation…</p>}
      {error && <p className="text-red-600">Error: {error}</p>}
      {model && <ReconDashboard model={model} />}
    </div>
  );
}
```

- [ ] **Step 4: Verify build + lint**

Run: `cd /home/hein/Workspace/FF_Next.js-qfield-recon && npm run ci:quick 2>&1 | tail -20`
Expected: lint gates pass (no new errors). Fix any type/lint issues before committing.

- [ ] **Step 5: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-qfield-recon && git add src/modules/qfield-recon/hooks src/modules/qfield-recon/components app/\(main\)/qfield/reconciliation && git commit -m "feat(qfield-recon): reconciliation dashboard page + components"
```

---

## Task 7: End-to-end verification + docs

**Files:**
- Create: `src/modules/qfield-recon/.claude.md` (module quick-ref, ≤ 50 lines)
- Modify: `.claude/modules/qfield-sync.md` (add a "Reconciliation report" pointer)

- [ ] **Step 1: Browser E2E against dev**

Deploy to dev (`bash scripts/deploy-local.sh dev`) with `QFIELDCLOUD_DATABASE_URL` in the dev env, then load `https://dev.fibreflow.app/qfield/reconciliation`, select `FT_Mohadin`, and confirm on-screen:
- Optical PON 164 row highlighted, `Never captured = 1`.
- Civil PON 164: `Applied 5`, `Never captured 18`, `Design 23`.
- Optical PON 161: `Applied 14`, `Stale 14`; the 14 error rows in the stuck table show "stale duplicate (recovered)".
- Photo integrity: the 5 PON-164 civil photos present (no MISSING for them).

Capture a screenshot via Claude-in-Chrome/Playwright as evidence.

- [ ] **Step 2: Module docs**

Create `src/modules/qfield-recon/.claude.md`:

```markdown
# qfield-recon (Audit Reconciliation Report)

Read-only report reconciling QFieldCloud audit data per project/PON:
applied ✓ / stuck (recoverable) / never-captured, + stale-duplicate + photo-integrity.

- Page: `/qfield/reconciliation` (App Router)
- API: `GET /api/qfield/reconciliation?projectId=…`, `/api/qfield/reconciliation-projects`
- Reads: QFieldCloud PG 5433 (read-only `qfcPool`), MinIO via `mc` (`src/lib/qfieldcloud/minio.ts`)
- Pole→PON: design GPKG (`MOAPons`/`MOAPoles`) via `scripts/qfield-recon/resolve_pon_poles.py`,
  cached in `qfield_pole_pon_cache` (mig 460). Feature identity = `content->>'localPk'`.
- Pure logic + tests: `services/reconciliationService.ts` (the incident fixtures).
- **Velo-only** (docker/mc/geopandas). Off-velo → 503. Needs `QFIELDCLOUD_DATABASE_URL` env.
```

Add to `.claude/modules/qfield-sync.md` under a new heading: a one-paragraph pointer to the report and its velo-only constraint.

- [ ] **Step 3: Final CI + commit**

Run: `cd /home/hein/Workspace/FF_Next.js-qfield-recon && npm run ci:quick 2>&1 | tail -15`
Expected: pass.

```bash
cd /home/hein/Workspace/FF_Next.js-qfield-recon && git add src/modules/qfield-recon/.claude.md .claude/modules/qfield-sync.md && git commit -m "docs(qfield-recon): module quick-ref + qfield-sync pointer"
```

- [ ] **Step 4: PR**

```bash
cd /home/hein/Workspace/FF_Next.js-qfield-recon && git push -u origin feat/qfield-audit-reconciliation
gh pr create --title "feat(qfield-recon): QField audit reconciliation report" --body "Read-only per-project/PON reconciliation of QFieldCloud audit data (applied / stuck / never-captured) with stale-duplicate detection, design-layer pole→PON join, and MinIO photo-integrity checks. Verified against the FT_Mohadin PON-161/164 incident. Migration 460 (additive cache table). Velo-only (docker/mc/geopandas); needs QFIELDCLOUD_DATABASE_URL. See docs/superpowers/specs/2026-07-24-qfield-audit-reconciliation-design.md."
```
Then follow the standing review-and-merge rule (`/review` blind reviewer + CI on the self-hosted runner). **Do not deploy to production during business hours; production deploy needs Hein's approval and the env var set on prod.**

---

## Self-Review (against the spec)

**Spec coverage:**
- §1 three-way breakdown → `ReconModel.totals` + `BreakdownCards` (Task 1/6). ✓
- §2.2 PON-161 stale-duplicate → Task 1 test + `supersededByAppliedTwin`. ✓
- §2.3 PON-164 never-captured → Task 1 test (design + sequence-gap fallback). ✓
- §2.4 civil-per-PON via design join → resolver + `poleToPon` + Task 1 civil test. ✓
- §3 photo integrity → `listDcimKeys` + `photoFlags` (Task 3/1). ✓
- §3.5 credentials → Task 4 step 0 (gitignored env). ✓
- §4 API contract → Task 5. ✓
- §5 UI → Task 6. ✓
- §6 tests-as-acceptance → Task 1. ✓
- §7 non-goals (sync-photos cron) → surfaced as a `notes`/docs mention, not fixed. ✓

**Placeholder scan:** the only `<pw>`/`<POSTGRES_PASSWORD>` tokens are deliberate secret placeholders (must never be literal in-repo); the migration number is fixed to 460 with a re-verify instruction. No TODO/TBD.

**Type consistency:** `buildReconciliation(BuildInput)`, `PonMap`, `AuditDelta`, `PonSummary`, `StuckDelta`, `PhotoFlag`, `ReconModel` names are identical across Tasks 1/5/6. Repo returns `AuditDelta[]` matching Task-1 shape. `poleToPon`/`designPons` identical in resolver JSON, cache payload, and `PonMap`. ✓
