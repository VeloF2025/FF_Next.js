# Dynamic Ticket Project Dropdowns & Auto-Team Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded project dropdowns with live DB queries and auto-assign activations teams per project when creating NOC tickets from PP Data, OLT Investigate, and Non-Invoiceables.

**Architecture:** New `project_team_assignments` junction table links projects to teams with a role label. Ticket creation modals group selected records by project, resolve the activations team per project from the junction table, and create separate batches — each auto-assigned to the right team. NOC → Teams admin page gets an inline Projects column for managing assignments.

**Tech Stack:** Next.js 14 App Router + Pages Router, Neon PostgreSQL (direct SQL via `pool`/`queryOne`/`query`), React Query (TanStack), Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/migrations/sql/304_project_team_assignments.sql` | Create | Junction table schema |
| `src/modules/noc/types/team.ts` | Modify | Add `ProjectTeamAssignment` type + update `TeamDropdownOption` |
| `app/api/noc/project-team-assignments/route.ts` | Create | GET list + POST create |
| `app/api/noc/project-team-assignments/[id]/route.ts` | Create | DELETE by id |
| `src/modules/noc/services/teamService.ts` | Modify | `getTeamsForDropdown` joins project_assignments |
| `pages/api/activate/projects.ts` | Create | `GET DISTINCT project FROM oes_pp_data` |
| `pages/api/activate/non-invoiceables/projects.ts` | Create | `GET DISTINCT project` from oes_pp_data + olt_mismatch_records |
| `src/modules/activate/components/PPDataFilters.tsx` | Modify | Accept `projects: string[]` prop (remove hardcoded list) |
| `src/modules/activate/components/PPDataTab.tsx` | Modify | Fetch projects, pass to filters; pass selected records to modal |
| `src/modules/activate/components/CreatePPTicketsModal.tsx` | Modify | Batch-per-project logic + auto-team pre-fill |
| `src/modules/non-invoiceables/components/NonInvoiceablesPage.tsx` | Modify | Fetch + render dynamic projects |
| `src/modules/data-sync/components/groups/olt/CreateOltTicketsModal.tsx` | Modify | Batch-per-project + auto-team (same pattern as PP modal) |
| `pages/api/activate/pp-data-tickets.ts` | Modify | Accept `batches[]` array for multi-project bulk |
| `pages/api/system/olt-report/tickets.ts` | Modify | Accept `batches[]` array for multi-project bulk |
| `app/(main)/noc/teams/client.tsx` | Modify | Projects column + inline assignment editor in list view |

---

## Task 1: DB Migration — `project_team_assignments` table

**Files:**
- Create: `scripts/migrations/sql/304_project_team_assignments.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Migration 304: project_team_assignments junction table
--
-- Links projects to teams with a role label.
-- Used to auto-assign the correct activations team when creating tickets.
-- roles: activations, maintenance, fault_repair, other
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS project_team_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'activations'
                CHECK (role IN ('activations', 'maintenance', 'fault_repair', 'other')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, team_id, role)
);

CREATE INDEX IF NOT EXISTS idx_pta_project ON project_team_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_pta_team ON project_team_assignments(team_id);
CREATE INDEX IF NOT EXISTS idx_pta_project_role ON project_team_assignments(project_id, role);
```

- [ ] **Step 2: Run migration**

```bash
cd /home/hein/Workspace/FF_Next.js-dynamic-tickets
psql "$DATABASE_URL" -f scripts/migrations/sql/304_project_team_assignments.sql
```

Expected: `CREATE TABLE`, `CREATE INDEX`, `CREATE INDEX`, `CREATE INDEX`

- [ ] **Step 3: Verify table exists**

```bash
psql "$DATABASE_URL" -c "\d project_team_assignments"
```

Expected: Shows `id`, `project_id`, `team_id`, `role`, `created_at` columns with constraints.

- [ ] **Step 4: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-dynamic-tickets
git add scripts/migrations/sql/304_project_team_assignments.sql
git commit -m "feat(db): add project_team_assignments junction table (migration 304)"
```

---

## Task 2: Type Definitions

**Files:**
- Modify: `src/modules/noc/types/team.ts`

No TDD for pure type definitions — types are verified by the compiler, not test assertions.

- [ ] **Step 1: Add types to `src/modules/noc/types/team.ts`**

After the `TeamDropdownOption` interface (line 96), add:

```typescript
/**
 * Project-team junction — one row per (project, team, role) triple.
 * See migration 304.
 */
export interface ProjectTeamAssignment {
  id: string;
  project_id: string;
  team_id: string;
  role: 'activations' | 'maintenance' | 'fault_repair' | 'other';
  created_at: string;
  // Enriched from joins
  project_name?: string;
  team_name?: string;
}
```

Update `TeamDropdownOption` to add `project_assignments`:

```typescript
export interface TeamDropdownOption {
  id: string;
  name: string;
  type: 'internal' | 'contractor';
  team_type: string;
  member_count: number;
  lead_name?: string;
  contractor_name?: string;
  project_assignments?: ProjectTeamAssignment[];  // ← add this line
}
```

- [ ] **Step 2: Run type-check to verify**

```bash
cd /home/hein/Workspace/FF_Next.js-dynamic-tickets
npm run type-check 2>&1 | head -20
```

Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/noc/types/team.ts
git commit -m "feat(noc): add ProjectTeamAssignment type and project_assignments to TeamDropdownOption"
```

---

## Task 3: API — project-team-assignments CRUD

**Files:**
- Create: `app/api/noc/project-team-assignments/route.ts`
- Create: `app/api/noc/project-team-assignments/[id]/route.ts`

- [ ] **Step 1: Write failing tests**

Create `src/modules/noc/__tests__/api/project-team-assignments.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the NOC module's db wrapper (NOT @/lib/db — that's a different API)
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
vi.mock('@/modules/noc/utils/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
}));

describe('project-team-assignments API logic', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('GET returns all assignments with project and team names', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'pta-1',
        project_id: 'proj-1',
        team_id: 'team-1',
        role: 'activations',
        created_at: '2026-04-16T00:00:00Z',
        project_name: 'Lawley',
        team_name: 'Lawley Activations',
      },
    ]);

    const { listProjectTeamAssignments } = await import(
      '@/modules/noc/services/projectTeamAssignmentService'
    );
    const result = await listProjectTeamAssignments();
    expect(result).toHaveLength(1);
    expect(result[0].project_name).toBe('Lawley');
    expect(result[0].role).toBe('activations');
  });

  it('createProjectTeamAssignment inserts and returns row', async () => {
    mockQueryOne.mockResolvedValueOnce(
      { id: 'new-id', project_id: 'p1', team_id: 't1', role: 'activations', created_at: '2026-04-16T00:00:00Z' }
    );
    const { createProjectTeamAssignment } = await import(
      '@/modules/noc/services/projectTeamAssignmentService'
    );
    const result = await createProjectTeamAssignment({ project_id: 'p1', team_id: 't1', role: 'activations' });
    expect(result.id).toBe('new-id');
  });

  it('deleteProjectTeamAssignment removes row by id', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'pta-1' }]);
    const { deleteProjectTeamAssignment } = await import(
      '@/modules/noc/services/projectTeamAssignmentService'
    );
    const deleted = await deleteProjectTeamAssignment('pta-1');
    expect(deleted).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- src/modules/noc/__tests__/api/project-team-assignments.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create service file `src/modules/noc/services/projectTeamAssignmentService.ts`**

