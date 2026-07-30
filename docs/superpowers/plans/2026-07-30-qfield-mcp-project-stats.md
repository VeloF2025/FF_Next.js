# QField MCP Project Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one curated, read-only FibreFlow MCP tool that resolves a project and returns trustworthy QField pole, cable, drop, QA, sync, anomaly, and freshness statistics.

**Architecture:** A new authenticated Pages API route owns all QField business semantics and aggregates the existing FibreFlow PostgreSQL, QFieldCloud `core_delta`, and optional MinIO sources. A thin Python MCP tool forwards the signed-in user's read-only token to that fixed endpoint and returns its stable JSON response.

**Tech Stack:** Next.js Pages API, TypeScript, `pg` through `@/lib/db-pool` and `@/lib/qfieldcloud/qfcPool`, Vitest, FastMCP/Python, pytest, MinIO metadata through the existing QField reconciliation helper.

## Global Constraints

- The feature is read-only. It must not mutate FibreFlow, QFieldCloud, MinIO, sync jobs, or OAuth state.
- No database migration is permitted.
- A planted pole is physically in the ground. Photo completeness and QA are separate quality states.
- Planting events are `Pole Planted/ All Photos`, `Pole Planted - Photos Incomplete`, and `Pole Verified/ Civil Complete`.
- Removal events are `Pole Removed/Canceled` and `Pole Canceled / Removed`.
- QA, photo, WIP, and other non-physical statuses preserve the latest physical state.
- Feature identity is `(kind, localPk)`, never `localPk` by itself.
- QField state comes from `core_delta` through the established read-only QField pool. Do not reuse the broken legacy `core_layer` or `core_feature` readers.
- A source failure is `null` plus explicit health metadata; it must never appear as a genuine zero.
- Freshness uses `Africa/Johannesburg`, becomes stale after 24 weekday hours, excludes weekend hours, and suppresses stale warnings on Saturday and Sunday.
- Summary is the default. Drill-down is limited to `poles`, `cables`, `drops`, `qa`, `sync`, or `anomalies`, with bounded pagination and no raw-record export.
- Current sync tables are system-scoped because they have no project ID. Return `scope: "system"` and never describe those figures as project-specific.
- Preserve `withAuth`, project-view RBAC, MCP session read-only enforcement, the 40-call hourly MCP limit, and the 15,000-character MCP response guard.
- Use `log` from `@/lib/logger`; no `console.log`, empty catch blocks, or fake tests.
- Keep TypeScript files below 300 lines and functions/components focused.
- Use npm commands; never regenerate `bun.lock`.
- All work remains in the isolated worktree and ships through a pull request.
- Production deploy requires Hein's explicit approval, must be after hours, and must use `bash scripts/deploy-local.sh production`.

---

## File Map

### New TypeScript files

- `src/modules/qfield-sync/project-stats/types.ts` — stable request, response, source-health, and internal aggregate contracts.
- `src/modules/qfield-sync/project-stats/errors.ts` — typed domain errors with `ErrorCode` and safe details.
- `src/modules/qfield-sync/project-stats/request.ts` — query parsing, section validation, and pagination caps.
- `src/modules/qfield-sync/project-stats/freshness.ts` — SAST weekday-age calculation and weekend warning policy.
- `src/modules/qfield-sync/project-stats/projectResolverRepo.ts` — parameterized FibreFlow/QField link lookup.
- `src/modules/qfield-sync/project-stats/projectResolver.ts` — deterministic match selection and ambiguity handling.
- `src/modules/qfield-sync/project-stats/qfieldDeltaRepo.ts` — read-only `core_delta` and project-freshness projection.
- `src/modules/qfield-sync/project-stats/featureState.ts` — pure physical-state, cable, drop, anomaly, and photo-reference reducers.
- `src/modules/qfield-sync/project-stats/fibreflowInfrastructureRepo.ts` — uncapped, field-limited FibreFlow comparison records and aggregates.
- `src/modules/qfield-sync/project-stats/qfieldQaRepo.ts` — project-scoped QA workflow aggregates.
- `src/modules/qfield-sync/project-stats/qfieldSyncStatsRepo.ts` — explicitly system-scoped sync aggregates.
- `src/modules/qfield-sync/project-stats/qfieldDesignRepo.ts` — read-only access to the existing verified design cache.
- `src/modules/qfield-sync/project-stats/projectStatsService.ts` — source orchestration, timeouts, partial-result semantics, and section shaping.
- `src/modules/qfield-sync/project-stats/index.ts` — public exports.
- `pages/api/qfield/project-stats.ts` — GET-only authenticated API surface.
- `apps/ff_mcp/qfield_tools.py` — curated FastMCP adapter.

### New tests

- `src/modules/qfield-sync/project-stats/__tests__/request.test.ts`
- `src/modules/qfield-sync/project-stats/__tests__/freshness.test.ts`
- `src/modules/qfield-sync/project-stats/__tests__/projectResolver.test.ts`
- `src/modules/qfield-sync/project-stats/__tests__/projectResolverRepo.test.ts`
- `src/modules/qfield-sync/project-stats/__tests__/qfieldDeltaRepo.test.ts`
- `src/modules/qfield-sync/project-stats/__tests__/featureState.test.ts`
- `src/modules/qfield-sync/project-stats/__tests__/fibreflowInfrastructureRepo.test.ts`
- `src/modules/qfield-sync/project-stats/__tests__/qfieldQaRepo.test.ts`
- `src/modules/qfield-sync/project-stats/__tests__/qfieldSyncStatsRepo.test.ts`
- `src/modules/qfield-sync/project-stats/__tests__/qfieldDesignRepo.test.ts`
- `src/modules/qfield-sync/project-stats/__tests__/projectStatsService.test.ts`
- `tests/api/qfield/project-stats.test.ts`
- `apps/ff_mcp/test_qfield_tools.py`
- `apps/ff_mcp/test_qfield_tools_live.py`

### Existing files modified

- `apps/ff_mcp/server.py:194-196` — import the curated QField tool module for registration.
- `apps/ff_mcp/conftest.py:25-30` — evict and import the new module cleanly per test.
- `apps/ff_mcp/test_catalogue.py` — require the new GET route in the generated catalogue.
- `apps/ff_mcp/endpoints.json` — regenerate from source.
- `src/modules/qfield-sync/.claude.md:7-29` — add the canonical quick-reference endpoint and source rules.
- `src/modules/qfield-sync/AGENTS.md` — regenerate from `.claude.md`.
- `.claude/modules/qfield-sync.md:21-49` — document the aggregate source and endpoint.

---

### Task 1: Contracts, typed errors, and request validation

**Files:**

- Create: `src/modules/qfield-sync/project-stats/types.ts`
- Create: `src/modules/qfield-sync/project-stats/errors.ts`
- Create: `src/modules/qfield-sync/project-stats/request.ts`
- Test: `src/modules/qfield-sync/project-stats/__tests__/request.test.ts`

**Interfaces:**

- Produces: `ProjectStatsSection`, `ProjectStatsQuery`, `ResolvedProject`,
  `ProjectStatsProject`, `Freshness`, `SourceHealth`, `ProjectStatsResponse`,
  and section aggregate types.
- Produces: `ProjectStatsError(code: ErrorCode, message: string, details?: unknown)`.
- Produces: `parseProjectStatsQuery(query: ParsedUrlQuery): ProjectStatsQuery`.
- Consumes: no feature-local interfaces.

- [ ] **Step 1: Write failing query-parser tests**

```typescript
import { describe, expect, it } from 'vitest';
import { parseProjectStatsQuery } from '../request';
import { ProjectStatsError } from '../errors';

describe('parseProjectStatsQuery', () => {
  it('defaults to a bounded summary request', () => {
    expect(parseProjectStatsQuery({ project: 'Mahikeng' })).toEqual({
      project: 'Mahikeng',
      section: 'summary',
      page: 1,
      limit: 50,
    });
  });

  it.each([
    [{}, 'project is required'],
    [{ project: 'Mahikeng', section: 'raw' }, 'section must be one of'],
    [{ project: 'Mahikeng', page: '0' }, 'page must be a positive integer'],
    [{ project: 'Mahikeng', limit: '101' }, 'limit must be between 1 and 100'],
    [{ project: 'x'.repeat(201) }, 'project must be 200 characters or fewer'],
  ])('rejects invalid query %#', (query, message) => {
    expect(() => parseProjectStatsQuery(query)).toThrowError(ProjectStatsError);
    expect(() => parseProjectStatsQuery(query)).toThrow(message);
  });
});
```

- [ ] **Step 2: Run the parser test and verify RED**

Run:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/request.test.ts
```

Expected: FAIL because `request.ts`, `errors.ts`, and `types.ts` do not exist.

- [ ] **Step 3: Add the stable contracts**

Create the following core definitions in `types.ts`; keep response fields explicit rather than using `Record<string, unknown>` for the public contract:

```typescript
export const PROJECT_STATS_SECTIONS = [
  'summary',
  'poles',
  'cables',
  'drops',
  'qa',
  'sync',
  'anomalies',
] as const;

export type ProjectStatsSection = (typeof PROJECT_STATS_SECTIONS)[number];
export type ProjectStatsStatus = 'complete' | 'partial' | 'unavailable';
export type FreshnessState = 'fresh' | 'stale' | 'unknown';
export type SourceState = 'ok' | 'unavailable' | 'timeout';

export interface ProjectStatsQuery {
  project: string;
  section: ProjectStatsSection;
  page: number;
  limit: number;
}

export interface ResolvedProject {
  fibreflow: { id: string; code: string; name: string };
  qfield: {
    registrationId: string;
    projectId: string;
    name: string;
    lastUpdatedAt: string | null;
  };
}

export interface ProjectStatsProject {
  fibreflow: { id: string; code: string; name: string };
  qfield: { id: string; name: string };
}

export interface Freshness {
  lastQFieldUpdateAt: string | null;
  weekdayAgeHours: number | null;
  state: FreshnessState;
  warningSuppressed: boolean;
  policy: 'stale after 24 weekday hours; weekend warnings suppressed';
}

export interface SourceHealthEntry {
  state: SourceState;
  durationMs: number;
  message?: string;
}

export type SourceHealth = Record<
  'qfield' | 'fibreflow' | 'qa' | 'sync' | 'design' | 'minio',
  SourceHealthEntry
>;

export interface PoleStats {
  qfieldTotal: number;
  planted: number;
  photoComplete: number;
  photoIncomplete: number;
  qaPassed: number;
  qaFailed: number;
  applied: number;
  stuckRecoverable: number;
  staleDuplicates: number;
  designTotal: number | null;
  neverCaptured: number | null;
  referencedPhotos: number;
  presentPhotos: number | null;
  missingPhotos: number | null;
  byStatus: Record<string, number>;
}

export interface CableStats {
  qfieldTotal: number;
  fibreflowTotal: number | null;
  totalLengthM: number | null;
  synchronized: number | null;
  needsSync: number | null;
  qfieldOnly: number | null;
  fibreflowOnly: number | null;
  byStatus: Record<string, number>;
}

export interface DropStats {
  qfieldTotal: number;
  fibreflowTotal: number | null;
  installed: number;
  planned: number;
  inProgress: number;
  approved: number;
  pending: number;
  failed: number;
  synchronized: number | null;
  needsSync: number | null;
  qfieldOnly: number | null;
  fibreflowOnly: number | null;
  installationByStatus: Record<string, number>;
  qcByStatus: Record<string, number>;
}

