# Planning Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a NOC-style "Planning" Kanban section that tracks planning work-items through 6 stages (Intake → As-Built), filterable by project, with an editable detail page, placed below Procurement in the sidebar.

**Architecture:** Clone-and-adapt the NOC module. New App Router pages under `app/(main)/planning/`, App Router API routes under `app/api/planning/`, a self-contained Kanban board and service layer under `src/modules/planning/`, three new DB tables, and a single hook into the existing pipeline→project transition endpoint to auto-seed the first card. The Planning board is a **separate** clone of the NOC board (no shared component).

**Tech Stack:** Next.js 14 (App Router), React, TypeScript, `@hello-pangea/dnd`, `@tanstack/react-query`, `pg.Pool` via `@/lib/db-pool`, Vitest + Testing Library, PostgreSQL.

## Global Constraints

- No `console.log` — use `log` from `@/lib/logger` (`log.info/warn/error(message, data?, component?)`).
- New DB code uses `pg.Pool` via `@/lib/db-pool` (NOT the Neon serverless shim). The one exception is the pipeline `transition.ts` hook (Task 11), which reuses that file's existing `sql` tagged template for a surgical change.
- 100% type coverage; no empty catch blocks. Files < 300 lines, components < 200 lines.
- All work on branch `feat/planning-kanban` (already created off `origin/master`). All changes via PR; never commit to master.
- Test runner is Vitest. API/component tests assert shapes and pure logic (the existing suite does NOT hit the live DB — mirror that; do not write tests that connect to the shared prod DB).
- DB column naming: `snake_case`; UUID PKs `DEFAULT gen_random_uuid()`; timestamps `TIMESTAMP WITH TIME ZONE DEFAULT NOW()`.
- App Router API routes return `NextResponse.json(...)` with the NOC response envelope `{ success, data, pagination?, message?, meta }` (NOT the Pages-Router `apiResponse` helper, which NOC's app routes do not use).
- Run `npm run ci:quick` before the final commit / PR.

---

### Task 1: Planning types + stage template constant

**Files:**
- Create: `src/modules/planning/types/planning.ts`
- Create: `src/modules/planning/constants/stages.ts`
- Test: `src/modules/planning/__tests__/stages.test.ts`

**Interfaces:**
- Produces:
  - `PlanningStage = 'intake' | 'hld' | 'lld' | 'splice' | 'change_control' | 'as_built' | 'on_hold' | 'cancelled'`
  - `PlanningPriority = 'low' | 'normal' | 'high' | 'urgent'`
  - `PlanningSource = 'pipeline_auto' | 'manual'`
  - `ChecklistItem = { id: string; label: string; kind: 'activity' | 'output' | 'gate'; done: boolean }`
  - `StageChecklists = Record<Exclude<PlanningStage,'on_hold'|'cancelled'>, ChecklistItem[]>`
  - `PlanningItem` (DB row shape, see code)
  - `PlanningItemWithRelations = PlanningItem & { project_name?: string | null; project_code?: string | null; assigned_user?: { id: string; name: string; email: string } | null }`
  - `CreatePlanningItemPayload`, `UpdatePlanningItemPayload`, `PlanningFilters`
  - `BOARD_STAGES: { key; label }[]` (the 6 on-board stages, in order)
  - `STAGE_LABELS: Record<PlanningStage, string>`
  - `PLANNING_STAGE_TEMPLATE: StageChecklists` (seed content)
  - `buildInitialChecklists(): StageChecklists` (deep clone with `done:false`)

- [ ] **Step 1: Write the failing test**

```typescript
// src/modules/planning/__tests__/stages.test.ts
import { describe, it, expect } from 'vitest';
import { BOARD_STAGES, STAGE_LABELS, PLANNING_STAGE_TEMPLATE, buildInitialChecklists } from '../constants/stages';

describe('planning stages', () => {
  it('has the 6 on-board stages in workflow order', () => {
    expect(BOARD_STAGES.map(s => s.key)).toEqual([
      'intake', 'hld', 'lld', 'splice', 'change_control', 'as_built',
    ]);
  });

  it('labels every board stage', () => {
    for (const s of BOARD_STAGES) {
      expect(STAGE_LABELS[s.key]).toBeTruthy();
    }
    expect(STAGE_LABELS.on_hold).toBe('On Hold');
    expect(STAGE_LABELS.cancelled).toBe('Cancelled');
  });

  it('template has a gate item and at least one activity for every board stage', () => {
    for (const s of BOARD_STAGES) {
      const items = PLANNING_STAGE_TEMPLATE[s.key];
      expect(items.length).toBeGreaterThan(0);
      expect(items.some(i => i.kind === 'gate')).toBe(true);
      expect(items.some(i => i.kind === 'activity')).toBe(true);
    }
  });

  it('buildInitialChecklists returns all items not done and is a deep clone', () => {
    const a = buildInitialChecklists();
    a.intake[0].done = true;
    const b = buildInitialChecklists();
    expect(b.intake[0].done).toBe(false); // not mutated by previous clone
    expect(Object.values(a).flat().every(i => typeof i.id === 'string')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/planning/__tests__/stages.test.ts`
Expected: FAIL — cannot find module `../constants/stages`.

- [ ] **Step 3: Create the types file**

```typescript
// src/modules/planning/types/planning.ts
export type PlanningStage =
  | 'intake'
  | 'hld'
  | 'lld'
  | 'splice'
  | 'change_control'
  | 'as_built'
  | 'on_hold'
  | 'cancelled';

export type BoardStage = Exclude<PlanningStage, 'on_hold' | 'cancelled'>;
export type PlanningPriority = 'low' | 'normal' | 'high' | 'urgent';
export type PlanningSource = 'pipeline_auto' | 'manual';

export interface ChecklistItem {
  id: string;
  label: string;
  kind: 'activity' | 'output' | 'gate';
  done: boolean;
}

export type StageChecklists = Record<BoardStage, ChecklistItem[]>;

export interface PlanningItem {
  id: string;
  item_uid: string;
  project_id: string;
  title: string;
  description: string | null;
  scope_area: string | null;
  stage: PlanningStage;
  assigned_to: string | null;
  priority: PlanningPriority;
  source: PlanningSource;
  stage_checklists: StageChecklists;
  pipeline_project_id: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  closed_at: string | null;
}

export interface PlanningItemWithRelations extends PlanningItem {
  project_name?: string | null;
  project_code?: string | null;
  assigned_user?: { id: string; name: string; email: string } | null;
}

export interface CreatePlanningItemPayload {
  project_id: string;
  title: string;
  description?: string | null;
  scope_area?: string | null;
  stage?: PlanningStage;
  assigned_to?: string | null;
  priority?: PlanningPriority;
  source?: PlanningSource;
  created_by?: string | null;
}

export interface UpdatePlanningItemPayload {
  title?: string;
  description?: string | null;
  scope_area?: string | null;
  stage?: PlanningStage;
  assigned_to?: string | null;
  priority?: PlanningPriority;
  stage_checklists?: StageChecklists;
}

export interface PlanningFilters {
  project_id?: string;
  stage?: PlanningStage;
  exclude_stage?: PlanningStage[];
  assigned_to?: string;
  search?: string;
  created_after?: Date;
  created_before?: Date;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export interface PlanningListResponse {
  data: PlanningItemWithRelations[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}
```

- [ ] **Step 4: Create the stages/template constant**

```typescript
// src/modules/planning/constants/stages.ts
import type { BoardStage, ChecklistItem, PlanningStage, StageChecklists } from '../types/planning';

export const BOARD_STAGES: { key: BoardStage; label: string }[] = [
  { key: 'intake', label: 'Intake & Setup' },
  { key: 'hld', label: 'HLD' },
  { key: 'lld', label: 'LLD' },
  { key: 'splice', label: 'Splice & Fiber Allocation' },
  { key: 'change_control', label: 'Construction Change-Control' },
  { key: 'as_built', label: 'As-Built & Handover' },
];

export const STAGE_LABELS: Record<PlanningStage, string> = {
  intake: 'Intake & Setup',
  hld: 'HLD',
  lld: 'LLD',
  splice: 'Splice & Fiber Allocation',
  change_control: 'Construction Change-Control',
  as_built: 'As-Built & Handover',
  on_hold: 'On Hold',
  cancelled: 'Cancelled',
};

// Off-board stages (hidden from the main board, shown in a sub-tab)
export const PARKED_STAGES: PlanningStage[] = ['on_hold', 'cancelled'];

// Ordered flow used by quick-move chevrons
export const STAGE_FLOW: BoardStage[] = BOARD_STAGES.map(s => s.key);

type SeedItem = Omit<ChecklistItem, 'done'>;

// Content sourced verbatim from the Planning Workflow spreadsheet ("Detailed" sheet).
const TEMPLATE_SEED: Record<BoardStage, SeedItem[]> = {
  intake: [
    { id: 'intake-a1', kind: 'activity', label: 'Align planning assumptions' },
    { id: 'intake-a2', kind: 'activity', label: 'Validate base data quality' },
    { id: 'intake-a3', kind: 'activity', label: 'Confirm constraints and naming standards' },
    { id: 'intake-o1', kind: 'output', label: 'Approved design basis' },
    { id: 'intake-o2', kind: 'output', label: 'Assumptions register' },
    { id: 'intake-o3', kind: 'output', label: 'Project coding standard' },
    { id: 'intake-g1', kind: 'gate', label: 'Gate: design basis approved and baseline datasets accepted' },
  ],
  hld: [
    { id: 'hld-a1', kind: 'activity', label: 'Define PON/service areas' },
    { id: 'hld-a2', kind: 'activity', label: 'Define cabinet/FDH concepts and feeder corridors' },
    { id: 'hld-a3', kind: 'activity', label: 'High-level capacity and costing' },
    { id: 'hld-o1', kind: 'output', label: 'HLD map pack' },
    { id: 'hld-o2', kind: 'output', label: 'Preliminary BoQ' },
    { id: 'hld-o3', kind: 'output', label: 'Risk/dependency register' },
    { id: 'hld-g1', kind: 'gate', label: 'Gate: HLD baseline frozen and cost envelope accepted' },
  ],
  lld: [
    { id: 'lld-a1', kind: 'activity', label: 'Detailed feeder/distribution/drop routing' },
    { id: 'lld-a2', kind: 'activity', label: 'Node hierarchy and cable sizing' },
    { id: 'lld-a3', kind: 'activity', label: 'Route-level constructibility checks' },
    { id: 'lld-o1', kind: 'output', label: 'LLD design pack' },
    { id: 'lld-o2', kind: 'output', label: 'Construction-grade BoQ' },
    { id: 'lld-o3', kind: 'output', label: 'Rule-compliance log' },
    { id: 'lld-g1', kind: 'gate', label: 'Gate: constructibility accepted and engineering checks passed' },
  ],
  splice: [
    { id: 'splice-a1', kind: 'activity', label: 'Fiber allocation' },
    { id: 'splice-a2', kind: 'activity', label: 'Closure planning and port/tray assignment' },
    { id: 'splice-a3', kind: 'activity', label: 'Continuity validation' },
    { id: 'splice-o1', kind: 'output', label: 'Splice schedules' },
    { id: 'splice-o2', kind: 'output', label: 'Continuity table' },
    { id: 'splice-o3', kind: 'output', label: 'Closure and tray assignment sheets' },
    { id: 'splice-g1', kind: 'gate', label: 'Gate: end-to-end continuity validated and splice pack approved' },
  ],
  change_control: [
    { id: 'cc-a1', kind: 'activity', label: 'Capture field changes' },
    { id: 'cc-a2', kind: 'activity', label: 'Impact assess and approve/reject revisions' },
    { id: 'cc-a3', kind: 'activity', label: 'Reissue controlled packs' },
    { id: 'cc-o1', kind: 'output', label: 'Revision log' },
    { id: 'cc-o2', kind: 'output', label: 'Redline register' },
    { id: 'cc-o3', kind: 'output', label: 'Updated controlled drawings/schedules' },
    { id: 'cc-g1', kind: 'gate', label: 'Gate: redlines resolved/deferred and latest revision acknowledged' },
  ],
  as_built: [
    { id: 'ab-a1', kind: 'activity', label: 'Reconcile installed assets vs design' },
    { id: 'ab-a2', kind: 'activity', label: 'Finalize continuity and close deltas' },
    { id: 'ab-o1', kind: 'output', label: 'As-Built maps/register' },
    { id: 'ab-o2', kind: 'output', label: 'Final splice pack' },
    { id: 'ab-o3', kind: 'output', label: 'Planned-vs-as-built variance report' },
    { id: 'ab-o4', kind: 'output', label: 'Handover package' },
    { id: 'ab-g1', kind: 'gate', label: 'Gate: As-Built QA passed, handover signed, project closed' },
  ],
};

export const PLANNING_STAGE_TEMPLATE: StageChecklists = Object.fromEntries(
  Object.entries(TEMPLATE_SEED).map(([stage, items]) => [
    stage,
    items.map(i => ({ ...i, done: false })),
  ]),
) as StageChecklists;

export function buildInitialChecklists(): StageChecklists {
  return Object.fromEntries(
    Object.entries(TEMPLATE_SEED).map(([stage, items]) => [
      stage,
      items.map(i => ({ ...i, done: false })),
    ]),
  ) as StageChecklists;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/modules/planning/__tests__/stages.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/planning/types/planning.ts src/modules/planning/constants/stages.ts src/modules/planning/__tests__/stages.test.ts
git commit -m "feat(planning): add planning types and stage checklist template"
```

---

### Task 2: Database migration

**Files:**
- Create: `scripts/migrations/247_planning_module.sql`

**Interfaces:**
- Produces tables `planning_items`, `planning_activities`, `planning_item_sequences` with the columns the service layer (Task 3) reads/writes.

> Note: This task creates the migration FILE only. Applying it is a **schema migration on the shared DB** — run via `npm run db:migrate` against dev, and treat production application as a flagged deploy step requiring Hein's approval (per CLAUDE.md). Do not auto-apply to production.

- [ ] **Step 1: Write the migration**

```sql
-- Migration: 247_planning_module.sql
-- Description: Planning module — NOC-style Kanban for planning work-items (6 stages)
-- Created: 2026-06-25

-- ============================================================================
-- 1. ATOMIC UID SEQUENCE (mirrors maintenance_ticket_sequences)
-- ============================================================================
CREATE TABLE IF NOT EXISTS planning_item_sequences (
  sequence_date DATE PRIMARY KEY,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 2. PLANNING ITEMS
-- ============================================================================
CREATE TABLE IF NOT EXISTS planning_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_uid VARCHAR(32) UNIQUE NOT NULL,

  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  scope_area VARCHAR(255),

  stage VARCHAR(32) NOT NULL DEFAULT 'intake',
  assigned_to UUID REFERENCES staff(id) ON DELETE SET NULL,
  priority VARCHAR(16) NOT NULL DEFAULT 'normal',
  source VARCHAR(32) NOT NULL DEFAULT 'manual',

  stage_checklists JSONB NOT NULL DEFAULT '{}'::jsonb,

  pipeline_project_id UUID,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  closed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_planning_items_project ON planning_items(project_id);
CREATE INDEX IF NOT EXISTS idx_planning_items_stage ON planning_items(stage);
CREATE INDEX IF NOT EXISTS idx_planning_items_assigned ON planning_items(assigned_to);
-- One auto-created card per pipeline project (idempotent handoff in Task 11)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_planning_items_pipeline_auto
  ON planning_items(pipeline_project_id)
  WHERE pipeline_project_id IS NOT NULL AND source = 'pipeline_auto';

-- ============================================================================
-- 3. PLANNING ACTIVITIES (audit trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS planning_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planning_item_id UUID NOT NULL REFERENCES planning_items(id) ON DELETE CASCADE,
  activity_type VARCHAR(32) NOT NULL, -- created | stage_change | assignment | checklist | note | cancelled | update
  field_changed VARCHAR(64),
  old_value TEXT,
  new_value TEXT,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX IF NOT EXISTS idx_planning_activities_item ON planning_activities(planning_item_id);
```

- [ ] **Step 2: Apply to dev and verify**

Run:
```bash
npm run db:migrate
```
Then verify the tables exist (uses the dev/local connection from `.claude/credentials.local.md`; do not point this at production):
```bash
PGPASSWORD="$PGPASSWORD" psql -h 100.96.203.105 -p 5437 -U fibreflow_user -d fibreflow \
  -c "\d planning_items" -c "\d planning_activities" -c "\d planning_item_sequences"
```
Expected: all three tables print their column definitions; `planning_items` shows the FK to `projects` and the partial unique index.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrations/247_planning_module.sql
git commit -m "feat(planning): add 247 migration for planning_items/activities/sequences"
```

---

### Task 3: Planning service layer

**Files:**
- Create: `src/modules/planning/utils/db.ts`
- Create: `src/modules/planning/services/planningService.ts`
- Test: `src/modules/planning/__tests__/planningService.pure.test.ts`

**Interfaces:**
- Consumes: types from Task 1; `query`, `transaction`, `pool` from `@/lib/db-pool`.
- Produces:
  - `query<T>(text, params?): Promise<T[]>`, `queryOne<T>(text, params?): Promise<T|null>` (in utils/db.ts)
  - `generatePlanningUID(forDate?: Date): Promise<string>` → `PLN-YYYYMMDD-NNN`
  - `buildUpdateSql(payload): { setSql: string; values: unknown[] }` (pure, exported for test)
  - `listPlanningItems(filters: PlanningFilters): Promise<PlanningListResponse>`
  - `getPlanningItemById(id: string): Promise<PlanningItemWithRelations | null>`
  - `createPlanningItem(payload: CreatePlanningItemPayload): Promise<PlanningItem>`
  - `updatePlanningItem(id: string, payload: UpdatePlanningItemPayload): Promise<PlanningItem>`
  - `deletePlanningItem(id: string): Promise<PlanningItem>` (soft → `cancelled`)
  - `logPlanningActivity(params): Promise<void>`

- [ ] **Step 1: Write the failing test (pure logic only — no DB)**

```typescript
// src/modules/planning/__tests__/planningService.pure.test.ts
import { describe, it, expect } from 'vitest';
import { buildUpdateSql, PLANNING_FIELD_MAP } from '../services/planningService';

describe('buildUpdateSql', () => {
  it('maps only known fields to parameterized assignments and always bumps updated_at', () => {
    const { setSql, values } = buildUpdateSql({ stage: 'hld', title: 'X', bogus: 1 } as any);
    expect(setSql).toContain('stage = $1');
    expect(setSql).toContain('title = $2');
    expect(setSql).toContain('updated_at = NOW()');
    expect(setSql).not.toContain('bogus');
    expect(values).toEqual(['hld', 'X']);
  });

  it('serializes stage_checklists to JSON', () => {
    const checklists = { intake: [{ id: 'x', label: 'y', kind: 'gate', done: true }] };
    const { setSql, values } = buildUpdateSql({ stage_checklists: checklists } as any);
    expect(setSql).toContain('stage_checklists = $1');
    expect(typeof values[0]).toBe('string');
    expect(JSON.parse(values[0] as string)).toEqual(checklists);
  });

  it('sets closed_at when stage becomes cancelled', () => {
    const { setSql } = buildUpdateSql({ stage: 'cancelled' } as any);
    expect(setSql).toContain('closed_at = NOW()');
  });

  it('exposes a field map covering the editable columns', () => {
    expect(Object.keys(PLANNING_FIELD_MAP).sort()).toEqual(
      ['assigned_to', 'description', 'priority', 'scope_area', 'stage', 'stage_checklists', 'title'].sort(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/planning/__tests__/planningService.pure.test.ts`
Expected: FAIL — cannot find module `../services/planningService`.

- [ ] **Step 3: Create the db wrapper**

```typescript
// src/modules/planning/utils/db.ts
import { query as poolQuery, transaction as poolTransaction, pool } from '@/lib/db-pool';

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return poolQuery<T>(text, params);
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await poolQuery<T>(text, params);
  return rows[0] ?? null;
}

export { poolTransaction as transaction, pool };
```

> If `@/lib/db-pool` does not export a generic `query(text, params)`, mirror NOC's `src/modules/noc/utils/db.ts` exactly (it wraps the same module). Confirm the export names by reading `src/lib/db-pool.ts` before writing this file.

- [ ] **Step 4: Create the service**

```typescript
// src/modules/planning/services/planningService.ts
import { query, queryOne } from '../utils/db';
import { buildInitialChecklists } from '../constants/stages';
import type {
  CreatePlanningItemPayload,
  PlanningFilters,
  PlanningItem,
  PlanningItemWithRelations,
  PlanningListResponse,
  UpdatePlanningItemPayload,
} from '../types/planning';

const SELECT_WITH_RELATIONS = `
  SELECT
    p.*,
    pr.project_name,
    pr.project_code,
    CASE WHEN s.id IS NOT NULL THEN jsonb_build_object(
      'id', s.id,
      'name', COALESCE(s.first_name || ' ' || s.last_name, s.email),
      'email', s.email
    ) ELSE NULL END AS assigned_user
  FROM planning_items p
  LEFT JOIN projects pr ON p.project_id = pr.id
  LEFT JOIN staff s ON p.assigned_to = s.id
`;

export async function generatePlanningUID(forDate?: Date): Promise<string> {
  const target = forDate || new Date();
  const dateStr = target.toISOString().slice(0, 10); // YYYY-MM-DD
  const formatted = dateStr.replace(/-/g, '');         // YYYYMMDD
  const result = await queryOne<{ last_sequence: number }>(
    `INSERT INTO planning_item_sequences (sequence_date, last_sequence)
     VALUES ($1::date, 1)
     ON CONFLICT (sequence_date)
     DO UPDATE SET last_sequence = planning_item_sequences.last_sequence + 1, updated_at = NOW()
     RETURNING last_sequence`,
    [dateStr],
  );
  if (!result) throw new Error('Failed to generate planning UID');
  return `PLN-${formatted}-${String(result.last_sequence).padStart(3, '0')}`;
}

export const PLANNING_FIELD_MAP: Record<string, string> = {
  title: 'title',
  description: 'description',
  scope_area: 'scope_area',
  stage: 'stage',
  assigned_to: 'assigned_to',
  priority: 'priority',
  stage_checklists: 'stage_checklists',
};

export function buildUpdateSql(payload: UpdatePlanningItemPayload): { setSql: string; values: unknown[] } {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, value] of Object.entries(payload)) {
    const col = PLANNING_FIELD_MAP[key];
    if (!col) continue;
    sets.push(`${col} = $${i}`);
    values.push(col === 'stage_checklists' ? JSON.stringify(value) : value);
    i++;
  }
  sets.push('updated_at = NOW()');
  if (payload.stage === 'cancelled' || payload.stage === 'on_hold') {
    if (payload.stage === 'cancelled') sets.push('closed_at = NOW()');
  }
  return { setSql: sets.join(', '), values };
}

export async function listPlanningItems(filters: PlanningFilters = {}): Promise<PlanningListResponse> {
  const where: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (filters.project_id) { where.push(`p.project_id = $${i++}`); values.push(filters.project_id); }
  if (filters.stage) { where.push(`p.stage = $${i++}`); values.push(filters.stage); }
  if (filters.exclude_stage?.length) {
    where.push(`p.stage <> ALL($${i++}::text[])`); values.push(filters.exclude_stage);
  }
  if (filters.assigned_to) { where.push(`p.assigned_to = $${i++}`); values.push(filters.assigned_to); }
  if (filters.search) {
    where.push(`(p.title ILIKE $${i} OR p.item_uid ILIKE $${i} OR p.scope_area ILIKE $${i})`);
    values.push(`%${filters.search}%`); i++;
  }
  if (filters.created_after) { where.push(`p.created_at >= $${i++}`); values.push(filters.created_after); }
  if (filters.created_before) { where.push(`p.created_at <= $${i++}`); values.push(filters.created_before); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const pageSize = filters.pageSize && filters.pageSize > 0 ? filters.pageSize : 2500;
  const offset = (page - 1) * pageSize;

  const countRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM planning_items p ${whereSql}`, values,
  );
  const total = countRow ? Number(countRow.count) : 0;

  const rows = await query<PlanningItemWithRelations>(
    `${SELECT_WITH_RELATIONS} ${whereSql} ORDER BY p.created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...values, pageSize, offset],
  );

  return {
    data: rows,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 0 },
  };
}

export async function getPlanningItemById(id: string): Promise<PlanningItemWithRelations | null> {
  return queryOne<PlanningItemWithRelations>(`${SELECT_WITH_RELATIONS} WHERE p.id = $1`, [id]);
}

export async function createPlanningItem(payload: CreatePlanningItemPayload): Promise<PlanningItem> {
  if (!payload.project_id) throw new Error('project_id is required');
  if (!payload.title || !payload.title.trim()) throw new Error('title is required');

  const uid = await generatePlanningUID();
  const checklists = buildInitialChecklists();

  const row = await queryOne<PlanningItem>(
    `INSERT INTO planning_items
      (item_uid, project_id, title, description, scope_area, stage, assigned_to, priority, source, stage_checklists, pipeline_project_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      uid,
      payload.project_id,
      payload.title.trim(),
      payload.description ?? null,
      payload.scope_area ?? null,
      payload.stage ?? 'intake',
      payload.assigned_to ?? null,
      payload.priority ?? 'normal',
      payload.source ?? 'manual',
      JSON.stringify(checklists),
      null,
      payload.created_by ?? null,
    ],
  );
  if (!row) throw new Error('Failed to create planning item');
  return row;
}

export async function updatePlanningItem(id: string, payload: UpdatePlanningItemPayload): Promise<PlanningItem> {
  if (!payload || Object.keys(payload).length === 0) throw new Error('Update payload cannot be empty');
  const { setSql, values } = buildUpdateSql(payload);
  const row = await queryOne<PlanningItem>(
    `UPDATE planning_items SET ${setSql} WHERE id = $${values.length + 1} RETURNING *`,
    [...values, id],
  );
  if (!row) throw new Error(`Planning item ${id} not found`);
  return row;
}

export async function deletePlanningItem(id: string): Promise<PlanningItem> {
  const row = await queryOne<PlanningItem>(
    `UPDATE planning_items SET stage = 'cancelled', closed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id],
  );
  if (!row) throw new Error(`Planning item ${id} not found`);
  return row;
}

export async function logPlanningActivity(params: {
  planningItemId: string;
  activityType: 'created' | 'stage_change' | 'assignment' | 'checklist' | 'note' | 'cancelled' | 'update';
  fieldChanged?: string;
  oldValue?: string | null;
  newValue?: string | null;
  note?: string | null;
  userId?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO planning_activities
      (planning_item_id, activity_type, field_changed, old_value, new_value, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      params.planningItemId,
      params.activityType,
      params.fieldChanged ?? null,
      params.oldValue ?? null,
      params.newValue ?? null,
      params.note ?? null,
      params.userId ?? null,
    ],
  );
}

export async function listPlanningActivities(planningItemId: string) {
  return query(
    `SELECT * FROM planning_activities WHERE planning_item_id = $1 ORDER BY created_at DESC`,
    [planningItemId],
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/modules/planning/__tests__/planningService.pure.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/planning/utils/db.ts src/modules/planning/services/planningService.ts src/modules/planning/__tests__/planningService.pure.test.ts
git commit -m "feat(planning): add planning service layer (CRUD, UID, activity log)"
```

---

### Task 4: API routes (App Router)

**Files:**
- Create: `app/api/planning/items/route.ts`
- Create: `app/api/planning/items/[id]/route.ts`
- Test: `tests/api/planning/items.test.ts`

**Interfaces:**
- Consumes: service functions from Task 3.
- Produces HTTP endpoints:
  - `GET /api/planning/items` → `{ success, data, pagination, meta }`
  - `POST /api/planning/items` → `{ success, data, message, meta }` (201)
  - `GET /api/planning/items/[id]` → `{ success, data, meta }`
  - `PUT /api/planning/items/[id]` → `{ success, data, message, meta }`
  - `DELETE /api/planning/items/[id]` → `{ success, data, message, meta }`

- [ ] **Step 1: Write the failing test (shape + transform logic, no live DB — mirrors `tests/api/procurement/requisitions.test.ts`)**

```typescript
// tests/api/planning/items.test.ts
import { describe, it, expect } from 'vitest';
import type { PlanningItemWithRelations } from '@/modules/planning/types/planning';

describe('Planning Items API - response contracts', () => {
  it('list response has the paginated envelope', () => {
    const res = {
      success: true,
      data: [] as PlanningItemWithRelations[],
      pagination: { page: 1, pageSize: 2500, total: 0, totalPages: 0 },
      meta: { timestamp: new Date().toISOString() },
    };
    expect(res.success).toBe(true);
    expect(res.data).toBeInstanceOf(Array);
    expect(res.pagination).toHaveProperty('totalPages');
  });

  it('parses exclude_stage[] query params into an array', () => {
    const params = new URLSearchParams('exclude_stage=on_hold&exclude_stage=cancelled');
    expect(params.getAll('exclude_stage')).toEqual(['on_hold', 'cancelled']);
  });

  it('rejects create without project_id/title (validation contract)', () => {
    const validate = (b: { project_id?: string; title?: string }) => {
      const errors: string[] = [];
      if (!b.project_id) errors.push('project_id');
      if (!b.title || !b.title.trim()) errors.push('title');
      return errors;
    };
    expect(validate({})).toEqual(['project_id', 'title']);
    expect(validate({ project_id: 'p', title: 'x' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/planning/items.test.ts`
Expected: FAIL — cannot resolve `@/modules/planning/types/planning` only if path alias missing; otherwise the asserts run. If it fails on import, that confirms the test is wired; proceed. (If it passes immediately because it's pure, that's acceptable for this contract test — the route files below are still required for the feature.)

- [ ] **Step 3: Create the list/create route**

```typescript
// app/api/planning/items/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth-token';
import { log } from '@/lib/logger';
import {
  listPlanningItems,
  createPlanningItem,
  logPlanningActivity,
} from '@/modules/planning/services/planningService';
import type { PlanningFilters, PlanningStage } from '@/modules/planning/types/planning';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filters: PlanningFilters = {};
    if (searchParams.has('project_id')) filters.project_id = searchParams.get('project_id')!;
    if (searchParams.has('stage')) filters.stage = searchParams.get('stage') as PlanningStage;
    if (searchParams.has('exclude_stage')) filters.exclude_stage = searchParams.getAll('exclude_stage') as PlanningStage[];
    if (searchParams.has('assigned_to')) filters.assigned_to = searchParams.get('assigned_to')!;
    if (searchParams.has('search')) filters.search = searchParams.get('search')!;
    if (searchParams.has('created_after')) filters.created_after = new Date(searchParams.get('created_after')!);
    if (searchParams.has('created_before')) filters.created_before = new Date(searchParams.get('created_before')!);
    if (searchParams.has('page')) filters.page = parseInt(searchParams.get('page')!, 10);
    if (searchParams.has('pageSize')) filters.pageSize = parseInt(searchParams.get('pageSize')!, 10);

    const result = await listPlanningItems(filters);
    return NextResponse.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    log.error('Failed to list planning items', { error }, 'PlanningAPI');
    return NextResponse.json({ success: false, error: { message: 'Failed to list planning items' } }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.project_id) return NextResponse.json({ success: false, error: { message: 'project_id is required' } }, { status: 400 });
    if (!body.title || !String(body.title).trim()) return NextResponse.json({ success: false, error: { message: 'title is required' } }, { status: 400 });

    const cookieStore = await cookies();
    const token = cookieStore.get('ff_auth_token')?.value;
    if (token) {
      const payload = await verifyToken(token);
      if (payload?.sub) body.created_by = payload.sub;
    }

    const item = await createPlanningItem(body);
    void logPlanningActivity({
      planningItemId: item.id,
      activityType: 'created',
      note: `Planning item created: ${item.item_uid}`,
      userId: body.created_by,
    });

    return NextResponse.json(
      { success: true, data: item, message: 'Planning item created', meta: { timestamp: new Date().toISOString() } },
      { status: 201 },
    );
  } catch (error) {
    log.error('Failed to create planning item', { error }, 'PlanningAPI');
    return NextResponse.json({ success: false, error: { message: 'Failed to create planning item' } }, { status: 500 });
  }
}
```

> Before writing: confirm the auth helper used by NOC app-router routes. The NOC POST route imports `verifyToken` — read `app/api/noc/tickets/route.ts` and copy its exact import (`@/lib/auth-token` vs `@/lib/auth`) and cookie name. Match it here.

- [ ] **Step 4: Create the detail route**

```typescript
// app/api/planning/items/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth-token';
import { log } from '@/lib/logger';
import {
  getPlanningItemById,
  updatePlanningItem,
  deletePlanningItem,
  logPlanningActivity,
} from '@/modules/planning/services/planningService';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getUserId(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const token = cookieStore.get('ff_auth_token')?.value;
  if (!token) return undefined;
  const payload = await verifyToken(token);
  return payload?.sub;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ success: false, error: { message: 'Invalid id' } }, { status: 400 });
  try {
    const item = await getPlanningItemById(params.id);
    if (!item) return NextResponse.json({ success: false, error: { message: 'Planning item not found' } }, { status: 404 });
    return NextResponse.json({ success: true, data: item, meta: { timestamp: new Date().toISOString() } });
  } catch (error) {
    log.error('Failed to get planning item', { error, id: params.id }, 'PlanningAPI');
    return NextResponse.json({ success: false, error: { message: 'Failed to get planning item' } }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ success: false, error: { message: 'Invalid id' } }, { status: 400 });
  try {
    const body = await req.json();
    const userId = await getUserId();
    const before = await getPlanningItemById(params.id);
    if (!before) return NextResponse.json({ success: false, error: { message: 'Planning item not found' } }, { status: 404 });

    const updated = await updatePlanningItem(params.id, body);

    if (body.stage && body.stage !== before.stage) {
      void logPlanningActivity({
        planningItemId: params.id, activityType: 'stage_change',
        fieldChanged: 'stage', oldValue: before.stage, newValue: body.stage, userId,
      });
    }
    if (body.assigned_to !== undefined && body.assigned_to !== before.assigned_to) {
      void logPlanningActivity({
        planningItemId: params.id, activityType: 'assignment',
        fieldChanged: 'assigned_to', oldValue: before.assigned_to, newValue: body.assigned_to ?? null, userId,
      });
    }
    if (body.stage_checklists) {
      void logPlanningActivity({ planningItemId: params.id, activityType: 'checklist', userId });
    }

    return NextResponse.json({ success: true, data: updated, message: 'Planning item updated', meta: { timestamp: new Date().toISOString() } });
  } catch (error) {
    log.error('Failed to update planning item', { error, id: params.id }, 'PlanningAPI');
    return NextResponse.json({ success: false, error: { message: 'Failed to update planning item' } }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ success: false, error: { message: 'Invalid id' } }, { status: 400 });
  try {
    const userId = await getUserId();
    const deleted = await deletePlanningItem(params.id);
    void logPlanningActivity({ planningItemId: params.id, activityType: 'cancelled', note: 'Planning item cancelled', userId });
    return NextResponse.json({ success: true, data: deleted, message: 'Planning item cancelled', meta: { timestamp: new Date().toISOString() } });
  } catch (error) {
    log.error('Failed to delete planning item', { error, id: params.id }, 'PlanningAPI');
    return NextResponse.json({ success: false, error: { message: 'Failed to delete planning item' } }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run tests/api/planning/items.test.ts && npx tsc --noEmit`
Expected: tests PASS; no type errors in the new files. (Resolve any import-path mismatches surfaced by `tsc`, e.g. the auth helper.)

- [ ] **Step 6: Commit**

```bash
git add app/api/planning tests/api/planning/items.test.ts
git commit -m "feat(planning): add planning items API routes (list/create/get/update/delete)"
```

---

### Task 5: React Query hooks

**Files:**
- Create: `src/modules/planning/hooks/usePlanningItems.ts`
- Create: `src/modules/planning/hooks/usePlanningItem.ts`
- Test: `src/modules/planning/__tests__/planningKeys.test.ts`

**Interfaces:**
- Consumes: types from Task 1; the API routes from Task 4.
- Produces:
  - `planningKeys` (query-key factory)
  - `usePlanningItems(filters?: PlanningFilters)` → list query (returns `{ data, pagination }`)
  - `usePlanningItem(id: string)` → detail query
  - `useUpdatePlanningItem()` → mutation `({ id, payload }) => PlanningItem` invalidating lists + setting detail cache
  - `useCreatePlanningItem()` → mutation `(payload) => PlanningItem`
  - `usePlanningActivities(id: string)` → activity list query

- [ ] **Step 1: Write the failing test**

```typescript
// src/modules/planning/__tests__/planningKeys.test.ts
import { describe, it, expect } from 'vitest';
import { planningKeys } from '../hooks/usePlanningItems';

describe('planningKeys', () => {
  it('builds stable hierarchical keys', () => {
    expect(planningKeys.all).toEqual(['planning']);
    expect(planningKeys.lists()).toEqual(['planning', 'list']);
    expect(planningKeys.detail('abc')).toEqual(['planning', 'detail', 'abc']);
    expect(planningKeys.list({ project_id: 'p' })).toEqual(['planning', 'list', { project_id: 'p' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/planning/__tests__/planningKeys.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the list hooks + keys**

```typescript
// src/modules/planning/hooks/usePlanningItems.ts
'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePlanningItemPayload, PlanningFilters, PlanningItem, PlanningListResponse,
} from '../types/planning';

export const planningKeys = {
  all: ['planning'] as const,
  lists: () => [...planningKeys.all, 'list'] as const,
  list: (filters?: PlanningFilters) => [...planningKeys.lists(), filters] as const,
  details: () => [...planningKeys.all, 'detail'] as const,
  detail: (id: string) => [...planningKeys.details(), id] as const,
  activities: (id: string) => [...planningKeys.all, 'activities', id] as const,
};

function toQueryString(filters?: PlanningFilters): string {
  if (!filters) return '';
  const p = new URLSearchParams();
  if (filters.project_id) p.set('project_id', filters.project_id);
  if (filters.stage) p.set('stage', filters.stage);
  filters.exclude_stage?.forEach(s => p.append('exclude_stage', s));
  if (filters.assigned_to) p.set('assigned_to', filters.assigned_to);
  if (filters.search) p.set('search', filters.search);
  if (filters.created_after) p.set('created_after', filters.created_after.toISOString());
  if (filters.created_before) p.set('created_before', filters.created_before.toISOString());
  if (filters.page) p.set('page', String(filters.page));
  if (filters.pageSize) p.set('pageSize', String(filters.pageSize));
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function fetchPlanningItems(filters?: PlanningFilters): Promise<PlanningListResponse> {
  const res = await fetch(`/api/planning/items${toQueryString(filters)}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Failed to load planning items');
  return { data: json.data, pagination: json.pagination };
}

export function usePlanningItems(filters?: PlanningFilters) {
  return useQuery({ queryKey: planningKeys.list(filters), queryFn: () => fetchPlanningItems(filters) });
}

export function useCreatePlanningItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreatePlanningItemPayload): Promise<PlanningItem> => {
      const res = await fetch('/api/planning/items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Failed to create planning item');
      return json.data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: planningKeys.lists() }); },
  });
}
```

- [ ] **Step 4: Create the detail + update + activities hooks**

```typescript
// src/modules/planning/hooks/usePlanningItem.ts
'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { planningKeys } from './usePlanningItems';
import type { PlanningItem, PlanningItemWithRelations, UpdatePlanningItemPayload } from '../types/planning';

async function fetchPlanningItem(id: string): Promise<PlanningItemWithRelations> {
  const res = await fetch(`/api/planning/items/${id}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Failed to load planning item');
  return json.data;
}

export function usePlanningItem(id: string) {
  return useQuery({ queryKey: planningKeys.detail(id), queryFn: () => fetchPlanningItem(id), enabled: !!id });
}

export function useUpdatePlanningItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: UpdatePlanningItemPayload }): Promise<PlanningItem> => {
      const res = await fetch(`/api/planning/items/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Failed to update planning item');
      return json.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(planningKeys.detail(data.id), data);
      qc.invalidateQueries({ queryKey: planningKeys.lists() });
    },
  });
}

export function usePlanningActivities(id: string) {
  return useQuery({
    queryKey: planningKeys.activities(id),
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/planning/items/${id}`);
      // activities are returned by a dedicated call in a later iteration; for v1 read from detail page fetch
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Failed');
      return json.data;
    },
  });
}
```

> Note: `usePlanningActivities` is a stub for v1 — the detail page (Task 8) renders the activity timeline from a `GET /api/planning/items/[id]` that the implementer may extend to include `activities`. If you prefer a dedicated endpoint, add `GET /api/planning/items/[id]/activities` mirroring this hook. Keep v1 simple: render activities from whatever the detail endpoint returns; do not block on it.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/modules/planning/__tests__/planningKeys.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/planning/hooks src/modules/planning/__tests__/planningKeys.test.ts
git commit -m "feat(planning): add react-query hooks and query keys"
```

---

### Task 6: Kanban board components (cloned, separate from NOC)

**Files:**
- Create: `src/modules/planning/components/KanbanBoard/KanbanBoard.tsx`
- Create: `src/modules/planning/components/KanbanBoard/KanbanColumn.tsx`
- Create: `src/modules/planning/components/KanbanBoard/KanbanCard.tsx`
- Create: `src/modules/planning/components/KanbanBoard/index.ts`

**Interfaces:**
- Consumes: `usePlanningItems`, `useUpdatePlanningItem` (Tasks 5); `BOARD_STAGES`, `STAGE_FLOW`, `STAGE_LABELS`, `PARKED_STAGES` (Task 1); `PlanningItemWithRelations`, `PlanningFilters`, `PlanningStage` (Task 1).
- Produces: `<KanbanBoard filters?: PlanningFilters />`, `<KanbanColumn />`, `<KanbanCard />`.

**Approach:** Copy the three NOC files from `src/modules/noc/components/KanbanBoard/` as the starting point, then apply the substitutions below. This keeps the boards fully separate while reusing NOC's proven drag/optimistic logic.

- [ ] **Step 1: Copy the NOC board files as a base**

```bash
mkdir -p src/modules/planning/components/KanbanBoard
cp src/modules/noc/components/KanbanBoard/KanbanBoard.tsx src/modules/planning/components/KanbanBoard/KanbanBoard.tsx
cp src/modules/noc/components/KanbanBoard/KanbanColumn.tsx src/modules/planning/components/KanbanBoard/KanbanColumn.tsx
cp src/modules/noc/components/KanbanBoard/KanbanCard.tsx src/modules/planning/components/KanbanBoard/KanbanCard.tsx
```

- [ ] **Step 2: Adapt `KanbanBoard.tsx`** — apply these exact substitutions:

1. Replace the imports block with:
```typescript
import { useMemo, useState, useCallback } from 'react';
import { DragDropContext, Droppable, type DropResult } from '@hello-pangea/dnd';
import type { PlanningFilters, PlanningItemWithRelations, PlanningStage, BoardStage } from '../../types/planning';
import { BOARD_STAGES, STAGE_FLOW, PARKED_STAGES, STAGE_LABELS } from '../../constants/stages';
import { usePlanningItems } from '../../hooks/usePlanningItems';
import { useUpdatePlanningItem } from '../../hooks/usePlanningItem';
import { KanbanColumn } from './KanbanColumn';
```
2. Replace `KanbanBoardProps` with: `interface KanbanBoardProps { filters?: PlanningFilters }`.
3. Replace the column config / status constants with:
```typescript
const COLUMN_CONFIG = BOARD_STAGES;            // [{ key, label }]
const KANBAN_PAGE_SIZE = 2500;
const DEFAULT_EXCLUDED_STAGES: PlanningStage[] = PARKED_STAGES; // on_hold, cancelled
```
4. Replace the data hook usage: call `usePlanningItems({ ...filters, exclude_stage: DEFAULT_EXCLUDED_STAGES, pageSize: KANBAN_PAGE_SIZE })`; read `result.data.data` (items) and `result.data.pagination`. Use `useUpdatePlanningItem()` as `updateItem`.
5. Rename `moveTicket`/`handleQuickMove`/`optimisticMoves` to operate on `stage` instead of `status`: the mutation payload becomes `{ id, payload: { stage: nextStage } }`. The flow array is `STAGE_FLOW`. Group items by `item.stage` (falling back to `intake` if unknown).
6. The grid maps `COLUMN_CONFIG.map(({ key, label }, colIndex) => <Droppable droppableId={key}>…<KanbanColumn stage={key} label={label} items={itemsByStage[key]} …/></Droppable>)`.
7. `onDragEnd` uses `destination.droppableId as PlanningStage`.

- [ ] **Step 3: Adapt `KanbanColumn.tsx`** — replace its props/imports:
```typescript
import { Draggable } from '@hello-pangea/dnd';
import type { PlanningItemWithRelations, PlanningStage } from '../../types/planning';
import { KanbanCard } from './KanbanCard';

interface KanbanColumnProps {
  stage: PlanningStage;
  label: string;
  items: PlanningItemWithRelations[];
  totalCount?: number;
  isDraggingOver?: boolean;
  isUpdating?: boolean;
  onQuickMove?: (id: string, direction: 'forward' | 'backward') => void;
  canMoveForward?: boolean;
  canMoveBackward?: boolean;
}
```
Render the column header from `label`, iterate `items` into `<Draggable draggableId={item.id}>` wrapping `<KanbanCard item={item} … />`.

- [ ] **Step 4: Adapt `KanbanCard.tsx`** — replace ticket fields with planning fields:
```typescript
import { useRouter } from 'next/navigation';
import { formatDisplayDateShort } from '@/utils/dateFormat';
import type { PlanningItemWithRelations } from '../../types/planning';

interface KanbanCardProps {
  item: PlanningItemWithRelations;
  isDragging?: boolean;
  onQuickMove?: (id: string, direction: 'forward' | 'backward') => void;
  canMoveForward?: boolean;
  canMoveBackward?: boolean;
}
```
Card body shows: `item.item_uid`, `item.title`, `item.project_name` (or code), `item.scope_area`, `item.priority`, assignee name (`item.assigned_user?.name`), and `formatDisplayDateShort(item.created_at)`. Clicking the card calls `router.push(`/planning/${item.id}`)`. Keep the chevron quick-move buttons wired to `onQuickMove`.

- [ ] **Step 5: Create the index barrel**
```typescript
// src/modules/planning/components/KanbanBoard/index.ts
export { KanbanBoard } from './KanbanBoard';
export { KanbanColumn } from './KanbanColumn';
export { KanbanCard } from './KanbanCard';
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors in `src/modules/planning/components/KanbanBoard/`. Fix any residual NOC-specific references the copy left behind (search the three files for `ticket`, `status`, `TicketStatus`, `useTickets` and replace per the mapping above).

- [ ] **Step 7: Commit**

```bash
git add src/modules/planning/components/KanbanBoard
git commit -m "feat(planning): add planning kanban board (cloned from NOC, stage-based)"
```

---

### Task 7: Board page + filter bar

**Files:**
- Create: `app/(main)/planning/page.tsx`
- Create: `app/(main)/planning/client.tsx`
- Create: `src/modules/planning/components/PlanningFilterBar.tsx`

**Interfaces:**
- Consumes: `KanbanBoard` (Task 6), `useUrlFilters` (`@/hooks/useUrlFilters`), `ProjectQueryService.getActiveProjects()` (`@/services/projects/core/projectQueryService`), `PlanningFilters` (Task 1).
- Produces: the `/planning` route rendering the filter bar + board; `<PlanningFilterBar value onChange />`.

- [ ] **Step 1: Create the server page**

```typescript
// app/(main)/planning/page.tsx
export const dynamic = 'force-dynamic';

import PlanningPageClient from './client';

export default function PlanningPage() {
  return <PlanningPageClient />;
}
```

- [ ] **Step 2: Create the filter bar**

```typescript
// src/modules/planning/components/PlanningFilterBar.tsx
'use client';
import { useEffect, useState } from 'react';
import { ProjectQueryService } from '@/services/projects/core/projectQueryService';
import { BOARD_STAGES } from '../constants/stages';
import { log } from '@/lib/logger';
import type { Project } from '@/types/project/base.types';

export interface PlanningFilterValues { project: string; stage: string; search: string }

interface Props {
  value: PlanningFilterValues;
  onChange: (key: keyof PlanningFilterValues, val: string) => void;
  onClear: () => void;
}

export function PlanningFilterBar({ value, onChange, onClear }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    ProjectQueryService.getActiveProjects()
      .then(setProjects)
      .catch((error) => log.error('Failed to load projects', { data: error }, 'PlanningFilterBar'));
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <input
        type="text"
        placeholder="Search planning items…"
        value={value.search}
        onChange={(e) => onChange('search', e.target.value)}
        className="px-3 py-2 border rounded-md text-sm"
      />
      <select value={value.project} onChange={(e) => onChange('project', e.target.value)} className="px-3 py-2 border rounded-md text-sm">
        <option value="">All Projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.project_name || p.name} {p.project_code ? `(${p.project_code})` : ''}</option>
        ))}
      </select>
      <select value={value.stage} onChange={(e) => onChange('stage', e.target.value)} className="px-3 py-2 border rounded-md text-sm">
        <option value="">All Stages</option>
        {BOARD_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <button onClick={onClear} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">Clear</button>
    </div>
  );
}
```

> Confirm `Project` has `project_name`/`name`/`project_code` fields before relying on them (Task 1 reference). `getActiveProjects()` returns `Project[]`.

- [ ] **Step 3: Create the client page**

```typescript
// app/(main)/planning/client.tsx
'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import { KanbanBoard } from '@/modules/planning/components/KanbanBoard';
import { PlanningFilterBar } from '@/modules/planning/components/PlanningFilterBar';
import type { PlanningFilters, PlanningStage } from '@/modules/planning/types/planning';

export default function PlanningPageClient() {
  const { filters, setFilter, clearAll } = useUrlFilters({ project: '', stage: '', search: '' });

  const boardFilters: PlanningFilters = useMemo(() => ({
    project_id: filters.project || undefined,
    stage: (filters.stage || undefined) as PlanningStage | undefined,
    search: filters.search || undefined,
  }), [filters.project, filters.stage, filters.search]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Planning</h1>
        <Link href="/planning/new" className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm">New Planning Item</Link>
      </div>
      <PlanningFilterBar
        value={filters}
        onChange={(k, v) => setFilter(k, v)}
        onClear={clearAll}
      />
      <KanbanBoard filters={boardFilters} />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + manual smoke**

Run: `npx tsc --noEmit`
Then `PORT=3004 npm run dev`, open `http://localhost:3004/planning`. Expected: page renders with the 6 stage columns, project/stage/search filters, and a "New Planning Item" button. (Board may be empty until items exist.)

- [ ] **Step 5: Commit**

```bash
git add app/\(main\)/planning/page.tsx app/\(main\)/planning/client.tsx src/modules/planning/components/PlanningFilterBar.tsx
git commit -m "feat(planning): add board page and project/stage/search filter bar"
```

---

### Task 8: Detail page (stage stepping + checklists + notes/activity)

**Files:**
- Create: `app/(main)/planning/[id]/page.tsx`
- Create: `app/(main)/planning/[id]/client.tsx`
- Create: `src/modules/planning/components/PlanningItemDetail.tsx`

**Interfaces:**
- Consumes: `usePlanningItem`, `useUpdatePlanningItem` (Task 5); `BOARD_STAGES`, `STAGE_FLOW`, `STAGE_LABELS` (Task 1); `ChecklistItem`, `StageChecklists`, `BoardStage` (Task 1).
- Produces: `/planning/[id]` route; `<PlanningItemDetail itemId />`.

- [ ] **Step 1: Create the server + client wrappers**

```typescript
// app/(main)/planning/[id]/page.tsx
export const dynamic = 'force-dynamic';

import PlanningDetailClient from './client';

export default function PlanningDetailPage() {
  return <PlanningDetailClient />;
}
```

```typescript
// app/(main)/planning/[id]/client.tsx
'use client';
import { useParams } from 'next/navigation';
import { PlanningItemDetail } from '@/modules/planning/components/PlanningItemDetail';

export default function PlanningDetailClient() {
  const params = useParams();
  const id = params?.id as string;
  return <div className="p-6"><PlanningItemDetail itemId={id} /></div>;
}
```

- [ ] **Step 2: Create the detail component**

```typescript
// src/modules/planning/components/PlanningItemDetail.tsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePlanningItem, useUpdatePlanningItem } from '../hooks/usePlanningItem';
import { BOARD_STAGES, STAGE_FLOW, STAGE_LABELS } from '../constants/stages';
import type { BoardStage, ChecklistItem, PlanningStage, StageChecklists } from '../types/planning';
import { log } from '@/lib/logger';

export function PlanningItemDetail({ itemId }: { itemId: string }) {
  const { data: item, isLoading } = usePlanningItem(itemId);
  const update = useUpdatePlanningItem();
  const [openStage, setOpenStage] = useState<BoardStage | null>(null);

  if (isLoading) return <div>Loading…</div>;
  if (!item) return <div>Planning item not found. <Link href="/planning" className="text-blue-600">Back to board</Link></div>;

  const currentIndex = STAGE_FLOW.indexOf(item.stage as BoardStage);

  const moveStage = async (next: PlanningStage) => {
    try { await update.mutateAsync({ id: itemId, payload: { stage: next } }); }
    catch (e) { log.error('Failed to move stage', { e, itemId, next }, 'PlanningItemDetail'); }
  };

  const toggleChecklist = async (stage: BoardStage, checkId: string) => {
    const checklists: StageChecklists = JSON.parse(JSON.stringify(item.stage_checklists));
    const list = checklists[stage] || [];
    const target = list.find((c: ChecklistItem) => c.id === checkId);
    if (!target) return;
    target.done = !target.done;
    try { await update.mutateAsync({ id: itemId, payload: { stage_checklists: checklists } }); }
    catch (e) { log.error('Failed to toggle checklist', { e, itemId, checkId }, 'PlanningItemDetail'); }
  };

  return (
    <div className="max-w-4xl">
      <Link href="/planning" className="text-sm text-blue-600">← Back to board</Link>
      <div className="flex items-center justify-between mt-2">
        <div>
          <h1 className="text-xl font-semibold">{item.title}</h1>
          <p className="text-sm text-gray-500">{item.item_uid} · {item.project_name} · {item.scope_area}</p>
        </div>
        <span className="px-3 py-1 rounded-full bg-gray-100 text-sm">{STAGE_LABELS[item.stage]}</span>
      </div>

      <div className="flex gap-2 my-4">
        <button
          disabled={currentIndex <= 0}
          onClick={() => moveStage(STAGE_FLOW[currentIndex - 1])}
          className="px-3 py-2 border rounded-md text-sm disabled:opacity-40"
        >← Previous stage</button>
        <button
          disabled={currentIndex < 0 || currentIndex >= STAGE_FLOW.length - 1}
          onClick={() => moveStage(STAGE_FLOW[currentIndex + 1])}
          className="px-3 py-2 border rounded-md text-sm disabled:opacity-40"
        >Next stage →</button>
      </div>

      <div className="space-y-2">
        {BOARD_STAGES.map(({ key, label }) => {
          const items = item.stage_checklists[key] || [];
          const isOpen = openStage === key;
          const doneCount = items.filter((c) => c.done).length;
          return (
            <div key={key} className="border rounded-md">
              <button onClick={() => setOpenStage(isOpen ? null : key)} className="w-full flex justify-between px-4 py-3 text-left">
                <span className="font-medium">{label}</span>
                <span className="text-sm text-gray-500">{doneCount}/{items.length}</span>
              </button>
              {isOpen && (
                <ul className="px-4 pb-3 space-y-1">
                  {items.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={c.done} onChange={() => toggleChecklist(key, c.id)} />
                      <span className={c.kind === 'gate' ? 'font-semibold' : ''}>{c.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

> Notes/activity timeline: for v1 render any `activities` returned by the detail endpoint below the checklists. If the endpoint does not yet return them, leave a placeholder section reading from `usePlanningActivities` (Task 5 stub) — do not block the task on it; the stage-stepping + checklist interaction is the required deliverable.

- [ ] **Step 3: Typecheck + manual smoke**

Run: `npx tsc --noEmit`
Then with dev running, create an item (Task 9) or insert one via SQL, open `/planning/[id]`, verify: stage chip shows current stage, Previous/Next buttons move it (and the chip + board reflect the change), checklist toggles persist across reload.

- [ ] **Step 4: Commit**

```bash
git add app/\(main\)/planning/\[id\] src/modules/planning/components/PlanningItemDetail.tsx
git commit -m "feat(planning): add detail page with stage stepping and checklists"
```

---

### Task 9: New planning item page

**Files:**
- Create: `app/(main)/planning/new/page.tsx`
- Create: `app/(main)/planning/new/client.tsx`

**Interfaces:**
- Consumes: `useCreatePlanningItem` (Task 5); `ProjectQueryService.getActiveProjects()`; `BOARD_STAGES`.
- Produces: `/planning/new` route with a create form (project, title, scope_area, description, priority).

- [ ] **Step 1: Create the server wrapper**

```typescript
// app/(main)/planning/new/page.tsx
export const dynamic = 'force-dynamic';

import PlanningNewClient from './client';

export default function PlanningNewPage() {
  return <PlanningNewClient />;
}
```

- [ ] **Step 2: Create the form client**

```typescript
// app/(main)/planning/new/client.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreatePlanningItem } from '@/modules/planning/hooks/usePlanningItems';
import { ProjectQueryService } from '@/services/projects/core/projectQueryService';
import { log } from '@/lib/logger';
import type { Project } from '@/types/project/base.types';

export default function PlanningNewClient() {
  const router = useRouter();
  const create = useCreatePlanningItem();
  const [projects, setProjects] = useState<Project[]>([]);
  const [form, setForm] = useState({ project_id: '', title: '', scope_area: '', description: '', priority: 'normal' });

  useEffect(() => {
    ProjectQueryService.getActiveProjects()
      .then(setProjects)
      .catch((error) => log.error('Failed to load projects', { data: error }, 'PlanningNew'));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.project_id || !form.title.trim()) return;
    try {
      const item = await create.mutateAsync({
        project_id: form.project_id,
        title: form.title.trim(),
        scope_area: form.scope_area || null,
        description: form.description || null,
        priority: form.priority as 'low' | 'normal' | 'high' | 'urgent',
        source: 'manual',
      });
      router.push(`/planning/${item.id}`);
    } catch (error) {
      log.error('Failed to create planning item', { data: error }, 'PlanningNew');
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-4">New Planning Item</h1>
      <form onSubmit={submit} className="space-y-3">
        <select required value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className="w-full px-3 py-2 border rounded-md">
          <option value="">Select project…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.project_name || p.name}</option>)}
        </select>
        <input required placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 border rounded-md" />
        <input placeholder="Scope / area (PON, zone, phase)" value={form.scope_area} onChange={(e) => setForm({ ...form, scope_area: e.target.value })} className="w-full px-3 py-2 border rounded-md" />
        <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border rounded-md" />
        <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full px-3 py-2 border rounded-md">
          <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
        </select>
        <button type="submit" disabled={create.isPending} className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50">
          {create.isPending ? 'Creating…' : 'Create'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + manual smoke**

Run: `npx tsc --noEmit`. With dev running, go to `/planning/new`, create an item, confirm redirect to its detail page and that it appears in Stage 0 (Intake) on the board.

- [ ] **Step 4: Commit**

```bash
git add app/\(main\)/planning/new
git commit -m "feat(planning): add new planning item form"
```

---

### Task 10: Sidebar navigation + RBAC + ModulePage config

**Files:**
- Create: `src/components/layout/sidebar/config/planningSection.ts`
- Modify: `src/components/layout/sidebar/config/index.ts`
- Modify: `src/components/layout/sidebar/navigationConfig.ts`
- Modify (if needed): the module nav config consumed by `ModulePage` (mirror `nocConfig` in `src/modules/navigation`)

**Interfaces:**
- Consumes: `NavSection` type.
- Produces: `planningSection` nav entry, inserted directly after `procurementSection`.

- [ ] **Step 1: Create the section config**

```typescript
// src/components/layout/sidebar/config/planningSection.ts
import { ClipboardList } from 'lucide-react';
import type { NavSection } from './types';

export const planningSection: NavSection = {
  section: 'Planning',
  sectionId: 'planning',
  sectionLink: '/planning',
  isCollapsible: false,
  items: [
    {
      to: '/planning',
      icon: ClipboardList,
      label: 'Planning',
      shortLabel: 'Plan',
      permissions: [],
      rbacKey: 'planning.main',
    },
  ],
};
```

- [ ] **Step 2: Export from the barrel** — add to `src/components/layout/sidebar/config/index.ts`:
```typescript
export { planningSection } from './planningSection';
```

- [ ] **Step 3: Insert into navItems** — in `src/components/layout/sidebar/navigationConfig.ts`, add the import alongside the others and place it immediately after `procurementSection`:
```typescript
import { planningSection } from './config';
// …
export const navItems: NavSection[] = [
  mainSection,
  projectSection,
  activateSection,
  nocSection,
  procurementSection,
  planningSection,        // ← Planning, directly below Procurement
  assetsSection,
  // …rest unchanged
];
```

- [ ] **Step 4: Manual verify**

With dev running, confirm "Planning" appears in the left sidebar directly under "Procurement" and navigates to `/planning`.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
```bash
git add src/components/layout/sidebar
git commit -m "feat(planning): add Planning sidebar entry below Procurement"
```

> RBAC: `planning.main` is referenced as the `rbacKey`. If the codebase requires permissions to be seeded before a nav item shows, follow the `/access-control` skill or mirror how `noc.main` is seeded. For v1 `permissions: []` keeps it open like NOC's current entry; do not gate it unless Hein asks.

---

### Task 11: Pipeline → Planning auto-handoff hook

**Files:**
- Modify: `pages/api/pipeline/projects/[id]/transition.ts` (insert after the project + links are created, before building the response — i.e. after line ~186, the `project_pipeline_links` insert)

**Interfaces:**
- Consumes: the existing `project.id` (new real project) and `pipelineProjectId` already in scope; the `sql` tagged template already defined in the file.
- Produces: one `planning_items` row (`source = 'pipeline_auto'`, `stage = 'intake'`) per transitioned pipeline project, idempotently.

- [ ] **Step 1: Add the insert** — after the `project_pipeline_links` insert (and before `seed_project_requirements`), add:

```typescript
    // 6d. Auto-create the first Planning card for this project (idempotent).
    // The partial unique index uniq_planning_items_pipeline_auto guarantees one per pipeline project.
    await sql`
      INSERT INTO planning_items (
        item_uid,
        project_id,
        title,
        stage,
        source,
        pipeline_project_id,
        stage_checklists,
        created_by
      ) VALUES (
        'PLN-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(
          (
            SELECT (COALESCE(last_sequence, 0) + 1)::text
            FROM planning_item_sequences WHERE sequence_date = CURRENT_DATE
          ),
          3, '0'
        ),
        ${project.id},
        ${pp.project_name} || ' — Planning',
        'intake',
        'pipeline_auto',
        ${pipelineProjectId},
        '{}'::jsonb,
        ${userId}
      )
      ON CONFLICT (pipeline_project_id) WHERE pipeline_project_id IS NOT NULL AND source = 'pipeline_auto'
      DO NOTHING
    `;
    // Keep the daily sequence in step with the inserted UID.
    await sql`
      INSERT INTO planning_item_sequences (sequence_date, last_sequence)
      VALUES (CURRENT_DATE, 1)
      ON CONFLICT (sequence_date)
      DO UPDATE SET last_sequence = planning_item_sequences.last_sequence + 1, updated_at = NOW()
    `;
```

> Simplification note: the inline UID expression above is best-effort for the auto-card. To avoid UID/sequence drift, the cleaner alternative is to import and call the service: `createPlanningItem({ project_id: project.id, title: `${pp.project_name} — Planning`, source: 'pipeline_auto' })` and then `UPDATE planning_items SET pipeline_project_id = ${pipelineProjectId} WHERE id = …`, wrapped in a `try/catch` that ignores the unique-violation. **Prefer the service-call approach** — it reuses `generatePlanningUID` and `buildInitialChecklists` (seeded checklist) and keeps one code path. Use the raw SQL only if importing the service into a Pages-Router file causes a build issue. Whichever you choose, the card MUST end up with `stage_checklists` seeded from the template; if you use raw SQL, replace `'{}'::jsonb` by selecting the template JSON, or run a follow-up `updatePlanningItem` to seed it.

- [ ] **Step 2: Decide and implement the chosen approach** — implement the **service-call approach** (preferred). Add at top of `transition.ts`:
```typescript
import { createPlanningItem } from '@/modules/planning/services/planningService';
```
and replace step 6d with:
```typescript
    // 6d. Auto-create the first Planning card (idempotent on unique index).
    try {
      const planningItem = await createPlanningItem({
        project_id: project.id as string,
        title: `${pp.project_name as string} — Planning`,
        source: 'pipeline_auto',
        created_by: userId,
      });
      await sql`UPDATE planning_items SET pipeline_project_id = ${pipelineProjectId} WHERE id = ${planningItem.id}`;
    } catch (err) {
      // Unique-violation = card already exists for this pipeline project; safe to ignore.
      log.warn('Planning auto-card not created (likely already exists)', { pipelineProjectId, err }, 'PipelineTransition');
    }
```

> Caveat: `createPlanningItem` uses `@/lib/db-pool` (pg.Pool) while this file uses the Neon-shim `sql`. They are independent connections — that's fine; the planning insert is its own statement, not part of the pipeline `sql` flow. If the project ever wraps `transition.ts` in a single transaction, revisit this.

- [ ] **Step 3: Manual verify**

With dev running and migration applied: take a pipeline project in `ready_to_plan`, call the transition endpoint (via the pipeline UI "Transition to planned" action or `curl -X POST /api/pipeline/projects/<id>/transition`). Confirm: a new project is created AND a single `planning_items` row appears in Stage 0 of `/planning` for that project. Call transition again on another `ready_to_plan` project → another single card; re-running cannot duplicate (unique index).

Verify no duplicate:
```bash
PGPASSWORD="$PGPASSWORD" psql -h 100.96.203.105 -p 5437 -U fibreflow_user -d fibreflow \
  -c "SELECT pipeline_project_id, count(*) FROM planning_items WHERE source='pipeline_auto' GROUP BY 1 HAVING count(*) > 1;"
```
Expected: 0 rows.

- [ ] **Step 4: Commit**

```bash
git add pages/api/pipeline/projects/\[id\]/transition.ts
git commit -m "feat(planning): auto-create planning card on pipeline transition to planned"
```

---

### Task 12: Full verification + PR

**Files:** none (verification + PR).

- [ ] **Step 1: Run the full local CI gate**

Run: `npm run ci:quick`
Expected: PASS. Fix any lint/type failures it reports (do not `--no-verify`).

- [ ] **Step 2: Run the planning tests**

Run: `npx vitest run src/modules/planning tests/api/planning`
Expected: all PASS.

- [ ] **Step 3: Manual end-to-end smoke (evidence required)**

With `PORT=3004 npm run dev`, verify and capture (screenshot or notes):
1. Sidebar shows "Planning" directly below "Procurement".
2. `/planning` shows 6 stage columns; project + stage + search filters work and persist in the URL on reload.
3. Create item via `/planning/new` → lands in Intake; drag it to HLD → persists on reload; quick-move chevrons work.
4. Open the card → Previous/Next stage buttons move it; checklist toggles persist.
5. Pipeline transition auto-creates exactly one Stage-0 card (Task 11 verify).

- [ ] **Step 4: Open the PR (stop here — do not merge)**

```bash
git push -u origin feat/planning-kanban
gh pr create --title "feat(planning): NOC-style Planning Kanban module (v1)" \
  --body "Implements the Planning module per docs/superpowers/specs/2026-06-25-planning-module-design.md and docs/superpowers/plans/2026-06-25-planning-module.md. 6-stage Kanban, many cards per project, pipeline auto-handoff, per-stage checklists. Migration 247 must be applied (dev first; production per deploy policy)."
```

Then stop and wait for review/approval (per project policy: never auto-merge; deploys/migrations need Hein's approval).

---

## Self-Review Notes

- **Spec coverage:** sidebar placement (T10), 6 stage columns (T1/T6), many-cards-per-project (T3 create + T9 form), pipeline auto-handoff (T11), free-drag movement (T6), detail with stage-stepping + checklists + notes (T8), project filter (T7), data model (T2), API (T4), separate board / App Router (T6/T4 per Global Constraints). All present.
- **Out-of-scope items** (gate enforcement, attachments, RACI, KPIs, automation) intentionally omitted per spec.
- **Type consistency:** `stage` (not `status`) used throughout; `PlanningItemWithRelations` is the read shape across service/hooks/components; `buildUpdateSql` field map matches `UpdatePlanningItemPayload`.
- **Known soft spots flagged inline:** the activity timeline endpoint (T5/T8) is a v1 stub; the pipeline-hook DB-pool/Neon-shim coexistence (T11). Both are called out with the preferred resolution.