**IMPORTANT:** This service MUST use `import { query, queryOne } from '../utils/db'` (the NOC module's DB wrapper, returns `T[]` directly). Do NOT use `import pool from '@/lib/db'` (returns `{ rows }` — different API).

```typescript
import { query, queryOne } from '../utils/db';
import { createLogger } from '@/lib/logger';
import type { ProjectTeamAssignment } from '../types/team';

const logger = createLogger('noc:projectTeamAssignmentService');

export async function listProjectTeamAssignments(): Promise<ProjectTeamAssignment[]> {
  return query<ProjectTeamAssignment>(
    `SELECT
       pta.id, pta.project_id, pta.team_id, pta.role, pta.created_at::text as created_at,
       p.project_name as project_name,
       t.name as team_name
     FROM project_team_assignments pta
     JOIN projects p ON p.id = pta.project_id
     JOIN teams t ON t.id = pta.team_id
     ORDER BY p.project_name, pta.role`
  );
}

export async function createProjectTeamAssignment(payload: {
  project_id: string;
  team_id: string;
  role: ProjectTeamAssignment['role'];
}): Promise<ProjectTeamAssignment> {
  logger.info('Creating project-team assignment', payload);
  const row = await queryOne<ProjectTeamAssignment>(
    `INSERT INTO project_team_assignments (project_id, team_id, role)
     VALUES ($1, $2, $3)
     RETURNING id, project_id, team_id, role, created_at::text as created_at`,
    [payload.project_id, payload.team_id, payload.role]
  );
  if (!row) throw new Error('Insert returned no row');
  return row;
}

export async function deleteProjectTeamAssignment(id: string): Promise<boolean> {
  logger.info('Deleting project-team assignment', { id });
  const rows = await query(
    `DELETE FROM project_team_assignments WHERE id = $1 RETURNING id`,
    [id]
  );
  return rows.length > 0;
}

export async function getActivationsTeamForProject(projectId: string): Promise<string | null> {
  const row = await queryOne<{ team_id: string }>(
    `SELECT team_id FROM project_team_assignments
     WHERE project_id = $1 AND role = 'activations'
     LIMIT 1`,
    [projectId]
  );
  return row?.team_id || null;
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- src/modules/noc/__tests__/api/project-team-assignments.test.ts
```

Expected: PASS

- [ ] **Step 5: Create `app/api/noc/project-team-assignments/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  listProjectTeamAssignments,
  createProjectTeamAssignment,
} from '@/modules/noc/services/projectTeamAssignmentService';
import type { ProjectTeamAssignment } from '@/modules/noc/types/team';

const logger = createLogger('noc:api:project-team-assignments');

export async function GET() {
  try {
    const assignments = await listProjectTeamAssignments();
    return NextResponse.json({ success: true, data: assignments });
  } catch (error) {
    logger.error('Failed to list project-team assignments', { error });
    return NextResponse.json({ success: false, error: { code: 'DATABASE_ERROR', message: 'Failed to fetch assignments' } }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { project_id: string; team_id: string; role: ProjectTeamAssignment['role'] };
    if (!body.project_id || !body.team_id) {
      return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'project_id and team_id are required' } }, { status: 422 });
    }
    const validRoles = ['activations', 'maintenance', 'fault_repair', 'other'] as const;
    const role = validRoles.includes(body.role as typeof validRoles[number]) ? body.role : 'activations';
    const assignment = await createProjectTeamAssignment({ project_id: body.project_id, team_id: body.team_id, role });
    return NextResponse.json({ success: true, data: assignment }, { status: 201 });
  } catch (error: any) {
    logger.error('Failed to create project-team assignment', { error });
    if (error.code === '23505') {
      return NextResponse.json({ success: false, error: { code: 'DUPLICATE_ERROR', message: 'This team-project-role combination already exists' } }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: { code: 'DATABASE_ERROR', message: 'Failed to create assignment' } }, { status: 500 });
  }
}
```

- [ ] **Step 6: Create `app/api/noc/project-team-assignments/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { deleteProjectTeamAssignment } from '@/modules/noc/services/projectTeamAssignmentService';

const logger = createLogger('noc:api:project-team-assignments:id');

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deleted = await deleteProjectTeamAssignment(params.id);
    if (!deleted) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Assignment not found' } }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete project-team assignment', { error, id: params.id });
    return NextResponse.json({ success: false, error: { code: 'DATABASE_ERROR', message: 'Failed to delete assignment' } }, { status: 500 });
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add \
  src/modules/noc/services/projectTeamAssignmentService.ts \
  src/modules/noc/__tests__/api/project-team-assignments.test.ts \
  app/api/noc/project-team-assignments/route.ts \
  app/api/noc/project-team-assignments/[id]/route.ts
git commit -m "feat(noc): add project-team-assignments API and service"
```

---

## Task 4: Update teamService — include project_assignments in dropdown

**Files:**
- Modify: `src/modules/noc/services/teamService.ts`

- [ ] **Step 1: Find `getTeamsForDropdown` in teamService.ts**

```bash
grep -n "getTeamsForDropdown" /home/hein/Workspace/FF_Next.js-dynamic-tickets/src/modules/noc/services/teamService.ts
```

Note the line number of `getTeamsForDropdown`.

- [ ] **Step 2: Replace `getTeamsForDropdown` to join project_assignments**

Find the existing `getTeamsForDropdown` function and replace it with:

```typescript
export async function getTeamsForDropdown(): Promise<TeamDropdownOption[]> {
  logger.debug('Fetching teams for dropdown');
  const result = await query<{
    id: string;
    name: string;
    team_type: string;
    member_count: number;
    lead_name: string | null;
    contractor_name: string | null;
    assignment_id: string | null;
    project_id: string | null;
    project_name: string | null;
    role: string | null;
    assignment_created_at: string | null;
  }>(
    `SELECT
       t.id, t.name, t.team_type,
       COUNT(DISTINCT tm.id)::int as member_count,
       u.first_name || ' ' || u.last_name as lead_name,
       c.name as contractor_name,
       pta.id as assignment_id,
       pta.project_id,
       p.project_name,
       pta.role,
       pta.created_at::text as assignment_created_at
     FROM teams t
     LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.is_active = true
     LEFT JOIN users u ON u.id = t.lead_user_id
     LEFT JOIN contractors c ON c.id = t.contractor_id
     LEFT JOIN project_team_assignments pta ON pta.team_id = t.id
     LEFT JOIN projects p ON p.id = pta.project_id
     WHERE t.is_active = true
     GROUP BY t.id, t.name, t.team_type, u.first_name, u.last_name, c.name,
              pta.id, pta.project_id, p.project_name, pta.role, pta.created_at
     ORDER BY t.name`
  );

  // Collapse multiple assignment rows into one TeamDropdownOption per team
  const teamMap = new Map<string, TeamDropdownOption>();
  for (const row of result) {
    if (!teamMap.has(row.id)) {
      teamMap.set(row.id, {
        id: row.id,
        name: row.name,
        type: row.team_type === 'contractor' ? 'contractor' : 'internal',
        team_type: row.team_type,
        member_count: row.member_count,
        lead_name: row.lead_name || undefined,
        contractor_name: row.contractor_name || undefined,
        project_assignments: [],
      });
    }
    if (row.assignment_id) {
      teamMap.get(row.id)!.project_assignments!.push({
        id: row.assignment_id,
        project_id: row.project_id!,
        team_id: row.id,
        role: row.role as 'activations' | 'maintenance' | 'fault_repair' | 'other',
        created_at: row.assignment_created_at!,
        project_name: row.project_name || undefined,
      });
    }
  }
  return Array.from(teamMap.values());
}
```

- [ ] **Step 3: Run lint + type-check**

```bash
cd /home/hein/Workspace/FF_Next.js-dynamic-tickets
npm run lint -- --quiet 2>&1 | head -30
npm run type-check 2>&1 | head -30
```

Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/modules/noc/services/teamService.ts
git commit -m "feat(noc): include project_assignments in getTeamsForDropdown response"
```

---

## Task 5: API — `/api/activate/projects`

**Files:**
- Create: `pages/api/activate/projects.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/activate/__tests__/api/projects.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ default: { query: vi.fn() } }));
vi.mock('@/lib/auth', () => ({
  withAuth: (_h: any) => _h,
  withRole: (_roles: any, _h: any) => _h,
}));