export interface QaStats {
  total: number;
  pending: number;
  inReview: number;
  approved: number;
  rejected: number;
  escalated: number;
  overdue: number;
  needsRetake: number;
  completedRetake: number;
  myQueue: number;
  confidence: Record<string, number>;
  byWorkType: Record<string, number>;
  byPriority: Record<string, number>;
}

export interface SyncStats {
  scope: 'system';
  currentJob: null | {
    id: string;
    type: string;
    status: string;
    startedAt: string;
  };
  lastCompletedAt: string | null;
  successful: number;
  failed: number;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  unresolvedConflicts: number;
}

export interface ProjectStatsAnomaly {
  type: 'stuck' | 'stale_duplicate' | 'unknown_status' | 'missing_photo' | 'sync_mismatch';
  featureKey: string;
  label: string | null;
  status: string | null;
  occurredAt: string | null;
}

export interface ProjectStatsResponse {
  status: ProjectStatsStatus;
  section: ProjectStatsSection;
  project: ProjectStatsProject;
  freshness: Freshness;
  poles: PoleStats | null;
  cables: CableStats | null;
  drops: DropStats | null;
  qa: QaStats | null;
  sync: SyncStats | null;
  anomalies: {
    total: number;
    page: number;
    limit: number;
    items: ProjectStatsAnomaly[];
  } | null;
  sourceHealth: SourceHealth;
  warnings: string[];
  generatedAt: string;
}
```

- [ ] **Step 4: Implement typed errors and strict parsing**

```typescript
// errors.ts
import { ErrorCode } from '@/lib/apiResponse';

export class ProjectStatsError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ProjectStatsError';
  }
}
```

```typescript
// request.ts
import type { ParsedUrlQuery } from 'querystring';
import { ErrorCode } from '@/lib/apiResponse';
import { ProjectStatsError } from './errors';
import { PROJECT_STATS_SECTIONS, type ProjectStatsQuery, type ProjectStatsSection } from './types';

function scalar(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(
  name: 'page' | 'limit',
  value: string | undefined,
  fallback: number
): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ProjectStatsError(ErrorCode.BAD_REQUEST, `${name} must be a positive integer`);
  }
  return Number(value);
}

export function parseProjectStatsQuery(query: ParsedUrlQuery): ProjectStatsQuery {
  const project = scalar(query.project)?.trim();
  if (!project) {
    throw new ProjectStatsError(ErrorCode.BAD_REQUEST, 'project is required');
  }
  if (project.length > 200) {
    throw new ProjectStatsError(ErrorCode.BAD_REQUEST, 'project must be 200 characters or fewer');
  }

  const requestedSection = scalar(query.section) ?? 'summary';
  if (!PROJECT_STATS_SECTIONS.includes(requestedSection as ProjectStatsSection)) {
    throw new ProjectStatsError(
      ErrorCode.BAD_REQUEST,
      `section must be one of ${PROJECT_STATS_SECTIONS.join(', ')}`
    );
  }

  const page = positiveInteger('page', scalar(query.page), 1);
  const limit = positiveInteger('limit', scalar(query.limit), 50);
  if (limit > 100) {
    throw new ProjectStatsError(ErrorCode.BAD_REQUEST, 'limit must be between 1 and 100');
  }

  return { project, section: requestedSection as ProjectStatsSection, page, limit };
}
```

- [ ] **Step 5: Run the parser test and verify GREEN**

Run:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/request.test.ts
```

Expected: PASS with 6 tests.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/modules/qfield-sync/project-stats
git commit -m "feat(qfield): define project statistics contract"
```

---

### Task 2: SAST weekday freshness policy

**Files:**

- Create: `src/modules/qfield-sync/project-stats/freshness.ts`
- Test: `src/modules/qfield-sync/project-stats/__tests__/freshness.test.ts`

**Interfaces:**

- Consumes: `Freshness` from Task 1.
- Produces: `calculateFreshness(lastUpdatedAt: string | null, now?: Date): Freshness`.

- [ ] **Step 1: Write failing freshness tests**

```typescript
import { describe, expect, it } from 'vitest';
import { calculateFreshness } from '../freshness';

describe('calculateFreshness', () => {
  it('is fresh before 24 weekday hours', () => {
    const value = calculateFreshness('2026-07-29T08:00:00Z', new Date('2026-07-30T07:00:00Z'));
    expect(value.weekdayAgeHours).toBe(23);
    expect(value.state).toBe('fresh');
  });

  it('excludes Saturday and Sunday from Friday-to-Monday age', () => {
    const value = calculateFreshness('2026-07-31T10:00:00Z', new Date('2026-08-03T11:00:00Z'));
    expect(value.weekdayAgeHours).toBe(25);
    expect(value.state).toBe('stale');
  });

  it('suppresses a stale warning during the weekend', () => {
    const value = calculateFreshness('2026-07-30T08:00:00Z', new Date('2026-08-01T10:00:00Z'));
    expect(value.state).toBe('stale');
    expect(value.warningSuppressed).toBe(true);
  });

  it('returns unknown for a missing or invalid timestamp', () => {
    expect(calculateFreshness(null).state).toBe('unknown');
    expect(calculateFreshness('not-a-date').state).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run the freshness test and verify RED**

Run:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/freshness.test.ts
```

Expected: FAIL because `freshness.ts` does not exist.

- [ ] **Step 3: Implement weekday-hour accumulation**

Use SAST's fixed UTC+02:00 offset and split the interval at each local midnight:

```typescript
import type { Freshness } from './types';

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function shifted(ms: number): Date {
  return new Date(ms + SAST_OFFSET_MS);
}

function isWeekend(ms: number): boolean {
  const day = shifted(ms).getUTCDay();
  return day === 0 || day === 6;
}

function nextSastMidnightUtc(ms: number): number {
  const local = shifted(ms);
  return (
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - SAST_OFFSET_MS
  );
}

export function weekdayAgeHours(startIso: string, end: Date): number | null {
  const start = Date.parse(startIso);
  const endMs = end.getTime();
  if (!Number.isFinite(start) || endMs < start) return null;

  let cursor = start;
  let weekdayMs = 0;
  while (cursor < endMs) {
    const segmentEnd = Math.min(endMs, nextSastMidnightUtc(cursor));
    if (!isWeekend(cursor)) weekdayMs += segmentEnd - cursor;
    cursor = segmentEnd;
  }
  return Math.round((weekdayMs / HOUR_MS) * 100) / 100;
}

export function calculateFreshness(lastUpdatedAt: string | null, now = new Date()): Freshness {
  const policy = 'stale after 24 weekday hours; weekend warnings suppressed' as const;
  if (!lastUpdatedAt) {
    return {
      lastQFieldUpdateAt: null,
      weekdayAgeHours: null,
      state: 'unknown',
      warningSuppressed: false,
      policy,
    };
  }

  const age = weekdayAgeHours(lastUpdatedAt, now);
  if (age === null) {
    return {
      lastQFieldUpdateAt: lastUpdatedAt,
      weekdayAgeHours: null,
      state: 'unknown',
      warningSuppressed: false,
      policy,
    };
  }

  const state = age > 24 ? 'stale' : 'fresh';
  return {
    lastQFieldUpdateAt: lastUpdatedAt,
    weekdayAgeHours: age,
    state,
    warningSuppressed: state === 'stale' && isWeekend(now.getTime()),
    policy,
  };
}
```

- [ ] **Step 4: Run the freshness tests and verify GREEN**

Run:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/freshness.test.ts
```

Expected: PASS with 4 tests.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/modules/qfield-sync/project-stats/freshness.ts \
  src/modules/qfield-sync/project-stats/__tests__/freshness.test.ts
git commit -m "feat(qfield): add weekday freshness policy"
```

---

### Task 3: Deterministic FibreFlow-to-QField project resolution

**Files:**

- Create: `src/modules/qfield-sync/project-stats/projectResolverRepo.ts`
- Create: `src/modules/qfield-sync/project-stats/projectResolver.ts`
- Test: `src/modules/qfield-sync/project-stats/__tests__/projectResolver.test.ts`
- Test: `src/modules/qfield-sync/project-stats/__tests__/projectResolverRepo.test.ts`

**Interfaces:**

- Consumes: `ResolvedProject` and `ProjectStatsError`.
- Produces: `ProjectCandidate`, `ProjectResolverRepository`.
- Produces: `resolveProject(identifier: string, repo?: ProjectResolverRepository): Promise<ResolvedProject>`.

The route-level `projects:view` gate in Task 8 is the current resource-level
project visibility boundary. Do not introduce the legacy Firestore
`projectAccessMiddleware` or claim row-level visibility that the PostgreSQL
project APIs do not provide.

- [ ] **Step 1: Write failing resolver tests**

```typescript
import { describe, expect, it } from 'vitest';
import { resolveProject } from '../projectResolver';
import type { ProjectResolverRepository } from '../projectResolverRepo';

const linked = {
  matchRank: 4,
  fibreflowId: 'ff-mahikeng',
  fibreflowCode: 'PRJ-1782143116953',
  fibreflowName: 'Mahikeng',
  qfieldRegistrationId: 'registration-1',
  qfieldProjectId: 'e801cd43-7efe-4f7a-bed5-ee0410f3dfd6',
  qfieldName: 'HT_Mahikeng',
  qfieldActive: true,
  qfieldLastUpdatedAt: '2026-07-29T11:34:04Z',
};

function repo(rows: (typeof linked)[]): ProjectResolverRepository {
  return { findCandidates: async () => rows };
}

describe('resolveProject', () => {
  it('returns the single active linked project', async () => {
    const result = await resolveProject('Mahikeng', repo([linked]));
    expect(result.qfield.projectId).toBe(linked.qfieldProjectId);
  });

  it('prefers the best match rank before deciding ambiguity', async () => {
    const partial = { ...linked, matchRank: 5, fibreflowId: 'ff-other' };
    expect((await resolveProject('Mahikeng', repo([partial, linked]))).fibreflow.id).toBe(
      'ff-mahikeng'
    );
  });

  it('returns safe candidates when equally ranked active links remain', async () => {
    const second = {
      ...linked,
      fibreflowId: 'ff-two',
      qfieldRegistrationId: 'registration-2',
      qfieldProjectId: 'qf-two',
      qfieldName: 'Mahikeng_Replan_HLD',
    };
    await expect(resolveProject('Mahikeng', repo([linked, second]))).rejects.toMatchObject({
      code: 'CONFLICT',
      details: {
        candidates: expect.arrayContaining([
          expect.objectContaining({ qfieldName: 'HT_Mahikeng' }),
        ]),
      },
    });
  });

  it('distinguishes a missing project from a missing active QField link', async () => {
    await expect(resolveProject('Unknown', repo([]))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      resolveProject('Mahikeng', repo([{ ...linked, qfieldActive: false }]))
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
```

In `projectResolverRepo.test.ts`, mock `@/lib/db-pool` and assert the real
repository passes the identifier as `$1`, matches `lower(qp.name)`, uses
`position(lower($1) in lower(...))` for literal substring matching, and never
interpolates the identifier into SQL.

```typescript
import { describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/db-pool', () => ({ query }));

import { projectResolverRepo } from '../projectResolverRepo';

describe('projectResolverRepo', () => {
  it('parameterizes names and searches FibreFlow plus QField names literally', async () => {
    const identifier = `HT_Mahikeng%'`;
    await projectResolverRepo.findCandidates(identifier);

    const [sql, params] = query.mock.calls[0]!;
    expect(params).toEqual([identifier]);
    expect(sql).toContain('lower(qp.name) = lower($1)');
    expect(sql).toContain('position(lower($1) in lower(p.project_name))');
    expect(sql).toContain('position(lower($1) in lower(qp.name))');
    expect(sql).not.toContain(identifier);
  });
});
```

- [ ] **Step 2: Run resolver tests and verify RED**

Run:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/projectResolver*.test.ts
```

Expected: FAIL because the resolver files do not exist.

- [ ] **Step 3: Implement the parameterized candidate query**

`projectResolverRepo.ts` must use `query` from `@/lib/db-pool`, not the Neon shim:

```typescript
import { query } from '@/lib/db-pool';

export interface ProjectCandidate {
  matchRank: number;
  fibreflowId: string;
  fibreflowCode: string;
  fibreflowName: string;
  qfieldRegistrationId: string | null;
  qfieldProjectId: string | null;
  qfieldName: string | null;
  qfieldActive: boolean;
  qfieldLastUpdatedAt: string | null;
}

export interface ProjectResolverRepository {
  findCandidates(identifier: string): Promise<ProjectCandidate[]>;
}

export const projectResolverRepo: ProjectResolverRepository = {
  async findCandidates(identifier) {
    return query<ProjectCandidate>(
      `
      SELECT
        CASE
          WHEN p.id::text = $1 THEN 1
          WHEN qp.qfield_project_id::text = $1 THEN 2
          WHEN lower(p.project_code) = lower($1) THEN 3
          WHEN lower(p.project_name) = lower($1)
            OR lower(qp.name) = lower($1) THEN 4
          ELSE 5
        END AS "matchRank",
        p.id::text AS "fibreflowId",
        p.project_code AS "fibreflowCode",
        p.project_name AS "fibreflowName",
        qp.id::text AS "qfieldRegistrationId",
        qp.qfield_project_id::text AS "qfieldProjectId",
        qp.name AS "qfieldName",
        COALESCE(qp.is_active, false) AS "qfieldActive",
        qp.last_synced_at::text AS "qfieldLastUpdatedAt"
      FROM projects p
      LEFT JOIN qfield_project_links qpl ON qpl.fibreflow_project_id = p.id
      LEFT JOIN qfield_projects qp ON qp.id = qpl.qfield_project_id
      WHERE p.id::text = $1
         OR qp.qfield_project_id::text = $1
         OR lower(p.project_code) = lower($1)
         OR lower(p.project_name) = lower($1)
         OR lower(qp.name) = lower($1)
         OR position(lower($1) in lower(p.project_name)) > 0
         OR position(lower($1) in lower(qp.name)) > 0
      ORDER BY "matchRank", p.project_name, qp.name
    `,
      [identifier]
    );
  },
};
```

The QField freshness timestamp is replaced by `core_project.data_last_updated_at` in Task 4; `last_synced_at` is link metadata only.

- [ ] **Step 4: Implement deterministic selection**

```typescript
import { ErrorCode } from '@/lib/apiResponse';
import { ProjectStatsError } from './errors';
import {
  projectResolverRepo,
  type ProjectCandidate,
  type ProjectResolverRepository,
} from './projectResolverRepo';
import type { ResolvedProject } from './types';

function safeCandidate(row: ProjectCandidate) {
  return {
    fibreflowId: row.fibreflowId,
    fibreflowCode: row.fibreflowCode,
    fibreflowName: row.fibreflowName,
    qfieldProjectId: row.qfieldProjectId,
    qfieldName: row.qfieldName,
  };
}

export async function resolveProject(
  identifier: string,
  repo: ProjectResolverRepository = projectResolverRepo
): Promise<ResolvedProject> {
  const rows = await repo.findCandidates(identifier);
  if (rows.length === 0) {
    throw new ProjectStatsError(ErrorCode.NOT_FOUND, `Project '${identifier}' not found`);
  }

  const bestRank = Math.min(...rows.map((row) => Number(row.matchRank)));
  const best = rows.filter((row) => Number(row.matchRank) === bestRank);
  const linked = best.filter(
    (row) => row.qfieldActive && row.qfieldRegistrationId && row.qfieldProjectId && row.qfieldName
  );

  if (linked.length === 0) {
    throw new ProjectStatsError(
      ErrorCode.VALIDATION_ERROR,
      `Project '${identifier}' has no active linked QField project`
    );
  }
  if (linked.length > 1) {
    throw new ProjectStatsError(
      ErrorCode.CONFLICT,
      `Project '${identifier}' matches multiple active QField projects`,
      { candidates: linked.map(safeCandidate) }
    );
  }

  const row = linked[0]!;
  return {
    fibreflow: {
      id: row.fibreflowId,
      code: row.fibreflowCode,
      name: row.fibreflowName,
    },
    qfield: {
      registrationId: row.qfieldRegistrationId!,
      projectId: row.qfieldProjectId!,
      name: row.qfieldName!,
      lastUpdatedAt: row.qfieldLastUpdatedAt,
    },
  };
}
```

- [ ] **Step 5: Run resolver tests and verify GREEN**

Run:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/projectResolver*.test.ts
```

Expected: both resolver suites PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/modules/qfield-sync/project-stats/projectResolver*.ts \
  src/modules/qfield-sync/project-stats/__tests__/projectResolver*.test.ts
git commit -m "feat(qfield): resolve linked project statistics scope"
```

---

### Task 4: Read QField project deltas from the authoritative schema

**Files:**

- Create: `src/modules/qfield-sync/project-stats/qfieldDeltaRepo.ts`
- Test: `src/modules/qfield-sync/project-stats/__tests__/qfieldDeltaRepo.test.ts`

**Interfaces:**

- Produces: `QFieldDelta`, `QFieldDeltaSnapshot`, `QFieldDeltaRepository`.
- Produces: `qfieldDeltaRepo.load(projectId: string): Promise<QFieldDeltaSnapshot>`.
- Consumes: `qfcQuery` from the established read-only QField pool.

- [ ] **Step 1: Write failing repository projection tests**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { qfcQuery } = vi.hoisted(() => ({ qfcQuery: vi.fn() }));
vi.mock('@/lib/qfieldcloud/qfcPool', () => ({ qfcQuery }));

import { qfieldDeltaRepo } from '../qfieldDeltaRepo';

describe('qfieldDeltaRepo', () => {
  beforeEach(() => qfcQuery.mockReset());

  it('projects core_delta rows and never queries core_layer/core_feature', async () => {
    qfcQuery.mockResolvedValueOnce([{ updated_at: '2026-07-29T11:34:04Z' }]).mockResolvedValueOnce([
      {
        id: 'd1',
        feature_key: '42',
        label: 'HT_MFKGP4_F001',
        status: 'Pole Planted - Photos Incomplete',
        last_status: 'applied',
        created_at: '2026-07-29T10:00:00Z',
        drop_number: null,
        cable_id: null,
        cable_length_m: null,
        installation_status: null,
        qc_status: null,
        photo_keys: ['DCIM/a.jpg'],
      },
    ]);

    const result = await qfieldDeltaRepo.load('qfield-project');

    expect(result.lastUpdatedAt).toBe('2026-07-29T11:34:04Z');
    expect(result.deltas[0]).toMatchObject({
      id: 'd1',
      featureKey: '42',
      status: 'Pole Planted - Photos Incomplete',
      photoKeys: ['DCIM/a.jpg'],
    });
    const sqlText = qfcQuery.mock.calls.map(([sql]) => sql).join('\n');
    expect(sqlText).toContain('core_delta');
    expect(sqlText).not.toMatch(/core_(layer|feature)/);
  });
});
```

- [ ] **Step 2: Run the repository test and verify RED**

Run:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/qfieldDeltaRepo.test.ts
```

Expected: FAIL because `qfieldDeltaRepo.ts` does not exist.

- [ ] **Step 3: Implement the read-only projection**

```typescript
import { qfcQuery } from '@/lib/qfieldcloud/qfcPool';
import type { LastStatus } from '@/modules/qfield-recon/types';

export interface QFieldDelta {
  id: string;
  featureKey: string;
  label: string | null;
  status: string | null;
  lastStatus: LastStatus;
  createdAt: string;
  dropNumber: string | null;
  cableId: string | null;
  cableLengthM: number | null;
  installationStatus: string | null;
  qcStatus: string | null;
  photoKeys: string[];
}

export interface QFieldDeltaSnapshot {
  lastUpdatedAt: string | null;
  deltas: QFieldDelta[];
}

export interface QFieldDeltaRepository {
  load(projectId: string): Promise<QFieldDeltaSnapshot>;
}

interface DeltaRow {
  id: string;
  feature_key: string | null;
  label: string | null;
  status: string | null;
  last_status: LastStatus;
  created_at: string;
  drop_number: string | null;
  cable_id: string | null;
  cable_length_m: string | number | null;
  installation_status: string | null;
  qc_status: string | null;
  photo_keys: string[];
}

function mapRow(row: DeltaRow): QFieldDelta | null {
  if (!row.feature_key) return null;
  const length = row.cable_length_m === null ? null : Number(row.cable_length_m);
  return {
    id: row.id,
    featureKey: row.feature_key,
    label: row.label,
    status: row.status?.trim() || null,
    lastStatus: row.last_status,
    createdAt: row.created_at,
    dropNumber: row.drop_number,
    cableId: row.cable_id,
    cableLengthM: Number.isFinite(length) ? length : null,
    installationStatus: row.installation_status?.trim() || null,
    qcStatus: row.qc_status?.trim() || null,
    photoKeys: row.photo_keys ?? [],
  };
}

export const qfieldDeltaRepo: QFieldDeltaRepository = {
  async load(projectId) {
    const [projectRows, deltaRows] = await Promise.all([
      qfcQuery<{ updated_at: string | null }>(
        `SELECT to_char(data_last_updated_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
           FROM core_project WHERE id = $1::uuid`,
        [projectId]
      ),
      qfcQuery<DeltaRow>(
        `SELECT
           d.id::text AS id,
           d.content->>'localPk' AS feature_key,
           COALESCE(d.content->'new'->'attributes'->>'label',
                    d.content->'old'->'attributes'->>'label') AS label,
           NULLIF(BTRIM(COALESCE(
             d.content->'new'->'attributes'->>'Status',
             d.content->'old'->'attributes'->>'Status'
           )), '') AS status,
           d.last_status,
           to_char(d.created_at AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
           COALESCE(d.content->'new'->'attributes'->>'drop_number',
                    d.content->'old'->'attributes'->>'drop_number') AS drop_number,
           COALESCE(d.content->'new'->'attributes'->>'cable_id',
                    d.content->'new'->'attributes'->>'Cable_No',
                    d.content->'old'->'attributes'->>'cable_id',
                    d.content->'old'->'attributes'->>'Cable_No') AS cable_id,
           COALESCE(d.content->'new'->'attributes'->>'length',
                    d.content->'new'->'attributes'->>'Length',
                    d.content->'old'->'attributes'->>'length',
                    d.content->'old'->'attributes'->>'Length') AS cable_length_m,
           COALESCE(d.content->'new'->'attributes'->>'installation_status',
                    d.content->'new'->'attributes'->>'Installation Status',
                    d.content->'old'->'attributes'->>'installation_status',
                    d.content->'old'->'attributes'->>'Installation Status') AS installation_status,
           COALESCE(d.content->'new'->'attributes'->>'qc_status',
                    d.content->'new'->'attributes'->>'QC Status',
                    d.content->'old'->'attributes'->>'qc_status',
                    d.content->'old'->'attributes'->>'QC Status') AS qc_status,
           COALESCE(ARRAY(
             SELECT jsonb_object_keys(
               COALESCE(d.content->'new'->'files_sha256', '{}'::jsonb)
             )
           ), '{}') AS photo_keys
         FROM core_delta d
         WHERE d.project_id = $1::uuid
         ORDER BY d.created_at, d.id`,
        [projectId]
      ),
    ]);

    return {
      lastUpdatedAt: projectRows[0]?.updated_at ?? null,
      deltas: deltaRows.map(mapRow).filter((row): row is QFieldDelta => row !== null),
    };
  },
};
```

- [ ] **Step 4: Run the repository test and verify GREEN**

Run:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/qfieldDeltaRepo.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/modules/qfield-sync/project-stats/qfieldDeltaRepo.ts \
  src/modules/qfield-sync/project-stats/__tests__/qfieldDeltaRepo.test.ts
git commit -m "feat(qfield): read authoritative project deltas"
```

---

### Task 5: Reduce delta history into physical and field-delivery state

**Files:**

- Create: `src/modules/qfield-sync/project-stats/featureState.ts`
- Test: `src/modules/qfield-sync/project-stats/__tests__/featureState.test.ts`

**Interfaces:**

- Consumes: `QFieldDelta` from Task 4 and aggregate types from Task 1.
- Produces: `QFieldInfrastructureSnapshot`.
- Produces: `buildQFieldInfrastructure(deltas: QFieldDelta[]): QFieldInfrastructureSnapshot`.

- [ ] **Step 1: Write failing physical-state and deduplication tests**

```typescript
import { describe, expect, it } from 'vitest';
import { buildQFieldInfrastructure } from '../featureState';
import type { QFieldDelta } from '../qfieldDeltaRepo';

function delta(
  featureKey: string,
  status: string,
  createdAt: string,
  lastStatus: QFieldDelta['lastStatus'] = 'applied'
): QFieldDelta {
  return {
    id: `${featureKey}-${createdAt}-${lastStatus}`,
    featureKey,
    label: `HT_${featureKey}`,
    status,
    lastStatus,
    createdAt,
    dropNumber: null,
    cableId: null,
    cableLengthM: null,
    installationStatus: null,
    qcStatus: null,
    photoKeys: [],
  };
}

describe('buildQFieldInfrastructure', () => {
  it('keeps a planted pole planted through missing photos and QA failure', () => {
    const snapshot = buildQFieldInfrastructure([
      delta('1', 'Pole Planted - Photos Incomplete', '2026-07-29T08:00:00Z'),
      delta('1', 'Q/A Failed', '2026-07-29T09:00:00Z'),
    ]);
    expect(snapshot.poles.planted).toBe(1);
    expect(snapshot.poles.photoIncomplete).toBe(1);
    expect(snapshot.poles.qaFailed).toBe(1);
  });

  it('removal clears physical state and a later replant restores it', () => {
    const removed = buildQFieldInfrastructure([
      delta('1', 'Pole Planted/ All Photos', '2026-07-29T08:00:00Z'),
      delta('1', 'Pole Removed/Canceled', '2026-07-29T09:00:00Z'),
    ]);
    expect(removed.poles.planted).toBe(0);

    const replanted = buildQFieldInfrastructure([
      delta('1', 'Pole Planted/ All Photos', '2026-07-29T08:00:00Z'),
      delta('1', 'Pole Removed/Canceled', '2026-07-29T09:00:00Z'),
      delta('1', 'Pole Planted - Photos Incomplete', '2026-07-29T10:00:00Z'),
    ]);
    expect(replanted.poles.planted).toBe(1);
  });

  it('does not double count an error twin after an applied event', () => {
    const snapshot = buildQFieldInfrastructure([
      delta('1', 'Pole Planted/ All Photos', '2026-07-29T08:00:00Z'),
      delta('1', 'Pole Planted/ All Photos', '2026-07-29T09:00:00Z', 'error'),
    ]);
    expect(snapshot.poles.planted).toBe(1);
    expect(snapshot.poles.staleDuplicates).toBe(1);
  });

  it('keeps QA on the pole when pole and cable localPk values collide', () => {
    const cable = {
      ...delta('1', 'String Complete', '2026-07-29T09:00:00Z'),
      cableId: 'C-1',
      cableLengthM: 120,
    };
    const snapshot = buildQFieldInfrastructure([
      delta('1', 'Pole Planted/ All Photos', '2026-07-29T08:00:00Z'),
      cable,
      delta('1', 'Q/A Failed', '2026-07-29T10:00:00Z'),
    ]);
    expect(snapshot.poles.qfieldTotal).toBe(1);
    expect(snapshot.poles.planted).toBe(1);
    expect(snapshot.poles.qaFailed).toBe(1);
    expect(snapshot.cables.qfieldTotal).toBe(1);
  });
});
```

- [ ] **Step 2: Run reducer tests and verify RED**

Run:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/featureState.test.ts
```

Expected: FAIL because `featureState.ts` does not exist.

- [ ] **Step 3: Implement explicit physical transitions and field kinds**

Use constants and deterministic ordering:

```typescript
import type { QFieldDelta } from './qfieldDeltaRepo';
import type { CableStats, DropStats, PoleStats, ProjectStatsAnomaly } from './types';

const PLANTING_EVENTS = new Set([
  'Pole Planted/ All Photos',
  'Pole Planted - Photos Incomplete',
  'Pole Verified/ Civil Complete',
]);
const REMOVAL_EVENTS = new Set(['Pole Removed/Canceled', 'Pole Canceled / Removed']);
const STUCK = new Set(['error', 'not_applied', 'conflict']);

export interface QFieldInfrastructureSnapshot {
  poles: PoleStats;
  cables: CableStats;
  drops: DropStats;
  anomalies: ProjectStatsAnomaly[];
  photoKeys: Set<string>;
  civilLabels: Set<string>;
  comparisonRecords: {
    cables: Map<string, { status: string | null }>;
    drops: Map<string, { installationStatus: string | null; qcStatus: string | null }>;
  };
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function ordered(rows: QFieldDelta[]): QFieldDelta[] {
  return [...rows].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  );
}
```

Group histories using kind-prefixed keys:

```typescript
function kindOf(row: QFieldDelta): 'pole' | 'cable' | 'drop' | 'unknown' {
  if (row.dropNumber) return 'drop';
  if (row.cableId || row.status?.startsWith('String ')) return 'cable';
  if (row.status?.startsWith('Pole ')) return 'pole';
  return 'unknown';
}

function groupHistories(deltas: QFieldDelta[]) {
  const groups = new Map<string, QFieldDelta[]>();
  const unassigned: QFieldDelta[] = [];
  const kindsByFeatureKey = new Map<string, Set<'pole' | 'cable' | 'drop'>>();

  for (const row of deltas) {
    const explicitKind = kindOf(row);
    if (explicitKind === 'unknown') continue;
    const kinds = kindsByFeatureKey.get(row.featureKey) ?? new Set();
    kinds.add(explicitKind);
    kindsByFeatureKey.set(row.featureKey, kinds);
  }

  for (const row of ordered(deltas)) {
    const explicitKind = kindOf(row);
    const candidates = kindsByFeatureKey.get(row.featureKey) ?? new Set();
    const isPoleQualityEvent =
      row.status?.startsWith('Q/A ') ||
      row.status?.startsWith('(ADMIN) Q/A ') ||
      row.status?.startsWith('Photo ');
    let kind: 'pole' | 'cable' | 'drop' | undefined;
    if (explicitKind !== 'unknown') {
      kind = explicitKind;
    } else if (isPoleQualityEvent && candidates.has('pole')) {
      kind = 'pole';
    } else if (candidates.size === 1) {
      kind = [...candidates][0];
    }
    if (!kind) {
      unassigned.push(row);
      continue;
    }
    const key = `${kind}:${row.featureKey}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return { groups, unassigned };
}
```

For pole histories, maintain three independent state machines while replaying
only `lastStatus === 'applied'` events:

- physical state changes only on the explicit planting and removal sets;
- photo state changes only on photo-complete/photo-incomplete events; and
- QA state changes only on QA passed/failed events.

This is the load-bearing business rule: QA failure or missing photos can update
quality counters but cannot clear `planted`. An error twin with an applied
sibling increments `staleDuplicates`; a history with only stuck/in-flight events
increments `stuckRecoverable`. Use the latest applied status for `byStatus`, and
emit `unknown_status` anomalies for applied statuses that are neither a known
pole, cable, drop, QA, WIP, nor optical status. If an untyped quality event cannot
be assigned without violating `(kind, localPk)`, do not guess; emit an
`unknown_status` anomaly.

Count `photoComplete` and `photoIncomplete` only among features whose final
physical state is planted. A planted feature with no recognized photo-state
event remains planted but belongs to neither photo bucket; surface the gap in a
warning rather than forcing it into either bucket. Count final QA passed/failed
independently of both physical and photo state.

Collect every non-blank civil label into `civilLabels`. This internal set is used
only for design-cache comparison and is never serialized.

For cables, treat `String Complete`, `String Tested`, `String Issue`, and other
`String ` values as their full source labels; sum only finite non-negative
`cableLengthM` values. Store only the latest applied status per `cableId` in the
internal comparison map. Cable state histories without a non-blank `cableId`
still contribute to the QField total and status distribution, but are excluded
from cross-system comparison with an explicit mapping warning.

For drops, require `dropNumber`, prefer the explicit `installationStatus` and
`qcStatus` projections, and preserve their complete labels rather than inventing
values. Collapse histories that resolve to the same normalized `dropNumber`
using latest-applied timestamp and ID, so the QField drop total follows the
stable business identifier. Store only the two status fields per `dropNumber` in
the internal comparison map. A duplicate or conflicting cable/drop comparison
identity emits a `sync_mismatch` anomaly; no address, customer, geometry, or
photo body enters the snapshot.

- [ ] **Step 4: Add status-preservation and anomaly assertions**

Extend the test with:

```typescript
it('preserves the complete latest status distribution and unknown statuses', () => {
  const snapshot = buildQFieldInfrastructure([
    delta('1', 'Pole Planted/ All Photos', '2026-07-29T08:00:00Z'),
    delta('2', 'Pole Mystery State', '2026-07-29T08:00:00Z'),
  ]);
  expect(snapshot.poles.byStatus).toEqual({
    'Pole Planted/ All Photos': 1,
    'Pole Mystery State': 1,
  });
  expect(snapshot.anomalies).toContainEqual(
    expect.objectContaining({ type: 'unknown_status', featureKey: '2' })
  );
});

it('maps only unambiguous drop headlines and preserves the source labels', () => {
  const snapshot = buildQFieldInfrastructure([
    {
      ...delta('drop-1', 'Drop Updated', '2026-07-29T08:00:00Z'),
      dropNumber: 'DR-1',
      installationStatus: 'Installed',
      qcStatus: 'Approved',
    },
  ]);
  expect(snapshot.drops.installed).toBe(1);
  expect(snapshot.drops.approved).toBe(1);
  expect(snapshot.drops.installationByStatus).toEqual({ Installed: 1 });
  expect(snapshot.drops.qcByStatus).toEqual({ Approved: 1 });
});

it('counts a duplicated drop number once using its latest applied state', () => {
  const snapshot = buildQFieldInfrastructure([
    {
      ...delta('local-1', 'Drop Updated', '2026-07-29T08:00:00Z'),
      dropNumber: 'DR-1',
      installationStatus: 'Planned',
      qcStatus: 'Pending',
    },
    {
      ...delta('local-2', 'Drop Updated', '2026-07-29T09:00:00Z'),
      dropNumber: 'DR-1',
      installationStatus: 'Installed',
      qcStatus: 'Approved',
    },
  ]);
  expect(snapshot.drops.qfieldTotal).toBe(1);
  expect(snapshot.drops.installationByStatus).toEqual({ Installed: 1 });
  expect(snapshot.drops.approved).toBe(1);
  expect(snapshot.anomalies).toContainEqual(
    expect.objectContaining({ type: 'sync_mismatch', featureKey: 'dr-1' })
  );
});
```

- [ ] **Step 5: Run reducer tests and verify GREEN**

Run:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/featureState.test.ts
```

Expected: PASS with 7 tests.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/modules/qfield-sync/project-stats/featureState.ts \
  src/modules/qfield-sync/project-stats/__tests__/featureState.test.ts
git commit -m "feat(qfield): classify physical field state"
```

---

### Task 6: Uncapped FibreFlow, QA, and system-sync readers

**Files:**

- Create: `src/modules/qfield-sync/project-stats/fibreflowInfrastructureRepo.ts`
- Create: `src/modules/qfield-sync/project-stats/qfieldQaRepo.ts`
- Create: `src/modules/qfield-sync/project-stats/qfieldSyncStatsRepo.ts`
- Create: `src/modules/qfield-sync/project-stats/qfieldDesignRepo.ts`
- Test: `src/modules/qfield-sync/project-stats/__tests__/fibreflowInfrastructureRepo.test.ts`
- Test: `src/modules/qfield-sync/project-stats/__tests__/qfieldQaRepo.test.ts`
- Test: `src/modules/qfield-sync/project-stats/__tests__/qfieldSyncStatsRepo.test.ts`
- Test: `src/modules/qfield-sync/project-stats/__tests__/qfieldDesignRepo.test.ts`

**Interfaces:**

- Consumes: `QaStats`, `SyncStats`, and the linked project IDs from Task 3.
- Produces: `FibreFlowInfrastructureSnapshot`.
- Produces: `getFibreFlowInfrastructure(projectId, run?)`.
- Produces: `getQaStats(qfieldProjectId, userEmail, run?)`.
- Produces: `getSystemSyncStats(run?)`.
- Produces: `getCachedPoleDesign(qfieldProjectId, run?)`.

- [ ] **Step 1: Write failing reader tests with an injected query function**

Place each case below in the matching repository test file; the combined snippet
shows the shared fixtures and assertions without creating one oversized suite.

```typescript
import { describe, expect, it, vi } from 'vitest';
import { getFibreFlowInfrastructure } from '../fibreflowInfrastructureRepo';
import { getCachedPoleDesign } from '../qfieldDesignRepo';
import { getQaStats } from '../qfieldQaRepo';
import { getSystemSyncStats } from '../qfieldSyncStatsRepo';

describe('FibreFlow project-stat readers', () => {
  it('loads exact field-limited comparison records without hard limits', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce([{ status: 'installed', count: 240 }])
      .mockResolvedValueOnce([
        { identity: 'C-1', status: 'complete' },
        { identity: 'C-2', status: 'issue' },
      ])
      .mockResolvedValueOnce([{ identity: 'DR-1', status: 'installed', qc_status: 'approved' }]);

    const result = await getFibreFlowInfrastructure('ff-project', run);

    expect(result.poles.total).toBe(240);
    expect(result.cables.total).toBe(2);
    expect(result.cables.records.get('c-1')?.status).toBe('complete');
    expect(result.drops.records.get('dr-1')).toEqual({
      installationStatus: 'installed',
      qcStatus: 'approved',
    });
    expect(run.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/\bLIMIT\b/i);
  });

  it('scopes QA to the external QField project and signed-in email', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce([
        {
          total: 10,
          pending: 4,
          in_review: 1,
          approved: 3,
          rejected: 2,
          escalated: 0,
          overdue: 1,
          needs_retake: 2,
          completed_retake: 1,
          my_queue: 3,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const value = await getQaStats('qf-1', 'user@example.com', run);
    expect(value.total).toBe(10);
    expect(run.mock.calls[0][1]).toEqual(['qf-1', 'user@example.com']);
  });

  it('labels sync statistics as system scoped', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          last_completed_at: '2026-01-24T11:53:22.939Z',
          successful: 4,
          failed: 0,
          records_processed: 388,
          records_created: 0,
          records_updated: 388,
          records_failed: 0,
        },
      ])
      .mockResolvedValueOnce([{ count: 0 }]);
    expect((await getSystemSyncStats(run)).scope).toBe('system');
  });

  it('reads an existing verified design cache without invoking a resolver', async () => {
    const run = vi.fn().mockResolvedValueOnce([
      {
        gpkg_version: 'v1',
        resolved_at: '2026-07-29T11:34:04Z',
        payload: {
          designPons: [1],
          poleToPon: {
            HT_001: { pon: 1, zone: 'A' },
            HT_002: { pon: 1, zone: 'A' },
          },
        },
      },
    ]);
    expect(await getCachedPoleDesign('qf-1', run)).toMatchObject({
      available: true,
      designTotal: 2,
      labels: new Set(['HT_001', 'HT_002']),
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run reader tests and verify RED**

Run:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/{fibreflowInfrastructureRepo,qfieldQaRepo,qfieldSyncStatsRepo,qfieldDesignRepo}.test.ts
```

Expected: FAIL because the four reader modules do not exist.

- [ ] **Step 3: Implement exact, field-limited infrastructure queries**

Define this injectable runner in each repository (or export it from one
feature-local helper without introducing a project-wide abstraction):

```typescript
import { query } from '@/lib/db-pool';

export type QueryRunner = <T extends Record<string, unknown>>(
  text: string,
  params?: unknown[]
) => Promise<T[]>;

const defaultRun: QueryRunner = query;
```

Use these internal-only shapes in `fibreflowInfrastructureRepo.ts`:

```typescript
interface ComparableCable {
  status: string | null;
}

interface ComparableDrop {
  installationStatus: string | null;
  qcStatus: string | null;
}

export interface FibreFlowInfrastructureSnapshot {
  poles: { total: number; byStatus: Record<string, number> };
  cables: {
    total: number;
    byStatus: Record<string, number>;
    records: Map<string, ComparableCable>;
  };
  drops: {
    total: number;
    byStatus: Record<string, number>;
    qcByStatus: Record<string, number>;
    records: Map<string, ComparableDrop>;
  };
  warnings: string[];
}
```

`getFibreFlowInfrastructure` must execute these three parameterized queries
concurrently:

```sql
SELECT COALESCE(status, '<null>') AS status, COUNT(*)::int AS count
FROM poles WHERE project_id = $1::uuid GROUP BY status
```

```sql
SELECT lower(trim(segment_id)) AS identity,
       NULLIF(trim(status), '') AS status
FROM fibre_segments
WHERE project_id = $1::uuid
```

```sql
SELECT lower(trim(drop_number)) AS identity,
       NULLIF(trim(status), '') AS status,
       NULLIF(trim(qc_status), '') AS qc_status
FROM drops
WHERE project_id = $1::uuid
```

Aggregate totals and full status distributions in memory and retain internal
maps containing only normalized identity plus status fields. These maps are
required for exact cross-database reconciliation; they are never serialized.
Reject blank identities from comparison while keeping their rows in totals and
emitting a mapping warning in Task 7. Do not select customer, address, geometry,
notes, photo, or other record payload fields.

- [ ] **Step 4: Implement scoped QA aggregates**

Use `qfield_photo_validations.project_id::text = $1` where `$1` is the external
QFieldCloud UUID from `qfield_projects.qfield_project_id`, not the internal
`qfield_projects.id` registration UUID and not the FibreFlow project ID. This
two-ID distinction is required for aliased projects:

```sql
SELECT
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE workflow_status = 'pending')::int AS pending,
  COUNT(*) FILTER (WHERE workflow_status = 'in_review')::int AS in_review,
  COUNT(*) FILTER (WHERE workflow_status = 'approved')::int AS approved,
  COUNT(*) FILTER (WHERE workflow_status = 'rejected')::int AS rejected,
  COUNT(*) FILTER (WHERE workflow_status = 'escalated')::int AS escalated,
  COUNT(*) FILTER (
    WHERE due_date < NOW() AND workflow_status IN ('pending', 'in_review')
  )::int AS overdue,
  COUNT(*) FILTER (
    WHERE needs_retake = TRUE AND retake_completed_at IS NULL
  )::int AS needs_retake,
  COUNT(*) FILTER (
    WHERE needs_retake = TRUE AND retake_completed_at IS NOT NULL
  )::int AS completed_retake,
  COUNT(*) FILTER (
    WHERE assigned_to = $2 AND workflow_status IN ('pending', 'in_review')
  )::int AS my_queue
FROM qfield_photo_validations
WHERE project_id::text = $1
```

Add grouped queries for confidence bands, work type, and priority. Convert every
PostgreSQL count to a number in `qfieldQaRepo.ts`.

- [ ] **Step 5: Implement honest system-scoped sync aggregates**

Use one current-job query, one completed-job aggregate query, and one unresolved
conflict count. Return `scope: 'system'` unconditionally. Do not add a fake
project filter because the tables do not have `project_id`. Keep this logic in
`qfieldSyncStatsRepo.ts`.

- [ ] **Step 6: Implement a strictly read-only verified-design cache reader**

`qfieldDesignRepo.ts` must query only the existing
`qfield_pole_pon_cache`. It must not call `getPonMap`, execute the Python
resolver, fetch a GPKG, or populate/update the cache, because this feature is
read-only:

```typescript
export interface CachedPoleDesign {
  available: boolean;
  designTotal: number | null;
  labels: Set<string> | null;
  gpkgVersion?: string;
  resolvedAt?: string;
}
```

```sql
SELECT gpkg_version,
       to_char(resolved_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS resolved_at,
       payload
FROM qfield_pole_pon_cache
WHERE project_id = $1::uuid
ORDER BY resolved_at DESC
LIMIT 1
```

A missing cache row is an available source with
`{ available: false, designTotal: null, labels: null }`, not a source failure.
For a valid cached payload, return the design label set and its exact size.
Malformed cache data is a source failure and becomes `null` through Task 7.

- [ ] **Step 7: Run reader tests and verify GREEN**

Run:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/{fibreflowInfrastructureRepo,qfieldQaRepo,qfieldSyncStatsRepo,qfieldDesignRepo}.test.ts
```

Expected: all four reader suites PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add src/modules/qfield-sync/project-stats/{fibreflowInfrastructureRepo,qfieldQaRepo,qfieldSyncStatsRepo,qfieldDesignRepo}.ts \
  src/modules/qfield-sync/project-stats/__tests__/{fibreflowInfrastructureRepo,qfieldQaRepo,qfieldSyncStatsRepo,qfieldDesignRepo}.test.ts
git commit -m "feat(qfield): aggregate FibreFlow QA and sync stats"
```

---

### Task 7: Orchestrate sources with timeouts and partial-result semantics

**Files:**

- Create: `src/modules/qfield-sync/project-stats/projectStatsService.ts`
- Create: `src/modules/qfield-sync/project-stats/index.ts`
- Test: `src/modules/qfield-sync/project-stats/__tests__/projectStatsService.test.ts`

**Interfaces:**

- Consumes: all Tasks 1-6 interfaces and existing `listDcimKeys`.
- Produces: `getProjectStats(query, context, dependencies?): Promise<ProjectStatsResponse>`.
- Produces: `ProjectStatsContext = { userId: string; userEmail: string; requestId: string }`.

- [ ] **Step 1: Write failing orchestration tests**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { getProjectStats, type ProjectStatsDependencies } from '../projectStatsService';
import type { QFieldDelta } from '../qfieldDeltaRepo';

const project = {
  fibreflow: { id: 'ff-1', code: 'PRJ-1', name: 'Mahikeng' },
  qfield: {
    registrationId: 'reg-1',
    projectId: 'qf-1',
    name: 'HT_Mahikeng',
    lastUpdatedAt: null,
  },
};

function baseDelta(identity: string, status: string): QFieldDelta {
  return {
    id: `${identity}-${status}`,
    featureKey: identity,
    label: identity,
    status,
    lastStatus: 'applied',
    createdAt: '2026-07-29T10:00:00Z',
    dropNumber: null,
    cableId: null,
    cableLengthM: null,
    installationStatus: null,
    qcStatus: null,
    photoKeys: [],
  };
}

function qfieldCable(identity: string, status: string): QFieldDelta {
  return { ...baseDelta(identity, status), cableId: identity };
}

function qfieldDrop(identity: string, installationStatus: string, qcStatus: string): QFieldDelta {
  return {
    ...baseDelta(identity, 'Drop Updated'),
    dropNumber: identity,
    installationStatus,
    qcStatus,
  };
}

function dependencies(): ProjectStatsDependencies {
  return {
    resolveProject: vi.fn().mockResolvedValue(project),
    loadQField: vi.fn().mockResolvedValue({
      lastUpdatedAt: '2026-07-29T11:34:04Z',
      deltas: [],
    }),
    loadFibreFlow: vi.fn().mockResolvedValue({
      poles: { total: 0, byStatus: {} },
      cables: { total: 0, byStatus: {}, records: new Map() },
      drops: { total: 0, byStatus: {}, qcByStatus: {}, records: new Map() },
      warnings: [],
    }),
    loadQa: vi.fn().mockResolvedValue({
      total: 0,
      pending: 0,
      inReview: 0,
      approved: 0,
      rejected: 0,
      escalated: 0,
      overdue: 0,
      needsRetake: 0,
      completedRetake: 0,
      myQueue: 0,
      confidence: {},
      byWorkType: {},
      byPriority: {},
    }),
    loadSync: vi.fn().mockResolvedValue({
      scope: 'system',
      currentJob: null,
      lastCompletedAt: null,
      successful: 0,
      failed: 0,
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsFailed: 0,
      unresolvedConflicts: 0,
    }),
    loadDesign: vi.fn().mockResolvedValue({
      available: false,
      designTotal: null,
      labels: null,
    }),
    loadPhotoKeys: vi.fn().mockResolvedValue(new Set()),
    now: () => new Date('2026-07-30T08:00:00Z'),
  };
}

describe('getProjectStats', () => {
  it('returns a concise complete summary', async () => {
    const result = await getProjectStats(
      { project: 'Mahikeng', section: 'summary', page: 1, limit: 50 },
      { userId: 'u1', userEmail: 'user@example.com', requestId: 'r1' },
      dependencies()
    );
    expect(result.status).toBe('complete');
    expect(result.project.qfield.name).toBe('HT_Mahikeng');
    expect(result.freshness.lastQFieldUpdateAt).toBe('2026-07-29T11:34:04Z');
    expect(result.poles?.planted).toBe(0);
    expect(result.sourceHealth.qfield.state).toBe('ok');
  });

  it('returns partial and null for an optional source failure', async () => {
    const deps = dependencies();
    vi.mocked(deps.loadQa).mockRejectedValue(new Error('qa unavailable'));
    const result = await getProjectStats(
      { project: 'Mahikeng', section: 'summary', page: 1, limit: 50 },
      { userId: 'u1', userEmail: 'user@example.com', requestId: 'r1' },
      deps
    );
    expect(result.status).toBe('partial');
    expect(result.qa).toBeNull();
    expect(result.sourceHealth.qa.state).toBe('unavailable');
    expect(result.warnings).toContain('QA statistics unavailable');
  });

  it('keeps photo presence unknown rather than zero when MinIO fails', async () => {
    const deps = dependencies();
    vi.mocked(deps.loadQField).mockResolvedValue({
      lastUpdatedAt: '2026-07-29T11:34:04Z',
      deltas: [
        {
          ...baseDelta('pole-1', 'Pole Planted/ All Photos'),
          photoKeys: ['DCIM/pole-1.jpg'],
        },
      ],
    });
    vi.mocked(deps.loadPhotoKeys).mockRejectedValue(new Error('minio unavailable'));

    const result = await getProjectStats(
      { project: 'Mahikeng', section: 'summary', page: 1, limit: 50 },
      { userId: 'u1', userEmail: 'user@example.com', requestId: 'r1' },
      deps
    );
    expect(result.status).toBe('partial');
    expect(result.poles).toMatchObject({
      planted: 1,
      referencedPhotos: 1,
      presentPhotos: null,
      missingPhotos: null,
    });
    expect(result.sourceHealth.minio.state).toBe('unavailable');
  });

  it('reports a genuine missing photo only when MinIO answered successfully', async () => {
    const deps = dependencies();
    vi.mocked(deps.loadQField).mockResolvedValue({
      lastUpdatedAt: '2026-07-29T11:34:04Z',
      deltas: [
        {
          ...baseDelta('pole-1', 'Pole Planted/ All Photos'),
          photoKeys: ['DCIM/pole-1.jpg'],
        },
      ],
    });
    vi.mocked(deps.loadPhotoKeys).mockResolvedValue(new Set());

    const result = await getProjectStats(
      { project: 'Mahikeng', section: 'summary', page: 1, limit: 50 },
      { userId: 'u1', userEmail: 'user@example.com', requestId: 'r1' },
      deps
    );
    expect(result.poles).toMatchObject({
      referencedPhotos: 1,
      presentPhotos: 0,
      missingPhotos: 1,
    });
    expect(result.sourceHealth.minio.state).toBe('ok');
  });

  it('throws SERVICE_UNAVAILABLE when the primary QField source fails', async () => {
    const deps = dependencies();
    vi.mocked(deps.loadQField).mockRejectedValue(new Error('qfield unavailable'));
    await expect(
      getProjectStats(
        { project: 'Mahikeng', section: 'summary', page: 1, limit: 50 },
        { userId: 'u1', userEmail: 'user@example.com', requestId: 'r1' },
        deps
      )
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('paginates only anomaly details while preserving the full total', async () => {
    const result = await getProjectStats(
      { project: 'Mahikeng', section: 'anomalies', page: 2, limit: 2 },
      { userId: 'u1', userEmail: 'user@example.com', requestId: 'r1' },
      dependencies()
    );
    expect(result.anomalies?.page).toBe(2);
    expect(result.anomalies?.limit).toBe(2);
  });

  it('reconciles cable and drop identities without serializing record maps', async () => {
    const deps = dependencies();
    vi.mocked(deps.loadQField).mockResolvedValue({
      lastUpdatedAt: '2026-07-29T11:34:04Z',
      deltas: [
        qfieldCable('C-1', 'String Complete'),
        qfieldCable('C-2', 'String Issue'),
        qfieldDrop('DR-1', 'Installed', 'Approved'),
      ],
    });
    vi.mocked(deps.loadFibreFlow).mockResolvedValue({
      poles: { total: 0, byStatus: {} },
      cables: {
        total: 2,
        byStatus: { complete: 1, planned: 1 },
        records: new Map([
          ['c-1', { status: 'String Complete' }],
          ['c-3', { status: 'planned' }],
        ]),
      },
      drops: {
        total: 1,
        byStatus: { Installed: 1 },
        qcByStatus: { Pending: 1 },
        records: new Map([['dr-1', { installationStatus: 'Installed', qcStatus: 'Pending' }]]),
      },
      warnings: [],
    });

    const result = await getProjectStats(
      { project: 'Mahikeng', section: 'summary', page: 1, limit: 50 },
      { userId: 'u1', userEmail: 'user@example.com', requestId: 'r1' },
      deps
    );
    expect(result.cables).toMatchObject({
      synchronized: 1,
      needsSync: 0,
      qfieldOnly: 1,
      fibreflowOnly: 1,
    });
    expect(result.drops).toMatchObject({
      synchronized: 0,
      needsSync: 1,
      qfieldOnly: 0,
      fibreflowOnly: 0,
    });
    expect(JSON.stringify(result)).not.toContain('records');
  });

  it('keeps summary and section totals identical and hides unrelated sections', async () => {
    const deps = dependencies();
    vi.mocked(deps.loadQField).mockResolvedValue({
      lastUpdatedAt: '2026-07-29T11:34:04Z',
      deltas: [baseDelta('pole-1', 'Pole Planted - Photos Incomplete')],
    });
    const context = {
      userId: 'u1',
      userEmail: 'user@example.com',
      requestId: 'r1',
    };
    const summary = await getProjectStats(
      { project: 'Mahikeng', section: 'summary', page: 1, limit: 50 },
      context,
      deps
    );
    const poles = await getProjectStats(
      { project: 'Mahikeng', section: 'poles', page: 1, limit: 50 },
      context,
      deps
    );
    expect(poles.poles).toEqual(summary.poles);
    expect(poles.cables).toBeNull();
    expect(poles.drops).toBeNull();
    expect(JSON.stringify(poles)).not.toMatch(/customer|address|geometry|authorization|token/i);
  });
});
```

- [ ] **Step 2: Run service tests and verify RED**

Run:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__/projectStatsService.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement bounded source execution**

Define the dependency seam explicitly so every source can be tested without
network or database access:

```typescript
export interface ProjectStatsDependencies {
  resolveProject: (identifier: string) => Promise<ResolvedProject>;
  loadQField: (projectId: string) => Promise<QFieldDeltaSnapshot>;
  loadFibreFlow: (projectId: string) => Promise<FibreFlowInfrastructureSnapshot>;
  loadQa: (projectId: string, userEmail: string) => Promise<QaStats>;
  loadSync: () => Promise<SyncStats>;
  loadDesign: (projectId: string) => Promise<CachedPoleDesign>;
  loadPhotoKeys: (projectId: string) => Promise<Set<string>>;
  now: () => Date;
}
```

```typescript
async function settleSource<T>(
  name: keyof SourceHealth,
  timeoutMs: number,
  task: () => Promise<T>
): Promise<{ value: T | null; health: SourceHealthEntry }> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('SOURCE_TIMEOUT')), timeoutMs);
    });
    const value = await Promise.race([task(), timeout]);
    return { value, health: { state: 'ok', durationMs: Date.now() - started } };
  } catch (error) {
    const timedOut = error instanceof Error && error.message === 'SOURCE_TIMEOUT';
    return {
      value: null,
      health: {
        state: timedOut ? 'timeout' : 'unavailable',
        durationMs: Date.now() - started,
        message: `${name} source ${timedOut ? 'timed out' : 'unavailable'}`,
      },
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
```

Use 10 seconds for QField and MinIO, and 5 seconds for FibreFlow, QA, sync, and
the cached-design reader. Resolve the project first, then start all six
independent source reads concurrently. Pass
`project.qfield.projectId` (external QField UUID) to both QField and QA readers;
retain `project.qfield.registrationId` only as link metadata.

- [ ] **Step 4: Implement primary/optional semantics and section shaping**

`loadQField` is primary. If it returns no value, throw:

```typescript
throw new ProjectStatsError(
  ErrorCode.SERVICE_UNAVAILABLE,
  'QField project statistics are currently unavailable',
  { requestId: context.requestId }
);
```

Build the QField infrastructure reducer from Task 5, replace the resolver's link
timestamp with `core_project.data_last_updated_at`, and compute freshness through
Task 2.

Shape the public project mapping as FibreFlow `{ id, code, name }` and QField
`{ id: project.qfield.projectId, name }`. Keep the internal
`registrationId` out of the response.

Merge FibreFlow counts only when that source succeeded. Normalize comparison
identities with `trim().toLowerCase()` and statuses with
`trim().toLowerCase()`; do not invent cross-domain status synonyms.
`synchronized` means the normalized identities and compared statuses match,
`needsSync` means an identity exists in both but a compared status differs, and
the `only` counts are set differences.

QA, sync, design, and MinIO fields remain `null` when their sources fail. When
the design cache is available, compute `designTotal` from its label set and
`neverCaptured` as cached labels absent from QField civil feature labels after
trimmed, case-insensitive normalization. When the cache has no row, both fields
remain `null` with a warning. MinIO success
sets referenced/present/missing counts; MinIO failure keeps present and missing
`null`, never zero. Add warnings from source health, stale freshness, missing
design data, unknown statuses, unmappable records, and system-scoped sync.

For `summary`, return aggregate objects without anomaly items. For a named
section, keep project/freshness/source metadata, populate the requested section,
and set unrelated section values to `null`. For `anomalies`, sort by
`occurredAt`, then `featureKey`, and slice using:

```typescript
const start = (query.page - 1) * query.limit;
const items = allAnomalies.slice(start, start + query.limit);
```

- [ ] **Step 5: Add structured timing logs**

Use the existing logger:

```typescript
log.info(
  'QField project statistics generated',
  {
    requestId: context.requestId,
    userId: context.userId,
    fibreflowProjectId: project.fibreflow.id,
    qfieldProjectId: project.qfield.projectId,
    section: query.section,
    resultStatus,
    sourceHealth,
  },
  'qfield-project-stats'
);
```

Do not log tokens, query credentials, response bodies, labels, or business
record payloads.

- [ ] **Step 6: Export the public surface**

```typescript
// index.ts
export { getProjectStats } from './projectStatsService';
export { parseProjectStatsQuery } from './request';
export { ProjectStatsError } from './errors';
export type { ProjectStatsContext, ProjectStatsDependencies } from './projectStatsService';
export type { ProjectStatsQuery, ProjectStatsResponse, ProjectStatsSection } from './types';
```

- [ ] **Step 7: Run service and all project-stat tests**

Run:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__
```

Expected: all Task 1-7 tests PASS.

- [ ] **Step 8: Commit Task 7**

```bash
git add src/modules/qfield-sync/project-stats
git commit -m "feat(qfield): aggregate project statistics safely"
```

---

### Task 8: Authenticated GET-only API route

**Files:**

- Create: `pages/api/qfield/project-stats.ts`
- Create: `tests/api/qfield/project-stats.test.ts`

**Interfaces:**

- Consumes: `parseProjectStatsQuery`, `getProjectStats`, and `ProjectStatsError`.
- Produces: `GET /api/qfield/project-stats`.
- Enforces: `withAuth(withPermission('projects', 'view')(handler))`.

- [ ] **Step 1: Write failing API tests**

Mock the service but test the real named handler and response envelope:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { getProjectStats } = vi.hoisted(() => ({
  getProjectStats: vi.fn(),
}));
vi.mock('@/modules/qfield-sync/project-stats', async () => {
  const actual = await vi.importActual<typeof import('@/modules/qfield-sync/project-stats')>(
    '@/modules/qfield-sync/project-stats'
  );
  return { ...actual, getProjectStats };
});

import { projectStatsHandler } from '@/pages/api/qfield/project-stats';

function request(method = 'GET', query: Record<string, string> = { project: 'Mahikeng' }) {
  const mocks = createMocks<NextApiRequest, NextApiResponse>({ method, query });
  Object.assign(mocks.req, {
    user: {
      id: 'u1',
      email: 'user@example.com',
      role: 'admin',
      permissions: ['projects.view'],
    },
  });
  return mocks;
}

describe('GET /api/qfield/project-stats', () => {
  beforeEach(() => getProjectStats.mockReset());

  it('returns the standard success envelope and request ID', async () => {
    getProjectStats.mockResolvedValue({ status: 'complete', generatedAt: 'now' });
    const { req, res } = request();
    await projectStatsHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toMatchObject({
      success: true,
      data: { status: 'complete' },
      meta: { requestId: expect.any(String) },
    });
    expect(res.getHeader('X-Request-Id')).toEqual(expect.any(String));
  });

  it('rejects non-GET methods', async () => {
    const { req, res } = request('POST');
    await projectStatsHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
  });

  it('maps safe domain errors without exposing stack traces', async () => {
    const { req, res } = request('GET', { project: '' });
    await projectStatsHandler(req, res);
    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData()).error.code).toBe('BAD_REQUEST');
    expect(res._getData()).not.toContain('stack');
  });
});
```

- [ ] **Step 2: Run API tests and verify RED**

Run:

```bash
npx vitest run tests/api/qfield/project-stats.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the route**

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { generateRequestId } from '@/lib/observability/requestId';
import { log } from '@/lib/logger';
import {
  getProjectStats,
  parseProjectStatsQuery,
  ProjectStatsError,
} from '@/modules/qfield-sync/project-stats';

export async function projectStatsHandler(req: NextApiRequest, res: NextApiResponse) {
  const requestId = generateRequestId();
  res.setHeader('X-Request-Id', requestId);

  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'unknown', ['GET']);
  }

  try {
    const query = parseProjectStatsQuery(req.query);
    const user = (req as AuthenticatedNextApiRequest).user;
    const result = await getProjectStats(query, {
      userId: user.id,
      userEmail: user.email,
      requestId,
    });
    return apiResponse.success(res, result, undefined, 200, { requestId });
  } catch (error) {
    if (error instanceof ProjectStatsError) {
      return apiResponse.error(res, error.code, error.message, error.details, { requestId });
    }
    log.error(
      'QField project statistics request failed',
      {
        requestId,
        errorType: error instanceof Error ? error.name : typeof error,
      },
      'qfield-project-stats-api'
    );
    return apiResponse.error(
      res,
      ErrorCode.INTERNAL_ERROR,
      'QField project statistics request failed',
      undefined,
      { requestId }
    );
  }
}

export default withAuth(withPermission('projects', 'view')(projectStatsHandler));
```

- [ ] **Step 4: Add API error-case tests**

Add service-error tests for `NOT_FOUND`, `CONFLICT` with safe candidates,
`VALIDATION_ERROR` for no active link, and `SERVICE_UNAVAILABLE`. Assert exact
HTTP status and `error.code` for each. `FORBIDDEN` is produced by the real
`withPermission` wrapper before this handler runs, so verify that behavior with
the existing middleware test suite rather than faking it as a domain error.

- [ ] **Step 5: Run API and module tests**

Run:

```bash
npx vitest run tests/api/qfield/project-stats.test.ts \
  src/modules/qfield-sync/project-stats/__tests__ \
  src/lib/auth/__tests__/withPermission.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit Task 8**

```bash
git add pages/api/qfield/project-stats.ts \
  tests/api/qfield/project-stats.test.ts
git commit -m "feat(api): expose QField project statistics"
```

---

### Task 9: Curated FastMCP QField tool

**Files:**

- Create: `apps/ff_mcp/qfield_tools.py`
- Create: `apps/ff_mcp/test_qfield_tools.py`
- Create: `apps/ff_mcp/test_qfield_tools_live.py`
- Modify: `apps/ff_mcp/server.py:194-196`
- Modify: `apps/ff_mcp/conftest.py:25-30`

**Interfaces:**

- Consumes: `_fibreflow_get_sync(path: str, query: str) -> str`.
- Produces: `get_qfield_project_stats(project, section='summary', page=1, limit=50)`.
- Preserves: existing token, rate-limit, timeout, response-size, and path guards.

- [ ] **Step 1: Write failing MCP adapter tests**

```python
from __future__ import annotations

import urllib.parse

import pytest


@pytest.mark.parametrize(
    "section",
    ["summary", "poles", "cables", "drops", "qa", "sync", "anomalies"],
)
def test_qfield_tool_calls_only_the_fixed_stats_endpoint(
    svc, monkeypatch, section
):
    from ff_mcp import qfield_tools

    seen = {}

    def fake_get(path: str, query: str = "") -> str:
        seen["path"] = path
        seen["query"] = urllib.parse.parse_qs(query)
        return '{"success":true}'

    monkeypatch.setattr(qfield_tools, "_fibreflow_get_sync", fake_get)
    body = qfield_tools._qfield_project_stats_sync(
        "Mahikeng", section, 2, 25
    )

    assert body == '{"success":true}'
    assert seen == {
        "path": "/api/qfield/project-stats",
        "query": {
            "project": ["Mahikeng"],
            "section": [section],
            "page": ["2"],
            "limit": ["25"],
        },
    }


def test_qfield_tool_defaults_to_summary(svc, monkeypatch):
    from ff_mcp import qfield_tools

    seen = {}

    def fake_get(path: str, query: str = "") -> str:
        seen.update(urllib.parse.parse_qs(query))
        return '{"success":true}'

    monkeypatch.setattr(qfield_tools, "_fibreflow_get_sync", fake_get)
    qfield_tools._qfield_project_stats_sync("Mahikeng")
    assert seen == {
        "project": ["Mahikeng"],
        "section": ["summary"],
        "page": ["1"],
        "limit": ["50"],
    }


@pytest.mark.anyio
async def test_qfield_tool_is_registered_with_load_bearing_description(svc):
    server, _ = svc
    tools = {tool.name: tool for tool in await server.mcp.list_tools()}
    tool = tools["get_qfield_project_stats"]
    assert "planted pole" in tool.description.lower()
    assert "qfield" in tool.description.lower()
    assert "use this tool" in tool.description.lower()
```

- [ ] **Step 2: Run MCP tests and verify RED**

Run:

```bash
FF_MCP_CALLBACK_SECRET=test-secret \
  python3 -m pytest apps/ff_mcp/test_qfield_tools.py -q
```

Expected: FAIL because `qfield_tools.py` and the registration import do not exist.

- [ ] **Step 3: Implement the thin adapter**

```python
"""Curated QField statistics tool backed by FibreFlow's authenticated GET API."""

from __future__ import annotations

import urllib.parse
from functools import partial
from typing import Literal

import anyio.to_thread

from .server import mcp
from .tools import _fibreflow_get_sync

Section = Literal[
    "summary", "poles", "cables", "drops", "qa", "sync", "anomalies"
]


def _qfield_project_stats_sync(
    project: str,
    section: Section = "summary",
    page: int = 1,
    limit: int = 50,
) -> str:
    query = urllib.parse.urlencode(
        {
            "project": project,
            "section": section,
            "page": page,
            "limit": limit,
        }
    )
    return _fibreflow_get_sync("/api/qfield/project-stats", query)


@mcp.tool()
async def get_qfield_project_stats(
    project: str,
    section: Section = "summary",
    page: int = 1,
    limit: int = 50,
) -> str:
    """Use this tool for QField, planted pole, cable, drop, QField QA, field-build,
    and QField sync-stat questions.

    Give a FibreFlow/QField project name, project code, or UUID. The default summary
    returns trustworthy aggregate counts, freshness, source health, and warnings.
    Use a named section for bounded drill-down. A planted pole means physically in
    the ground; missing photos or pending/failed QA do not make it unplanted.
    """
    return await anyio.to_thread.run_sync(
        partial(_qfield_project_stats_sync, project, section, page, limit)
    )
```

- [ ] **Step 4: Register and isolate the module in tests**

Append to `server.py` after the existing tool import:

```python
from . import qfield_tools as _qfield_tools  # noqa: E402,F401
```

Add `"ff_mcp.qfield_tools"` to the module-eviction tuple in `conftest.py` so each
test gets a fresh FastMCP registration and scratch OAuth store.

- [ ] **Step 5: Add an opt-in real dev adapter test**

Create `test_qfield_tools_live.py`. It is skipped in ordinary offline suites but
must run in Task 11 with a real short-lived dev token:

```python
from __future__ import annotations

import json
import os

import pytest


def test_qfield_tool_calls_real_dev_api(svc, monkeypatch):
    token = os.environ.get("FF_DEV_TOKEN")
    if not token:
        pytest.skip("FF_DEV_TOKEN is required for the live dev smoke")

    _, tools = svc
    from ff_mcp import qfield_tools

    monkeypatch.setattr(tools, "_access_token", lambda: token)
    body = json.loads(
        qfield_tools._qfield_project_stats_sync("Mahikeng", "summary", 1, 50)
    )

    assert body["success"] is True
    assert body["data"]["project"]["qfield"]["name"] == "HT_Mahikeng"
    assert isinstance(body["data"]["poles"]["planted"], int)
    assert body["data"]["sync"]["scope"] == "system"
```

The `svc` fixture already pins `FF_APP_BASE` to
`https://dev.fibreflow.app`. Never print the token or response body.

- [ ] **Step 6: Run the new and complete MCP suites**

Run:

```bash
FF_MCP_CALLBACK_SECRET=test-secret \
  python3 -m pytest apps/ff_mcp/test_qfield_tools.py -q

FF_MCP_CALLBACK_SECRET=test-secret \
  python3 -m pytest apps/ff_mcp/ -q
```

Expected: all MCP tests PASS with no duplicate-tool warnings.

- [ ] **Step 7: Commit Task 9**

```bash
git add apps/ff_mcp/qfield_tools.py apps/ff_mcp/test_qfield_tools.py \
  apps/ff_mcp/test_qfield_tools_live.py \
  apps/ff_mcp/server.py apps/ff_mcp/conftest.py
git commit -m "feat(mcp): add curated QField statistics tool"
```

---

### Task 10: Catalogue and QField documentation

**Files:**

- Modify: `apps/ff_mcp/test_catalogue.py`
- Modify: `apps/ff_mcp/endpoints.json`
- Modify: `src/modules/qfield-sync/.claude.md:7-29`
- Modify: `src/modules/qfield-sync/AGENTS.md`
- Modify: `.claude/modules/qfield-sync.md:21-49`

**Interfaces:**

- Consumes: the new Pages API route.
- Produces: catalogue discovery for `/api/qfield/project-stats`.
- Produces: canonical module documentation for future agents.

- [ ] **Step 1: Add a failing catalogue assertion**

```python
def test_catalogue_contains_qfield_project_stats(svc):
    from ff_mcp.catalogue import _load_routes

    routes = _load_routes()
    route = next(
        (item for item in routes if item["path"] == "/api/qfield/project-stats"),
        None,
    )
    assert route is not None
    assert route["methods"] == ["GET"]
```

- [ ] **Step 2: Run the catalogue test and verify RED**

Run:

```bash
FF_MCP_CALLBACK_SECRET=test-secret \
  python3 -m pytest apps/ff_mcp/test_catalogue.py::test_catalogue_contains_qfield_project_stats -q
```

Expected: FAIL because the generated JSON predates the new route.

- [ ] **Step 3: Regenerate the endpoint catalogue**

Run:

```bash
npm run mcp:catalogue
```

Inspect the generated entry and confirm:

```json
{
  "path": "/api/qfield/project-stats",
  "methods": ["GET"],
  "group": "qfield"
}
```

- [ ] **Step 4: Update canonical QField documentation**

Add the new API and service folder to both QField sync docs. Record these rules
verbatim:

```markdown
- Project statistics use QFieldCloud `core_delta` through the read-only pool.
- Never use the legacy `core_layer`/`core_feature` readers for statistics; those
  relations are absent in production and their callers currently produce false zeros.
- `poles planted` means the last applied physical-state event leaves the pole in
  the ground; photo and QA states do not change physical state.
- Sync-job statistics are system-scoped until the schema contains a project ID.
```

Add `GET /api/qfield/project-stats` to the endpoint tables.

- [ ] **Step 5: Regenerate and validate scoped AGENTS documentation**

Run:

```bash
node scripts/mirror-agents-md.mjs
npm run claude-md:check
```

Expected: `src/modules/qfield-sync/AGENTS.md` mirrors `.claude.md`, and every
documented source path resolves.

- [ ] **Step 6: Run catalogue and MCP tests**

Run:

```bash
FF_MCP_CALLBACK_SECRET=test-secret \
  python3 -m pytest apps/ff_mcp/test_catalogue.py apps/ff_mcp/test_qfield_tools.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit Task 10**

```bash
git add apps/ff_mcp/endpoints.json apps/ff_mcp/test_catalogue.py \
  src/modules/qfield-sync/.claude.md src/modules/qfield-sync/AGENTS.md \
  .claude/modules/qfield-sync.md
git commit -m "docs(qfield): document MCP project statistics"
```

---

### Task 11: Full verification, dev smoke, and PR handoff

**Files:**

- Verify all files changed by Tasks 1-10.
- No production deployment in this task.

**Interfaces:**

- Consumes: the complete feature.
- Produces: auditable test evidence, authenticated dev evidence, and a draft PR.

- [ ] **Step 1: Run focused TypeScript tests**

Run:

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__ \
  tests/api/qfield/project-stats.test.ts
```

Expected: all focused Vitest tests PASS with zero skipped tests.

- [ ] **Step 2: Run the complete MCP suite**

Run:

```bash
FF_MCP_CALLBACK_SECRET=test-secret \
  python3 -m pytest apps/ff_mcp/ -q
```

Expected: all MCP tests PASS.

- [ ] **Step 3: Run repository quality gates**

Run:

```bash
npm run ci:quick
npm run antihall
npm run claude-md:check
git diff --check origin/master...HEAD
```

Expected:

- CI quick exits zero;
- antihall exits zero;
- documentation paths validate;
- the diff has no whitespace errors.

Record pre-existing warnings separately; do not call them new failures.

- [ ] **Step 4: Review the final diff against the spec**

Run:

```bash
git diff --stat origin/master...HEAD
git diff --name-status origin/master...HEAD
```

Confirm:

- no migration file;
- no write endpoint or HTTP mutation;
- no edits under `/home/velo/fibreflow-dev` or `/home/velo/fibreflow-production`;
- no credential file;
- no customer names, addresses, geometry, photo bodies, or tokens in logs/results;
- PR 2 connector/session diagnostics are absent.

- [ ] **Step 5: Deploy the branch to dev through the mandatory script**

Run only after the code review checkpoint:

```bash
bash scripts/deploy-local.sh dev
```

Expected: dev deploy completes and `https://dev.fibreflow.app/api/health`
returns HTTP 200.

- [ ] **Step 6: Run authenticated dev API smoke tests**

Use a short-lived authenticated dev application token in the shell variable
`FF_DEV_TOKEN`. Do not print it. This does not reconnect the removed Claude
`FibreFlow Dev` connector and must not alter connector configuration:

```bash
curl -fsS \
  -H "Authorization: Bearer $FF_DEV_TOKEN" \
  -H 'Accept: application/json' \
  'https://dev.fibreflow.app/api/qfield/project-stats?project=Mahikeng&section=summary' \
  | jq '{
      success,
      status:.data.status,
      project:.data.project,
      freshness:.data.freshness,
      planted:.data.poles.planted,
      sourceHealth:.data.sourceHealth,
      warnings:.data.warnings
    }'
```

Verify that:

- the linked project is `HT_Mahikeng`;
- `planted` is non-null and is derived from physical-state history;
- every currently photo-incomplete planted pole remains included in `planted`;
- QField source health is `ok`;
- sync scope is `system`;
- no raw record payload is present.

Run a missing-project case:

```bash
curl -sS -o /tmp/qfield-project-stats-missing.json -w '%{http_code}\n' \
  -H "Authorization: Bearer $FF_DEV_TOKEN" \
  'https://dev.fibreflow.app/api/qfield/project-stats?project=NoSuchProject'
jq '{success,error}' /tmp/qfield-project-stats-missing.json
```

Expected: HTTP 404 with `error.code = "NOT_FOUND"`.

- [ ] **Step 7: Run the real MCP adapter against the dev API**

Run the opt-in test through the actual `_fibreflow_get_sync` HTTP path:

```bash
FF_MCP_CALLBACK_SECRET=test-secret \
  FF_DEV_TOKEN="$FF_DEV_TOKEN" \
  python3 -m pytest apps/ff_mcp/test_qfield_tools_live.py -q
```

Expected: PASS without a skip. This proves the curated MCP adapter, existing
token forwarding, fixed endpoint path, response guard, and dev API work
together. It does not reconnect or modify the removed Claude dev connector.

- [ ] **Step 8: Commit any evidence-driven correction and rerun its focused test**

If dev smoke reveals a defect, add a failing regression test first, verify RED,
make the minimal correction, verify GREEN, and commit only that correction:

```bash
git add path/to/regression.test.ts path/to/corrected-file.ts
git commit -m "fix(qfield): correct project statistics smoke regression"
```

If smoke passes without a correction, do not create an empty commit.

- [ ] **Step 9: Publish a draft PR through the approved GitHub workflow**

Invoke the `github:yeet` skill. Use `gh` only where the connected GitHub app
does not cover an operation. The draft PR must include:

- physical planted-pole definition;
- source and partial-result semantics;
- system-scoped sync limitation;
- exact test commands and counts;
- dev smoke evidence;
- no-migration and read-only statements; and
- an explicit note that production is not yet deployed.

- [ ] **Step 10: Stop at the production approval gate**

Do not run a production deploy. Request Hein's explicit approval after the PR is
reviewed and all checks pass. Once approved and after hours, the only permitted
command is:

```bash
bash scripts/deploy-local.sh production
```

After deployment, run the live production connector prompt and confirm the MCP
selects `get_qfield_project_stats` directly. That live connector smoke belongs to
the approved production-deployment turn, not this implementation plan.