import pool from '@/lib/db';
const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };

describe('GET /api/activate/projects', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns distinct projects from oes_pp_data', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ project: 'Lawley' }, { project: 'Mamelodi' }, { project: 'Mohadin' }],
    });

    // Import the handler function directly
    const { getDistinctProjects } = await import('@/modules/activate/services/projectsService');
    const result = await getDistinctProjects();
    expect(result).toEqual(['Lawley', 'Mamelodi', 'Mohadin']);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- src/modules/activate/__tests__/api/projects.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/modules/activate/services/projectsService.ts`**

```typescript
import pool from '@/lib/db';

export async function getDistinctProjects(): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT project FROM oes_pp_data WHERE project IS NOT NULL ORDER BY project`
  );
  return result.rows.map((r: { project: string }) => r.project);
}

export async function getDistinctNonInvoiceableProjects(): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT project FROM oes_pp_data WHERE project IS NOT NULL
     UNION
     SELECT DISTINCT project FROM olt_mismatch_records WHERE project IS NOT NULL
     ORDER BY 1`
  );
  return result.rows.map((r: { project: string }) => r.project);
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- src/modules/activate/__tests__/api/projects.test.ts
```

Expected: PASS

- [ ] **Step 5: Create `pages/api/activate/projects.ts`**

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/auth';
import { getDistinctProjects } from '@/modules/activate/services/projectsService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('activate:projects');

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }
  try {
    const projects = await getDistinctProjects();
    return apiResponse.success(res, { projects });
  } catch (error) {
    logger.error('Failed to fetch projects', { error });
    return apiResponse.serverError(res, 'Failed to fetch projects');
  }
}

export default withAuth(handler as any);
```

- [ ] **Step 6: Create `pages/api/activate/non-invoiceables/projects.ts`**

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { getDistinctNonInvoiceableProjects } from '@/modules/activate/services/projectsService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('activate:non-invoiceables:projects');

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }
  try {
    const projects = await getDistinctNonInvoiceableProjects();
    return apiResponse.success(res, { projects });
  } catch (error) {
    logger.error('Failed to fetch non-invoiceables projects', { error });
    return apiResponse.serverError(res, 'Failed to fetch projects');
  }
}

export default withAuth(handler as any);
```

- [ ] **Step 7: Commit**

```bash
git add \
  src/modules/activate/services/projectsService.ts \
  src/modules/activate/__tests__/api/projects.test.ts \
  pages/api/activate/projects.ts \
  pages/api/activate/non-invoiceables/projects.ts
git commit -m "feat(activate): add dynamic projects API endpoints"
```

---

## Task 6: Dynamic project dropdown in PPDataFilters + PPDataTab

**Files:**
- Modify: `src/modules/activate/components/PPDataFilters.tsx`
- Modify: `src/modules/activate/components/PPDataTab.tsx`

- [ ] **Step 1: Update `PPDataFilters.tsx` — accept `projects` prop**

In `PPDataFilters.tsx`, add `projects: string[]` to `PPDataFiltersProps` and replace the hardcoded `<option>` elements:

```typescript
interface PPDataFiltersProps {
  // ... existing props ...
  projects: string[];       // ← add this
  filterProject: string;
  onProjectChange: (val: string) => void;
  // ... rest unchanged ...
}
```

Replace lines 64–68 (the hardcoded project options):

```tsx
<select
  value={filterProject}
  onChange={(e) => onProjectChange(e.target.value)}
  className="px-3 py-1.5 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]
             text-[var(--ff-text-primary)] text-sm"
>
  <option value="">All Projects</option>
  {projects.map((p) => (
    <option key={p} value={p}>{p}</option>
  ))}
</select>
```

- [ ] **Step 2: Update `PPDataTab.tsx` — fetch projects and pass to filters**

Add to the imports:
```typescript
import { useState, useCallback, useEffect, useRef } from 'react';
```
(already present — just ensure it's there)

Add project state after line 35 (`const [selectingAllUnticketed...`):
```typescript
const [projects, setProjects] = useState<string[]>([]);
```

Add a `fetchProjects` effect after `useEffect` for debounced search (around line 40):
```typescript
useEffect(() => {
  fetch('/api/activate/projects')
    .then(r => r.json())
    .then(d => { if (d.success) setProjects(d.data.projects); })
    .catch(err => log.error('Failed to fetch projects', { err }, 'PPDataTab'));
}, []);
```

Update the `<PPDataFilters>` JSX to pass `projects={projects}`.

- [ ] **Step 3: Run lint + type-check**

```bash
npm run lint -- --quiet 2>&1 | head -20
npm run type-check 2>&1 | head -20
```

Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add \
  src/modules/activate/components/PPDataFilters.tsx \
  src/modules/activate/components/PPDataTab.tsx
git commit -m "feat(activate): dynamic project dropdown in PP Data filters"
```

---

## Task 7: Dynamic project dropdown in NonInvoiceablesPage

**Files:**
- Modify: `src/modules/non-invoiceables/components/NonInvoiceablesPage.tsx`

- [ ] **Step 1: Add project state + fetch to `NonInvoiceablesPage.tsx`**

Add state near line 35 (`const [project, setProject]`):
```typescript
const [projects, setProjects] = useState<string[]>([]);
```

Add a `useEffect` to fetch projects:
```typescript
useEffect(() => {
  fetch('/api/activate/non-invoiceables/projects')
    .then(r => r.json())
    .then(d => { if (d.success || d.data) setProjects((d.data?.projects || d.projects) ?? []); })
    .catch(() => {/* silent — dropdown stays empty */});
}, []);
```

Replace lines 133–137 (hardcoded project options) with:
```tsx
<option value="">All Projects</option>
{projects.map((p) => (
  <option key={p} value={p}>{p}</option>
))}
```

- [ ] **Step 2: Run lint + type-check**

```bash
npm run lint -- --quiet 2>&1 | head -20
npm run type-check 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/non-invoiceables/components/NonInvoiceablesPage.tsx
git commit -m "feat(non-invoiceables): dynamic project dropdown"
```

---

## Task 8: Batch ticket creation — API changes

**Files:**
- Modify: `pages/api/activate/pp-data-tickets.ts`
- Modify: `pages/api/system/olt-report/tickets.ts`

The APIs need to accept either:
- Old shape: `{ pp_data_ids: number[], assigned_team_id?, ... }` (single batch, backwards compat)
- New shape: `{ batches: Array<{ pp_data_ids: number[], assigned_team_id?: string }>, ... }`

- [ ] **Step 1: Write the failing test for pp-data-tickets batch handling**

Create `src/modules/activate/__tests__/api/pp-data-tickets-batch.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizePPTicketBatches } from '@/modules/activate/services/ticketBatchService';

describe('normalizePPTicketBatches', () => {
  it('wraps old single-batch body into batches array', () => {
    const body = { pp_data_ids: [1, 2, 3], assigned_team_id: 'team-1' };
    const result = normalizePPTicketBatches(body);
    expect(result).toEqual([{ ids: [1, 2, 3], assigned_team_id: 'team-1' }]);
  });

  it('passes through new batches array unchanged', () => {
    const body = {
      batches: [
        { pp_data_ids: [1, 2], assigned_team_id: 'team-a' },
        { pp_data_ids: [3, 4], assigned_team_id: 'team-b' },
      ],
    };
    const result = normalizePPTicketBatches(body);
    expect(result).toEqual([
      { ids: [1, 2], assigned_team_id: 'team-a' },
      { ids: [3, 4], assigned_team_id: 'team-b' },
    ]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- src/modules/activate/__tests__/api/pp-data-tickets-batch.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/modules/activate/services/ticketBatchService.ts`**

```typescript
/**
 * Normalizes ticket creation request bodies to a uniform batch array.
 * Supports both old single-batch shape and new multi-batch shape.
 */

export interface TicketBatchInput {
  ids: number[];
  assigned_team_id?: string;
}

export function normalizePPTicketBatches(body: any): TicketBatchInput[] {
  if (Array.isArray(body.batches)) {
    return body.batches.map((b: any) => ({
      ids: b.pp_data_ids ?? [],
      assigned_team_id: b.assigned_team_id ?? undefined,
    }));
  }
  return [{ ids: body.pp_data_ids ?? [], assigned_team_id: body.assigned_team_id ?? undefined }];
}

export function normalizeOltTicketBatches(body: any): TicketBatchInput[] {
  if (Array.isArray(body.batches)) {
    return body.batches.map((b: any) => ({
      ids: b.record_ids ?? [],
      assigned_team_id: b.assigned_team_id ?? undefined,
    }));
  }
  return [{ ids: body.record_ids ?? [], assigned_team_id: body.assigned_team_id ?? undefined }];
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- src/modules/activate/__tests__/api/pp-data-tickets-batch.test.ts
```

Expected: PASS

- [ ] **Step 5: Update `pages/api/activate/pp-data-tickets.ts` to use batches**

In `handleCreate`, replace the destructure at the top (around line 156):

```typescript
import { normalizePPTicketBatches } from '@/modules/activate/services/ticketBatchService';
```

Replace the existing `handleCreate` body to loop over batches. Find the `const { pp_data_ids, ..., assigned_team_id } = req.body;` block and replace with:

```typescript
const {
  ticket_type: rawTicketType,
  ticket_category: rawCategory,
  priority,
  notes,
} = req.body;

const batches = normalizePPTicketBatches(req.body);

// Validate at least one batch has IDs
const totalIds = batches.reduce((sum: number, b: { ids: number[] }) => sum + b.ids.length, 0);
if (totalIds === 0) {
  return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
}
```

Then refactor `handleCreate` to loop over batches. The structure:

1. Keep all the `ticket_type` / `ticket_category` / `priority` validation **above** the loop (lines ~170–200 — unchanged)
2. Replace the `try` block (lines 202–313) with a batch loop:

```typescript
  try {
    const allTickets: { id: string; ticket_uid: string; pp_data_id: number }[] = [];
    let totalCreated = 0;
    let totalSkipped = 0;
    const projectCounts: Record<string, number> = {};

    for (const batch of batches) {
      const pp_data_ids = batch.ids;
      const assigned_team_id = batch.assigned_team_id;

      if (pp_data_ids.length === 0) continue;

      const eligible = await pool.query(
        `SELECT id, serial_number, resolved_drop_number, project, resolution_status
         FROM oes_pp_data
         WHERE id = ANY($1)
           AND maintenance_ticket_id IS NULL
           AND resolution_status != 'activated'`,
        [pp_data_ids]
      );

      const records = eligible.rows;
      totalSkipped += pp_data_ids.length - records.length;

      if (records.length === 0) continue;

      logger.info('Creating enriched PP Data tickets (batch)', {
        eligible: records.length, ticket_type, assigned_team_id: assigned_team_id || null,
      });

      // --- per-record loop is UNCHANGED from lines 226–299 ---
      for (const record of records) {
        const dr = record.resolved_drop_number;
        const serial = record.serial_number;
        const project = record.project || 'Unknown';
        projectCounts[project] = (projectCounts[project] || 0) + 1;
        const enrichment = dr ? await getEnrichmentForDR(dr, project) : await getProjectId(project);
        // ... title, description, createTicket, GPS update, link ticket — all identical ...
        // (The existing code between lines 238–299 goes here verbatim)
        allTickets.push({ id: ticket.id, ticket_uid: ticket.ticket_uid, pp_data_id: record.id });
      }

      // Send per-batch team notification
      if (assigned_team_id && allTickets.length > 0) {
        sendTeamNotification(assigned_team_id, allTickets, projectCounts).catch((err) => {
          logger.error('Failed to send team notification email', { error: err });
        });
      }
    }

    logger.info('PP Data tickets created', { created: allTickets.length, skipped: totalSkipped });
    return apiResponse.success(res, { created: allTickets.length, skipped: totalSkipped, tickets: allTickets });
  } catch (err) {
    logger.error('Failed to create PP Data tickets', { error: err });
    return apiResponse.internalError(res, err);
  }
```

**Key change:** The `const { pp_data_ids, ..., assigned_team_id } = req.body;` destructure at line 157 is replaced by the `normalizePPTicketBatches` call, and the eligible query + per-record loop is indented one level into the `for (const batch of batches)` wrapper. The per-record loop body (lines 226–299) is **copy-pasted verbatim** — only the outer variables (`pp_data_ids`, `assigned_team_id`) now come from `batch` instead of `req.body`.

- [ ] **Step 6: Update `pages/api/system/olt-report/tickets.ts` to use batches**

Same pattern. Add import:
```typescript
import { normalizeOltTicketBatches } from '@/modules/activate/services/ticketBatchService';
```

Replace `const { record_ids, ..., assigned_team_id } = req.body;` with:
```typescript
const {
  ticket_type: rawTicketType,
  ticket_category: rawCategory,
  priority,
  notes,
} = req.body;

const batches = normalizeOltTicketBatches(req.body);
const totalIds = batches.reduce((sum: number, b: { ids: number[] }) => sum + b.ids.length, 0);
if (totalIds === 0) {
  return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid record_ids');
}
```

Wrap the existing processing loop with `for (const batch of batches)` using `batch.ids` as `record_ids` and `batch.assigned_team_id`.

- [ ] **Step 7: Run lint + type-check**

```bash
npm run lint -- --quiet 2>&1 | head -20
npm run type-check 2>&1 | head -20
```

Expected: No new errors

- [ ] **Step 8: Commit**

```bash
git add \
  src/modules/activate/services/ticketBatchService.ts \
  src/modules/activate/__tests__/api/pp-data-tickets-batch.test.ts \
  pages/api/activate/pp-data-tickets.ts \
  pages/api/system/olt-report/tickets.ts
git commit -m "feat(activate): batch ticket creation API — accepts batches[] for multi-project bulk"
```

---

## Task 9: CreatePPTicketsModal — batch-per-project + auto-team

**Files:**
- Modify: `src/modules/activate/components/CreatePPTicketsModal.tsx`
- Modify: `src/modules/activate/components/PPDataTab.tsx`

The modal needs:
1. Selected records (with project info) instead of just a count
2. Project → activations team resolution from `GET /api/noc/teams?dropdown=true`
3. A "batch summary" view for mixed-project selections
4. Updated `onConfirm` signature to pass batches

- [ ] **Step 1: Write the failing test**

Create `src/modules/activate/__tests__/components/CreatePPTicketsModal.batch.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { groupRecordsByProject, resolveTeamForProject } from '@/modules/activate/services/ticketBatchService';
import type { ProjectTeamAssignment } from '@/modules/noc/types/team';

describe('groupRecordsByProject', () => {
  it('groups records by their project field', () => {
    const records = [
      { id: 1, project: 'Lawley' },
      { id: 2, project: 'Mohadin' },
      { id: 3, project: 'Lawley' },
    ];
    const groups = groupRecordsByProject(records);
    expect(groups.get('Lawley')).toEqual([1, 3]);
    expect(groups.get('Mohadin')).toEqual([2]);
  });
});

describe('resolveTeamForProject', () => {
  it('returns team_id where project_name matches and role is activations', () => {
    const assignments: ProjectTeamAssignment[] = [
      { id: 'a1', project_id: 'p1', team_id: 't1', role: 'activations', created_at: '', project_name: 'Lawley', team_name: 'Lawley Activations' },
      { id: 'a2', project_id: 'p1', team_id: 't2', role: 'maintenance', created_at: '', project_name: 'Lawley', team_name: 'Lawley Maintenance' },
    ];
    expect(resolveTeamForProject('Lawley', assignments)).toEqual({ team_id: 't1', team_name: 'Lawley Activations' });
  });

  it('returns null when no activations team configured', () => {
    expect(resolveTeamForProject('Tembisa', [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- src/modules/activate/__tests__/components/CreatePPTicketsModal.batch.test.ts
```

- [ ] **Step 3: Add `groupRecordsByProject` and `resolveTeamForProject` to `ticketBatchService.ts`**

Append to `src/modules/activate/services/ticketBatchService.ts`:

```typescript
import type { ProjectTeamAssignment } from '@/modules/noc/types/team';

/**
 * Group records by project. Generic over id type (PP uses number, OLT uses string).
 * Records with null/undefined project are grouped under 'Unknown'.
 */
export function groupRecordsByProject<T extends string | number>(
  records: Array<{ id: T; project?: string | null }>
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of records) {
    const project = r.project || 'Unknown';
    if (!map.has(project)) map.set(project, []);
    map.get(project)!.push(r.id);
  }
  return map;
}

export function resolveTeamForProject(
  projectName: string,
  assignments: ProjectTeamAssignment[]
): { team_id: string; team_name: string } | null {
  const match = assignments.find(
    (a) => a.project_name === projectName && a.role === 'activations'
  );
  if (!match) return null;
  return { team_id: match.team_id, team_name: match.team_name || match.team_id };
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- src/modules/activate/__tests__/components/CreatePPTicketsModal.batch.test.ts
```

- [ ] **Step 5: Rewrite `CreatePPTicketsModal.tsx`**

```tsx
'use client';

import { useState, useEffect } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { TeamSelector } from '@/modules/noc/components/Assignment/TeamSelector';
import { Button } from '@/components/ui/button';
import { groupRecordsByProject, resolveTeamForProject } from '@/modules/activate/services/ticketBatchService';
import type { ProjectTeamAssignment } from '@/modules/noc/types/team';

interface PPRecord { id: number; project: string; }

export interface PPTicketBatch {
  project: string;
  pp_data_ids: number[];
  assigned_team_id?: string;
  team_name?: string;
  has_team: boolean;
}

interface CreatePPTicketsModalProps {
  selectedRecords: PPRecord[];
  onConfirm: (params: {
    ticket_type: string;
    ticket_category: string;
    priority: string;
    notes: string;
    batches: PPTicketBatch[];
  }) => void;
  onClose: () => void;
  loading: boolean;
}

const TICKET_CATEGORIES = [
  { value: 'pre_provision', label: 'Pre-Provision' },
  { value: 'fault_repair', label: 'Fault Repair' },
  { value: 'modification', label: 'Modification' },
  { value: 'ont_swap', label: 'ONT Swap' },
  { value: 'new_installation', label: 'New Installation' },
];

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export function CreatePPTicketsModal({
  selectedRecords,
  onConfirm,
  onClose,
  loading,
}: CreatePPTicketsModalProps) {
  const [ticketCategory, setTicketCategory] = useState('pre_provision');
  const [priority, setPriority] = useState('normal');
  const [notes, setNotes] = useState('');
  const [assignments, setAssignments] = useState<ProjectTeamAssignment[]>([]);
  const [batches, setBatches] = useState<PPTicketBatch[]>([]);

  // Load project-team assignments once
  useEffect(() => {
    fetch('/api/noc/teams?dropdown=true')
      .then(r => r.json())
      .then(d => {
        const teams = d.data ?? [];
        const allAssignments: ProjectTeamAssignment[] = teams.flatMap(
          (t: any) => t.project_assignments ?? []
        );
        setAssignments(allAssignments);
      })
      .catch(() => {/* silent — teams remain unresolved */});
  }, []);

  // Recompute batches when records or assignments change
  useEffect(() => {
    const groups = groupRecordsByProject(selectedRecords);
    const newBatches: PPTicketBatch[] = [];
    for (const [project, ids] of groups) {
      const resolved = resolveTeamForProject(project, assignments);
      newBatches.push({
        project,
        pp_data_ids: ids,
        assigned_team_id: resolved?.team_id,
        team_name: resolved?.team_name,
        has_team: !!resolved,
      });
    }
    setBatches(newBatches);
  }, [selectedRecords, assignments]);

  const handleNotesChange = (value: string) => {
    setNotes(value);
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'No information on 1Map') {
      setPriority('normal');
    } else {
      setPriority('high');
    }
  };

  const handleTeamOverride = (project: string, teamId: string | null) => {
    setBatches(prev => prev.map(b =>
      b.project === project ? { ...b, assigned_team_id: teamId ?? undefined } : b
    ));
  };

  const totalCount = selectedRecords.length;
  const isMixed = batches.length > 1;
  const missingTeams = batches.filter(b => !b.assigned_team_id);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Create NOC Tickets</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="w-5 h-5" />
          </Button>
        </div>

        <p className="text-sm text-[var(--ff-text-secondary)]">
          Creating tickets for <strong>{totalCount}</strong> selected PP record{totalCount !== 1 ? 's' : ''}.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Ticket Type</label>
            <select
              value={ticketCategory}
              onChange={(e) => setTicketCategory(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm"
            >
              {TICKET_CATEGORIES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm"
            >
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Notes <span className="text-[var(--ff-text-tertiary)]">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="Additional notes for the tickets..."
              rows={3}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm resize-none"
            />
          </div>

          {/* Batch summary */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              {isMixed ? `${batches.length} batches will be created` : 'Assign Team'}
            </label>
            <div className="space-y-2">
              {batches.map((batch) => (
                <div key={batch.project} className="rounded border border-[var(--ff-border-light)] p-3 bg-[var(--ff-bg-secondary)]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                      {batch.project} — {batch.pp_data_ids.length} ticket{batch.pp_data_ids.length !== 1 ? 's' : ''}
                    </span>
                    {!batch.has_team && (
                      <span className="text-xs text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> no team configured
                      </span>
                    )}
                  </div>
                  <TeamSelector
                    value={batch.assigned_team_id ?? null}
                    onChange={(teamId) => handleTeamOverride(batch.project, teamId)}
                    placeholder={batch.team_name ?? 'Select team...'}
                    compact
                  />
                </div>
              ))}
            </div>
            {missingTeams.length > 0 && (
              <p className="text-xs text-amber-400 mt-1">
                {missingTeams.length} project{missingTeams.length !== 1 ? 's' : ''} will be created without a team assignment.
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => onConfirm({
              ticket_type: 'activations',
              ticket_category: ticketCategory,
              priority,
              notes,
              batches,
            })}
            disabled={loading}
            loading={loading}
          >
            {loading ? 'Creating...' : `Create ${totalCount} Ticket${totalCount !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Update `PPDataTab.tsx` to pass `selectedRecords` and handle new onConfirm**

Change `showTicketModal` section — instead of passing `selectedCount`, compute and pass `selectedRecords`:

Find line 320 (modal render) and replace:
```tsx
{showTicketModal && (
  <CreatePPTicketsModal
    selectedRecords={records.filter(r => selectedIds.includes(r.id))}
    onConfirm={handleCreateTickets}
    onClose={() => setShowTicketModal(false)}
    loading={creatingTickets}
  />
)}
```

Update `handleCreateTickets` (around line 130) to use new `batches` signature:
```typescript
const handleCreateTickets = async (params: {
  ticket_type: string;
  ticket_category: string;
  priority: string;
  notes: string;
  batches: PPTicketBatch[];
}) => {
  setCreatingTickets(true);
  try {
    const res = await fetch('/api/activate/pp-data-tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batches: params.batches.map(b => ({
          pp_data_ids: b.pp_data_ids,
          assigned_team_id: b.assigned_team_id,
        })),
        ticket_type: params.ticket_type,
        ticket_category: params.ticket_category,
        priority: params.priority,
        notes: params.notes,
      }),
    });
    const data = await res.json();
    if (data.success) {
      toast.success(`Created ${data.data.created} ticket${data.data.created !== 1 ? 's' : ''}`);
      setShowTicketModal(false);
      setSelectedIds([]);
      await fetchRecords();
      await fetchStats();
    } else {
      toast.error(data.error?.message || 'Failed to create tickets');
    }
  } catch {
    toast.error('Failed to create tickets');
  } finally {
    setCreatingTickets(false);
  }
};
```

Add the import at the top of PPDataTab:
```typescript
import type { PPTicketBatch } from './CreatePPTicketsModal';
```

- [ ] **Step 7: Run lint + type-check**

```bash
npm run lint -- --quiet 2>&1 | head -20
npm run type-check 2>&1 | head -20
```

- [ ] **Step 8: Commit**

```bash
git add \
  src/modules/activate/services/ticketBatchService.ts \
  src/modules/activate/__tests__/components/CreatePPTicketsModal.batch.test.ts \
  src/modules/activate/components/CreatePPTicketsModal.tsx \
  src/modules/activate/components/PPDataTab.tsx
git commit -m "feat(activate): batch-per-project PP ticket creation with auto-team assignment"
```

---

## Task 10: CreateOltTicketsModal — batch-per-project + auto-team

**Files:**
- Modify: `src/modules/data-sync/components/groups/olt/CreateOltTicketsModal.tsx`
- Modify: `src/modules/data-sync/components/groups/olt/OltInvestigateTab.tsx`

- [ ] **Step 1: Rewrite `CreateOltTicketsModal.tsx`**

Same pattern as CreatePPTicketsModal but for OLT records:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { TeamSelector } from '@/modules/noc/components/Assignment/TeamSelector';
import { groupRecordsByProject, resolveTeamForProject } from '@/modules/activate/services/ticketBatchService';
import type { ProjectTeamAssignment } from '@/modules/noc/types/team';

interface OltRecord { id: number | string; project: string; }

export interface OltTicketBatch {
  project: string;
  record_ids: (number | string)[];
  assigned_team_id?: string;
  team_name?: string;
  has_team: boolean;
}

interface CreateOltTicketsModalProps {
  selectedRecords: OltRecord[];
  onConfirm: (params: { ticket_type: string; priority: string; notes: string; batches: OltTicketBatch[] }) => void;
  onClose: () => void;
  loading: boolean;
}

const TICKET_TYPES = [
  { value: 'olt_investigation', label: 'ONT not found' },
  { value: 'serial_mismatch', label: 'Serial Mismatch' },
  { value: 'fault_repair', label: 'Fault Repair' },
  { value: 'ont_swap', label: 'ONT Swap' },
];

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export function CreateOltTicketsModal({ selectedRecords, onConfirm, onClose, loading }: CreateOltTicketsModalProps) {
  const [ticketType, setTicketType] = useState('olt_investigation');
  const [priority, setPriority] = useState('normal');
  const [notes, setNotes] = useState('');
  const [assignments, setAssignments] = useState<ProjectTeamAssignment[]>([]);
  const [batches, setBatches] = useState<OltTicketBatch[]>([]);

  useEffect(() => {
    fetch('/api/noc/teams?dropdown=true')
      .then(r => r.json())
      .then(d => {
        const allAssignments: ProjectTeamAssignment[] = (d.data ?? []).flatMap(
          (t: any) => t.project_assignments ?? []
        );
        setAssignments(allAssignments);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // groupRecordsByProject is generic — works with string IDs (OLT) and number IDs (PP).
    // OltRecord.project is optional, fallback handled inside groupRecordsByProject.
    const groups = groupRecordsByProject(
      selectedRecords.map(r => ({ id: r.id, project: r.project }))
    );
    const newBatches: OltTicketBatch[] = [];
    for (const [project, ids] of groups) {
      const resolved = resolveTeamForProject(project, assignments);
      newBatches.push({ project, record_ids: ids, assigned_team_id: resolved?.team_id, team_name: resolved?.team_name, has_team: !!resolved });
    }
    setBatches(newBatches);
  }, [selectedRecords, assignments]);

  const handleTeamOverride = (project: string, teamId: string | null) => {
    setBatches(prev => prev.map(b =>
      b.project === project ? { ...b, assigned_team_id: teamId ?? undefined } : b
    ));
  };

  const totalCount = selectedRecords.length;
  const isMixed = batches.length > 1;
  const missingTeams = batches.filter(b => !b.assigned_team_id);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Create Investigation Tickets</h3>
          <button onClick={onClose} className="text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-[var(--ff-text-secondary)]">
          Creating tickets for <strong>{totalCount}</strong> OLT mismatch record{totalCount !== 1 ? 's' : ''}.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Ticket Type</label>
            <select value={ticketType} onChange={(e) => setTicketType(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm">
              {TICKET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm">
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Notes <span className="text-[var(--ff-text-tertiary)]">(optional)</span>
            </label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes for the investigation tickets..."
              rows={3}
              className="w-full px-3 py-2 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm resize-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              {isMixed ? `${batches.length} batches will be created` : 'Assign Team'}
            </label>
            <div className="space-y-2">
              {batches.map((batch) => (
                <div key={batch.project} className="rounded border border-[var(--ff-border-light)] p-3 bg-[var(--ff-bg-secondary)]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                      {batch.project} — {batch.record_ids.length} ticket{batch.record_ids.length !== 1 ? 's' : ''}
                    </span>
                    {!batch.has_team && (
                      <span className="text-xs text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> no team configured
                      </span>
                    )}
                  </div>
                  <TeamSelector
                    value={batch.assigned_team_id ?? null}
                    onChange={(teamId) => handleTeamOverride(batch.project, teamId)}
                    placeholder={batch.team_name ?? 'Select team...'}
                    compact
                  />
                </div>
              ))}
            </div>
            {missingTeams.length > 0 && (
              <p className="text-xs text-amber-400 mt-1">
                {missingTeams.length} project{missingTeams.length !== 1 ? 's' : ''} will be created without a team assignment.
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} disabled={loading}
            className="px-4 py-2 text-sm rounded border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]">
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ ticket_type: ticketType, priority, notes, batches })}
            disabled={loading}
            className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
            {loading ? <><InlineSpinner size="sm" /> Creating...</> : `Create ${totalCount} Ticket${totalCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `OltInvestigateTab.tsx` to pass `selectedRecords`**

Find the `CreateOltTicketsModal` render and update it:

First, find the selected records from existing state. In `OltInvestigateTab.tsx`, the `records` and `selectedIds` are available. Find the modal render and change:

```tsx
{/* Old: selectedCount={selectedIds.length} */}
{showBulkModal && (
  <CreateOltTicketsModal
    selectedRecords={records.filter(r => selectedIds.has(r.id))}
    onConfirm={handleBulkTicket}
    onClose={() => setShowBulkModal(false)}
    loading={isCreatingTickets}
  />
)}
```

Update `handleBulkTicket` to use batches:
```typescript
const handleBulkTicket = async (params: { ticket_type: string; priority: string; notes: string; batches: OltTicketBatch[] }) => {
  // ... existing loading/toast logic ...
  const body = {
    batches: params.batches.map(b => ({
      record_ids: b.record_ids,
      assigned_team_id: b.assigned_team_id,
    })),
    ticket_type: params.ticket_type,
    priority: params.priority,
    notes: params.notes,
  };
  // POST to /api/system/olt-report/tickets with body
};
```

Add import at top of OltInvestigateTab:
```typescript
import type { OltTicketBatch } from './CreateOltTicketsModal';
```

- [ ] **Step 3: Run lint + type-check**

```bash
npm run lint -- --quiet 2>&1 | head -20
npm run type-check 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add \
  src/modules/data-sync/components/groups/olt/CreateOltTicketsModal.tsx \
  src/modules/data-sync/components/groups/olt/OltInvestigateTab.tsx
git commit -m "feat(olt): batch-per-project OLT ticket creation with auto-team assignment"
```

---

## Task 11: Admin UI — Projects column in NOC Teams

**Files:**
- Create: `src/modules/noc/components/TeamProjectAssignments.tsx`
- Modify: `app/(main)/noc/teams/client.tsx`

- [ ] **Step 1: Create `TeamProjectAssignments.tsx` — inline editor component**

```tsx
'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import type { ProjectTeamAssignment } from '@/modules/noc/types/team';

interface Project { id: string; project_name: string; }

interface TeamProjectAssignmentsProps {
  teamId: string;
  assignments: ProjectTeamAssignment[];
  onChanged: () => void;
}

const ROLES = [
  { value: 'activations', label: 'Activations' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'fault_repair', label: 'Fault Repair' },
  { value: 'other', label: 'Other' },
];

export function TeamProjectAssignments({ teamId, assignments, onChanged }: TeamProjectAssignmentsProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newProjectId, setNewProjectId] = useState('');
  const [newRole, setNewRole] = useState<'activations' | 'maintenance' | 'fault_repair' | 'other'>('activations');
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    // Uses pipeline projects API — returns { data: Array<{ id, project_name, ... }> }
    fetch('/api/pipeline/projects?limit=200')
      .then(r => r.json())
      .then(d => setProjects(d.data ?? []))
      .catch(() => {});
  }, []);

  const handleAdd = async () => {
    if (!newProjectId) return;
    setSaving(true);
    try {
      await fetch('/api/noc/project-team-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: newProjectId, team_id: teamId, role: newRole }),
      });
      setNewProjectId('');
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    setRemovingId(id);
    try {
      await fetch(`/api/noc/project-team-assignments/${id}`, { method: 'DELETE' });
      onChanged();
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-2 min-w-[260px]">
      {assignments.length === 0 && (
        <span className="text-xs text-[var(--ff-text-tertiary)]">No project assignments</span>
      )}
      {assignments.map((a) => (
        <div key={a.id} className="flex items-center gap-2 text-xs">
          <span className="text-[var(--ff-text-primary)] font-medium">{a.project_name}</span>
          <span className="text-[var(--ff-text-tertiary)] capitalize">({a.role})</span>
          <button
            onClick={() => handleRemove(a.id)}
            disabled={removingId === a.id}
            className="ml-auto text-[var(--ff-text-tertiary)] hover:text-red-400 transition-colors"
          >
            {removingId === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1 pt-1 border-t border-[var(--ff-border-light)]">
        <select
          value={newProjectId}
          onChange={e => setNewProjectId(e.target.value)}
          className="text-xs px-1.5 py-1 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] flex-1 min-w-0"
        >
          <option value="">Project...</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.project_name}</option>)}
        </select>
        <select
          value={newRole}
          onChange={e => setNewRole(e.target.value as typeof newRole)}
          className="text-xs px-1.5 py-1 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]"
        >
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <button
          onClick={handleAdd}
          disabled={!newProjectId || saving}
          className="p-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `app/(main)/noc/teams/client.tsx` list view**

Add "Projects" column header in the table `<thead>` after the Lead column (line ~381):

```tsx
<th className="text-left px-4 py-3 text-[var(--ff-text-secondary)] font-medium hidden lg:table-cell">Projects</th>
```

Add the Projects cell in each row after the Lead cell:

```tsx
<td className="px-4 py-3 hidden lg:table-cell">
  <TeamProjectAssignmentsCell team={team} onChanged={refetch} />
</td>
```

Add the inline component at the bottom of `client.tsx`:

```tsx
import { useState } from 'react';
import { TeamProjectAssignments } from '@/modules/noc/components/TeamProjectAssignments';
import type { ProjectTeamAssignment } from '@/modules/noc/types/team';

function TeamProjectAssignmentsCell({ team, onChanged }: { team: Team & { project_assignments?: ProjectTeamAssignment[] }; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const assignments = team.project_assignments ?? [];
  const label = assignments.length === 0
    ? '—'
    : assignments.map(a => `${a.project_name} (${a.role})`).join(', ');

  if (!open) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] text-left truncate max-w-[200px]"
        title={label}
      >
        {label}
      </button>
    );
  }

  return (
    <div onClick={e => e.stopPropagation()}>
      <TeamProjectAssignments
        teamId={team.id}
        assignments={assignments}
        onChanged={() => { setOpen(false); onChanged(); }}
      />
    </div>
  );
}
```

**Approach:** Fetch assignments separately via `GET /api/noc/project-team-assignments` and merge client-side by `team_id`. This avoids touching the `useTeams` hook or the teams API — cleaner separation, no risk to existing consumers.

Add to `TeamsPageClient`:
```typescript
const [allAssignments, setAllAssignments] = useState<ProjectTeamAssignment[]>([]);

useEffect(() => {
  fetch('/api/noc/project-team-assignments')
    .then(r => r.json())
    .then(d => setAllAssignments(d.data ?? []))
    .catch(() => {});
}, []);

// Enrich teams with their assignments
const teamsWithAssignments = useMemo(() =>
  teams.map(t => ({
    ...t,
    project_assignments: allAssignments.filter(a => a.team_id === t.id),
  })),
  [teams, allAssignments]
);
```

Use `teamsWithAssignments` instead of `teams` in the render.

Add a `refreshAssignments` callback for use when assignments are added/removed:
```typescript
const refreshAssignments = useCallback(() => {
  fetch('/api/noc/project-team-assignments')
    .then(r => r.json())
    .then(d => setAllAssignments(d.data ?? []))
    .catch(() => {});
}, []);
```

Pass `refreshAssignments` (not `refetch`) as `onChanged` to `TeamProjectAssignmentsCell`.

- [ ] **Step 3: Run lint + type-check**

```bash
npm run lint -- --quiet 2>&1 | head -20
npm run type-check 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add \
  src/modules/noc/components/TeamProjectAssignments.tsx \
  app/(main)/noc/teams/client.tsx
git commit -m "feat(noc): add Projects column with inline assignment editor to Teams list"
```

---

## Task 12: Final QA — run CI and verify

- [ ] **Step 1: Run full test suite**

```bash
cd /home/hein/Workspace/FF_Next.js-dynamic-tickets
npm test 2>&1 | tail -30
```

Expected: All tests pass, no regressions

- [ ] **Step 2: Run CI quick check**

```bash
npm run ci:quick 2>&1 | tail -30
```

Expected: Passes lint ratchet

- [ ] **Step 3: Type-check**

```bash
npm run type-check 2>&1 | grep -E "error|Error" | head -20
```

Expected: No errors

- [ ] **Step 4: Push branch and open PR**

```bash
cd /home/hein/Workspace/FF_Next.js-dynamic-tickets
git push -u origin feature/dynamic-ticket-projects-teams
```

Then run `/pr` to create the PR.

---

## Spec Coverage Check

| Spec requirement | Task |
|-----------------|------|
| Dynamic projects from DB | Tasks 5, 6, 7 |
| Junction table with roles | Task 1 |
| Admin UI in NOC Teams | Task 11 |
| Auto-assign activations team | Tasks 9, 10 |
| Mixed-project batch summary | Tasks 9, 10 |
| Batch API support | Task 8 |
| PP Data filters dynamic | Task 6 |
| Non-invoiceables filters dynamic | Task 7 |
| OLT Investigate already dynamic | ✅ pre-existing |
| project_assignments in team dropdown | Task 4 |
| Non-invoiceables `CreateTicketModal` batch logic | Deferred — that modal is shared across multiple issue categories with different project sources; batch grouping there requires separate design |
