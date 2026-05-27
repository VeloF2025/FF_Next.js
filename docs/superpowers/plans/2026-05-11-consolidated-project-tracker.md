# Consolidated Project Tracker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 4 parallel tracking systems with one module at `/tracker` — a PM-grade spreadsheet-like workspace backed by real data from field systems.

**Architecture:** Three layers within a single `/tracker` page — (1) cross-project KPI dashboard, (2) per-project Build Tracker reading `pon_stage_tracking` as source of truth with PM override via `pon_manual_overrides`, (3) per-project Financial Tracker using AG Grid Community Edition over `master_tracker` with the broken POST fixed. Each layer ships as its own PR.

**Tech Stack:** Next.js 14 App Router, AG Grid Community 33, ExcelJS (already in project), pg Pool (`@/lib/db`), existing FibreFlow dark theme (slate-800/900), Lucide icons.

---

## Critical constraints — read before touching any code

- `pon_manual_overrides` is lazy-insert (row may not exist). **ALL joins MUST use `LEFT JOIN`.**
- `master_tracker.project_id` is `TEXT` (not `UUID`). Cast with `::uuid` when joining to `projects`.
- `pon_stage_tracking.scope_string` = metres of stringing — never label it as a count.
- All API routes use `@/lib/apiResponse` for responses.
- No `console.log` — use `log` from `@/lib/logger`.
- All changes go through PRs — never commit directly to master.
- Migration numbers: last applied = 341. Next = **342**.
- Do NOT re-add `chk_pon_or_drop` constraint to `pon_change_log` — it was intentionally dropped.

---

## File map

### PR A — Fix + AG Grid (modify only existing files)
| Action | File |
|--------|------|
| Modify | `app/api/tracker/master/[projectId]/route.ts` — fix POST body |
| Modify | `app/api/tracker/export/pon/[projectId]/route.ts` — fix wrong table |
| Modify | `src/modules/tracker/components/MasterTrackerTable.tsx` — AG Grid |
| Modify | `src/modules/tracker/components/MasterTrackerPage.tsx` — save wire-up |
| Create | `scripts/migrations/sql/342_fix_scope_string_comment.sql` |
| Create | `scripts/migrations/sql/rollback_342_fix_scope_string_comment.sql` |

### PR B — Build Tracker (pon_stage_tracking UI)
| Action | File |
|--------|------|
| Create | `app/api/tracker/build/[projectId]/route.ts` — read pon_stage_tracking |
| Create | `app/api/tracker/build/[projectId]/overrides/route.ts` — upsert pon_manual_overrides |
| Create | `src/modules/tracker/components/BuildTrackerPage.tsx` |
| Modify | `src/modules/tracker/types.ts` — add BuildRow type |
| Modify | `app/(main)/tracker/page.tsx` — rename PON tab → Build, wire component |

### PR C — Dashboard + cleanup
| Action | File |
|--------|------|
| Create | `app/api/tracker/dashboard/route.ts` |
| Create | `src/modules/tracker/components/DashboardPage.tsx` |
| Modify | `app/(main)/tracker/page.tsx` — add Dashboard tab |
| Modify | `src/modules/tracker/.claude.md` — update quick reference |

---

## PR A — Fix + AG Grid

### Task A1: Fix migration 342 — update scope_string column comment

**Files:**
- Create: `scripts/migrations/sql/342_fix_scope_string_comment.sql`
- Create: `scripts/migrations/sql/rollback_342_fix_scope_string_comment.sql`

- [ ] **Step 1: Write migration**

```sql
-- Migration 342: Correct pon_stage_tracking.scope_string column comment
-- The comment incorrectly said "Scoped stringing length / count".
-- scope_string is metres of stringing, never a count.
COMMENT ON COLUMN pon_stage_tracking.scope_string IS 'Scoped stringing length in metres for this PON.';
```

- [ ] **Step 2: Write rollback**

```sql
-- Rollback 342
COMMENT ON COLUMN pon_stage_tracking.scope_string IS 'Scoped stringing length / count for this PON.';
```

- [ ] **Step 3: Apply migration**

```bash
npm run db:migrate
```

Expected output: `▶ 342: fix scope string comment` then `✓ 342 applied in Xms`

- [ ] **Step 4: Verify**

```bash
psql "$DATABASE_URL_MIGRATIONS" -c "SELECT col_description('pon_stage_tracking'::regclass, attnum) FROM pg_attribute WHERE attrelid = 'pon_stage_tracking'::regclass AND attname = 'scope_string';"
```

Expected: `Scoped stringing length in metres for this PON.`

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/sql/342_fix_scope_string_comment.sql scripts/migrations/sql/rollback_342_fix_scope_string_comment.sql
git commit -m "fix(tracker): correct scope_string column comment to say metres"
```

---

### Task A2: Fix master_tracker POST body mismatch

**Files:**
- Modify: `app/api/tracker/master/[projectId]/route.ts`

The POST handler reads `body[col]` treating body as a flat single-row object. The UI sends `{ rows: MasterRow[] }`. Fix: iterate `body.rows` and upsert each row. Rows with an `id` get UPDATEd; rows without get INSERTed.

- [ ] **Step 1: Verify the bug**

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM master_tracker;"
```

Open browser → `/tracker?tab=master` → import any row → click Save → verify count still the same (confirming the silent no-op bug).

- [ ] **Step 2: Replace top-of-file imports and add DATA_COLS constant**

Replace the neon import block at the top of `app/api/tracker/master/[projectId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { pool } from '@/lib/db-pool';
import { log } from '@/lib/logger';

// All writable columns (excludes id, created_at, updated_at which are auto-set)
const DATA_COLS = [
  'project_id', 'site', 'phase', 'dr', 'zone_no', 'hld_pon', 'zone_pon',
  'pole_label', 'unique_pole_label', 'pole_scope', 'pole_type', 'pole_route_type',
  'pole_permission_date', 'pole_install_date', 'pole_cwc_date', 'pole_contractor',
  'pole_rate', 'pole_paid_date', 'pole_invoice_no', 'pole_comment',
  'civil_description', 'civil_rate', 'civil_qty', 'civil_total',
  'civil_invoice_no', 'civil_invoice_date', 'civil_comment',
  'stringing_description', 'stringing_rate', 'stringing_qty', 'stringing_total',
  'stringing_invoice_no', 'stringing_date', 'stringing_comment',
  'signup_date', 'home_install_date', 'home_contractor', 'home_rate',
  'home_paid_date', 'home_invoice_no', 'activation_code', 'activation_date',
  'activation_team', 'activation_rate', 'activation_paid_date', 'activation_invoice_no',
  'remittance', 'remittance_date', 'cwc_pole_status', 'cwc_stringing_status',
  'cwc_qa_submit_date', 'cwc_qa_approved_date', 'qa_home_recon_no', 'exfo_exchange',
  'optical_contractor', 'optical_type', 'optical_splitter', 'optical_prepping',
  'optical_splicing', 'qa_photos_loaded', 'atp_qa_submit_date', 'atp_qa_approved_date',
  'testing_status', 'test_submitted', 'olt_port_activation', 'olt_port_activated',
  'pon_status', 'optical_rate', 'optical_invoice_date', 'optical_invoice_no',
] as const;

interface Params {
  params: Promise<{ projectId: string }>;
}
```

- [ ] **Step 3: Replace GET handler**

```typescript
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectId } = await params;
    const { rows } = await pool.query(
      `SELECT * FROM master_tracker WHERE project_id = $1 ORDER BY zone_no, hld_pon, zone_pon`,
      [projectId]
    );
    return NextResponse.json({ data: rows });
  } catch (err) {
    log.error('[tracker/master GET]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to fetch master tracker' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Replace POST handler**

```typescript
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectId } = await params;
    const body = await req.json() as { rows?: Record<string, unknown>[] };
    const rows = body.rows ?? [];

    if (rows.length === 0) {
      return NextResponse.json({ data: [] }, { status: 200 });
    }

    const writeCols = DATA_COLS.filter((c) => c !== 'project_id');
    const client = await pool.connect();
    const results: Record<string, unknown>[] = [];
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        if (row.id) {
          // Update existing row — build SET clause for non-project_id columns
          const setClauses = writeCols.map((c, i) => `${c} = $${i + 2}`).join(', ');
          const updateVals = [row.id, ...writeCols.map((c) => row[c] ?? null)];
          const { rows: updated } = await client.query(
            `UPDATE master_tracker SET ${setClauses}, updated_at = NOW()
             WHERE id = $1 AND project_id = '${projectId}' RETURNING *`,
            updateVals
          );
          if (updated[0]) results.push(updated[0]);
        } else {
          // Insert new row
          const values = DATA_COLS.map((col) =>
            col === 'project_id' ? projectId : (row[col] ?? null)
          );
          const placeholders = DATA_COLS.map((_, i) => `$${i + 1}`).join(', ');
          const { rows: inserted } = await client.query(
            `INSERT INTO master_tracker (${DATA_COLS.join(', ')}) VALUES (${placeholders}) RETURNING *`,
            values
          );
          if (inserted[0]) results.push(inserted[0]);
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    return NextResponse.json({ data: results }, { status: 200 });
  } catch (err) {
    log.error('[tracker/master POST]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to save master tracker' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Verify the fix compiles**

```bash
npm run build 2>&1 | grep -E "error TS" | grep "tracker/master" | head -20
```

Expected: no errors for this file.

- [ ] **Step 6: Manual smoke test**

Open browser → `/tracker?tab=master` → select a project → import an Excel file with 2–3 rows → click Save → confirm row count in DB increased.

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM master_tracker;"
```

- [ ] **Step 7: Commit**

```bash
git add app/api/tracker/master/[projectId]/route.ts
git commit -m "fix(tracker): fix master_tracker POST body mismatch — read rows array, upsert per row"
```

---

### Task A3: Fix PON export reading ghost table

**Files:**
- Modify: `app/api/tracker/export/pon/[projectId]/route.ts`

The export query reads `FROM pon_tracker` (a ghost table with 1 test row) instead of `pon_stage_tracking`.

- [ ] **Step 1: Verify ghost table row count**

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM pon_tracker; SELECT COUNT(*) FROM pon_stage_tracking;"
```

Expected: `pon_tracker` ≈ 1 row, `pon_stage_tracking` has real data.

- [ ] **Step 2: Replace the import at the top of the file**

```typescript
// Replace:
import { neon } from '@neondatabase/serverless';
const db = neon(process.env.DATABASE_URL!);

// With:
import { pool as db } from '@/lib/db-pool';
```

- [ ] **Step 3: Replace the query**

Find and replace the `db.query(...)` call:

```typescript
const { rows } = await db.query(
  `SELECT
     p.zone_no,
     p.hld_pon,
     p.z_pon,
     p.olt_port,
     p.permissions_approved::text         AS scope_poles,
     NULL::text                           AS scope_drops,
     TO_CHAR(p.permissions_first_date, 'YYYY-MM-DD') AS pole_permission,
     p.poles_planted,
     TO_CHAR(p.cwc_first_date,  'YYYY-MM-DD') AS cwc_poles_date,
     TO_CHAR(p.cwc_last_date,   'YYYY-MM-DD') AS cwc_stringing_date,
     TO_CHAR(p.optical_first_date, 'YYYY-MM-DD') AS ready_for_optical,
     CASE WHEN p.cwc_complete >= p.cwc_total AND p.cwc_total > 0 THEN true ELSE false END AS cwc_qa,
     TO_CHAR(p.optical_first_date,  'YYYY-MM-DD') AS optical_splicing_date,
     TO_CHAR(p.optical_last_date,   'YYYY-MM-DD') AS optical_submitted_date,
     TO_CHAR(p.atp_first_date,      'YYYY-MM-DD') AS optical_activated_date,
     CASE WHEN p.atp_passed >= p.atp_total AND p.atp_total > 0 THEN true ELSE false END AS atp_qa,
     p.sign_ups,
     p.homes_po,
     p.homes_recon,
     p.activation_complete AS activated,
     p.available,
     COALESCE(o.blockage, p.blockage) AS blockage
   FROM pon_stage_tracking p
   LEFT JOIN pon_manual_overrides o ON o.pon_stage_id = p.id
   WHERE p.project_id = $1
   ORDER BY p.zone_no, p.hld_pon`,
  [projectId]
);
```

Also remove the `RouteParams` interface and update the function signature to use Next.js App Router pattern:

```typescript
interface Params { params: Promise<{ projectId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { projectId } = await params;
  // ... rest of handler
```

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | grep -E "error TS" | grep "export/pon" | head -10
```

- [ ] **Step 5: Test export**

Open browser → `/tracker?tab=pon` → select a project → click Export Excel → verify downloaded file has real PON data rows (more than 1).

- [ ] **Step 6: Commit**

```bash
git add app/api/tracker/export/pon/[projectId]/route.ts
git commit -m "fix(tracker): PON export reads pon_stage_tracking not ghost pon_tracker table"
```

---

### Task A4: Replace MasterTrackerTable with AG Grid Community

**Files:**
- Modify: `src/modules/tracker/components/MasterTrackerTable.tsx`
- Modify: `src/modules/tracker/components/MasterTrackerPage.tsx`

AG Grid Community Edition is free, handles 5000+ rows, has frozen columns, inline editing, and clipboard paste from Excel.

- [ ] **Step 1: Install AG Grid**

```bash
npm install ag-grid-community ag-grid-react
```

Verify:

```bash
grep "ag-grid" package.json
```

Expected: `"ag-grid-community"` and `"ag-grid-react"` present.

- [ ] **Step 2: Rewrite MasterTrackerTable.tsx**

Replace the entire contents of `src/modules/tracker/components/MasterTrackerTable.tsx`:

```typescript
'use client';

import { useCallback, useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, CellValueChangedEvent } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import type { MasterRow } from '../types/master-tracker.types';

export interface MasterTrackerTableProps {
  rows: MasterRow[];
  editMode: boolean;
  selectLists: Record<string, string[]>;
  filters: Record<string, Set<string>>;
  onRowChange: (rowIndex: number, field: string, value: unknown) => void;
  onFilterChange: (field: string, values: Set<string>) => void;
}

export const MASTER_COLS: ColDef<MasterRow>[] = [
  { field: 'zone_no',         headerName: 'Zone',        width: 80,  pinned: 'left', sortable: true },
  { field: 'hld_pon',         headerName: 'HLD PON',     width: 100, pinned: 'left', sortable: true },
  { field: 'zone_pon',        headerName: 'Zone PON',    width: 100 },
  { field: 'dr',              headerName: 'DR',          width: 100 },
  { field: 'site',            headerName: 'Site',        width: 120 },
  { field: 'phase',           headerName: 'Phase',       width: 80 },
  { field: 'pole_label',      headerName: 'Pole Label',  width: 120 },
  { field: 'pole_scope',      headerName: 'Pole Scope',  width: 120 },
  { field: 'pole_type',       headerName: 'Pole Type',   width: 120 },
  { field: 'pole_contractor', headerName: 'Pole Contractor', width: 150 },
  { field: 'pole_rate',       headerName: 'Pole Rate',   width: 110, type: 'numericColumn' },
  { field: 'pole_install_date', headerName: 'Pole Install', width: 130 },
  { field: 'pole_cwc_date',   headerName: 'Pole CWC',    width: 120 },
  { field: 'pole_paid_date',  headerName: 'Pole Paid',   width: 120 },
  { field: 'pole_invoice_no', headerName: 'Pole Invoice', width: 130 },
  { field: 'civil_description', headerName: 'Civil Desc', width: 150 },
  { field: 'civil_rate',      headerName: 'Civil Rate',  width: 110, type: 'numericColumn' },
  { field: 'civil_qty',       headerName: 'Civil Qty',   width: 100, type: 'numericColumn' },
  { field: 'civil_total',     headerName: 'Civil Total', width: 110, type: 'numericColumn' },
  { field: 'civil_invoice_no', headerName: 'Civil Invoice', width: 130 },
  { field: 'civil_invoice_date', headerName: 'Civil Inv Date', width: 140 },
  { field: 'stringing_description', headerName: 'String Desc', width: 150 },
  { field: 'stringing_rate',  headerName: 'String Rate', width: 120, type: 'numericColumn' },
  { field: 'stringing_qty',   headerName: 'String Qty',  width: 110, type: 'numericColumn' },
  { field: 'stringing_total', headerName: 'String Total', width: 120, type: 'numericColumn' },
  { field: 'stringing_invoice_no', headerName: 'String Invoice', width: 140 },
  { field: 'stringing_date',  headerName: 'String Date', width: 130 },
  { field: 'optical_contractor', headerName: 'Optical Contractor', width: 160 },
  { field: 'optical_type',    headerName: 'Optical Type', width: 130 },
  { field: 'optical_splitter', headerName: 'Splitter',   width: 110 },
  { field: 'optical_rate',    headerName: 'Optical Rate', width: 120, type: 'numericColumn' },
  { field: 'optical_invoice_no', headerName: 'Optical Invoice', width: 140 },
  { field: 'atp_qa_submit_date', headerName: 'ATP Submit', width: 130 },
  { field: 'atp_qa_approved_date', headerName: 'ATP Approved', width: 140 },
  { field: 'activation_code', headerName: 'Activation Code', width: 140 },
  { field: 'activation_date', headerName: 'Activation Date', width: 140 },
  { field: 'activation_team', headerName: 'Activation Team', width: 150 },
  { field: 'activation_rate', headerName: 'Activation Rate', width: 140, type: 'numericColumn' },
  { field: 'pon_status',      headerName: 'PON Status',  width: 130 },
];

export function MasterTrackerTable({
  rows,
  editMode,
  onRowChange,
}: MasterTrackerTableProps) {
  const defaultColDef = useMemo<ColDef>(() => ({
    editable: editMode,
    resizable: true,
    filter: true,
    sortable: true,
  }), [editMode]);

  const onCellValueChanged = useCallback((e: CellValueChangedEvent<MasterRow>) => {
    const rowIndex = e.rowIndex ?? 0;
    onRowChange(rowIndex, e.colDef.field as string, e.newValue);
  }, [onRowChange]);

  return (
    <div
      className="ag-theme-alpine-dark w-full"
      style={{ height: 'calc(100vh - 200px)' }}
    >
      <AgGridReact<MasterRow>
        rowData={rows}
        columnDefs={MASTER_COLS}
        defaultColDef={defaultColDef}
        onCellValueChanged={onCellValueChanged}
        rowHeight={36}
        headerHeight={40}
        suppressRowClickSelection
        enableCellTextSelection
        clipboardDelimiter="\t"
      />
    </div>
  );
}
```

- [ ] **Step 3: Add onRowChange handler to MasterTrackerPage**

In `src/modules/tracker/components/MasterTrackerPage.tsx`, add this callback (after the `handleCancel` function):

```typescript
const handleRowChange = useCallback((rowIndex: number, field: string, value: unknown) => {
  setRows((prev) => {
    const next = [...prev];
    next[rowIndex] = { ...next[rowIndex], [field]: value } as MasterRow;
    return next;
  });
  if (!editMode) setEditMode(true);
}, [editMode]);
```

Then update the `<MasterTrackerTable>` usage to pass `onRowChange={handleRowChange}`.

- [ ] **Step 4: Build check**

```bash
npm run build 2>&1 | grep -E "error TS" | grep -E "MasterTracker|tracker" | head -20
```

Expected: no TypeScript errors.

- [ ] **Step 5: Smoke test**

Open `http://localhost:3004/tracker?tab=master` → select a project → verify AG Grid renders with Zone + HLD PON frozen left → click Edit Mode → change a cell → Save → verify DB row updated.

- [ ] **Step 6: Commit**

```bash
git add src/modules/tracker/components/MasterTrackerTable.tsx \
        src/modules/tracker/components/MasterTrackerPage.tsx
git commit -m "feat(tracker): replace custom table with AG Grid Community in Financial Tracker"
```

---

### Task A5: Create PR A

- [ ] **Step 1: CI check**

```bash
npm run ci:quick
```

Expected: passes lint gates (no new lint errors).

- [ ] **Step 2: Create PR**

```bash
gh pr create \
  --title "fix(tracker): save bug, PON export table fix, AG Grid for Financial Tracker" \
  --body "$(cat <<'EOF'
## Summary
- Fix master_tracker POST body mismatch (UI sends {rows:[]} but API was reading flat object) — now upserts all rows in a transaction
- Fix PON Excel export reading ghost pon_tracker table instead of pon_stage_tracking  
- Replace custom MasterTrackerTable with AG Grid Community (free, frozen columns, Excel paste)
- Migration 342: correct scope_string column comment to say "metres"

## Test plan
- [ ] Import rows into Master Tracker → Save → verify row count in DB increases
- [ ] Export PON Tracker → verify Excel contains real PON data (not 1 ghost row)
- [ ] Master Tracker renders AG Grid with Zone + HLD PON frozen on left
- [ ] Inline cell editing works in Edit Mode

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Invoke /review and wait for APPROVED before merging**

---

## PR B — Build Tracker (pon_stage_tracking UI)

### Task B1: Build Tracker API — read endpoint

**Files:**
- Create: `app/api/tracker/build/[projectId]/route.ts`

- [ ] **Step 1: Create the directory and route file**

```typescript
/**
 * GET /api/tracker/build/[projectId]
 * Returns pon_stage_tracking rows with pon_manual_overrides merged.
 * LEFT JOIN mandatory — overrides are lazy-insert (may not exist per PON).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { pool } from '@/lib/db-pool';
import { log } from '@/lib/logger';

interface Params { params: Promise<{ projectId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectId } = await params;

    const { rows } = await pool.query(
      `SELECT
         p.id,
         p.project_id,
         p.zone_no,
         p.pon_no,
         p.hld_pon,
         p.z_pon,
         p.olt_port,
         p.overall_stage,
         p.permissions_total,    p.permissions_approved,
         p.permissions_first_date, p.permissions_last_date,
         p.poles_total,           p.poles_planted,
         p.poles_first_date,      p.poles_last_date,
         p.cwc_total,             p.cwc_complete,
         p.cwc_first_date,        p.cwc_last_date,
         p.cwc_target_date,
         p.optical_total,         p.optical_complete,
         p.optical_first_date,    p.optical_last_date,
         p.optical_target_date,
         p.atp_total,             p.atp_passed,
         p.atp_first_date,        p.atp_last_date,
         p.activation_total,      p.activation_complete,
         p.activation_first_date, p.activation_last_date,
         p.activation_target_date,
         p.maintenance_total,     p.maintenance_complete,
         p.sign_ups,
         p.homes_po,
         p.homes_recon,
         p.available,
         p.scope_string,
         p.pct_original,
         p.pct_recon,
         p.blockage           AS auto_blockage,
         p.last_synced_at,
         p.sync_source,
         o.blockage           AS pm_blockage,
         o.civil_contractor,
         o.stringing_contractor,
         o.optical_contractor,
         o.optical_splitter,
         o.optical_type,
         o.atp_submitter_notes,
         o.override_notes,
         o.updated_by         AS override_updated_by,
         o.updated_at         AS override_updated_at
       FROM pon_stage_tracking p
       LEFT JOIN pon_manual_overrides o ON o.pon_stage_id = p.id
       WHERE p.project_id = $1
       ORDER BY p.zone_no, p.hld_pon, p.pon_no`,
      [projectId]
    );

    return NextResponse.json({ data: rows });
  } catch (err) {
    log.error('[tracker/build GET]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to fetch build tracker' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Test the API directly**

```bash
# Get a real project ID:
PROJECT_ID=$(psql "$DATABASE_URL" -t -c "SELECT id FROM projects WHERE project_name='Lawley' LIMIT 1;" | tr -d ' ')
curl -s "http://localhost:3004/api/tracker/build/$PROJECT_ID" | jq '.data | length'
```

Expected: number > 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/tracker/build/[projectId]/route.ts
git commit -m "feat(tracker/build): GET endpoint for pon_stage_tracking with manual overrides"
```

---

### Task B2: Build Tracker API — overrides write endpoint

**Files:**
- Create: `app/api/tracker/build/[projectId]/overrides/route.ts`

Upserts a single `pon_manual_overrides` row. Uses `INSERT ... ON CONFLICT DO UPDATE`.

- [ ] **Step 1: Create the override route**

```typescript
/**
 * PATCH /api/tracker/build/[projectId]/overrides
 * Body: { pon_stage_id: string, field: string, value: unknown }
 * Upserts pon_manual_overrides for the given pon_stage_id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { pool } from '@/lib/db-pool';
import { log } from '@/lib/logger';

const ALLOWED_FIELDS = new Set([
  'blockage', 'civil_contractor', 'stringing_contractor',
  'optical_contractor', 'optical_splitter', 'optical_type',
  'atp_submitter_notes', 'override_notes',
]);

interface Params { params: Promise<{ projectId: string }> }
interface OverrideBody { pon_stage_id: string; field: string; value: unknown }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await params;
    const body = await req.json() as OverrideBody;

    if (!body.pon_stage_id || !body.field) {
      return NextResponse.json({ error: 'pon_stage_id and field required' }, { status: 400 });
    }
    if (!ALLOWED_FIELDS.has(body.field)) {
      return NextResponse.json({ error: `Field '${body.field}' is not PM-editable` }, { status: 400 });
    }

    const { rows } = await pool.query(
      `INSERT INTO pon_manual_overrides (pon_stage_id, ${body.field}, updated_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (pon_stage_id) DO UPDATE
         SET ${body.field} = EXCLUDED.${body.field},
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
       RETURNING *`,
      [body.pon_stage_id, body.value ?? null, auth.userId]
    );

    return NextResponse.json({ data: rows[0] });
  } catch (err) {
    log.error('[tracker/build/overrides PATCH]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to save override' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Test idempotency**

```bash
STAGE_ID=$(psql "$DATABASE_URL" -t -c "SELECT id FROM pon_stage_tracking LIMIT 1;" | tr -d ' ')
# First call — inserts:
curl -s -X PATCH "http://localhost:3004/api/tracker/build/any/overrides" \
  -H "Content-Type: application/json" \
  -d "{\"pon_stage_id\":\"$STAGE_ID\",\"field\":\"blockage\",\"value\":\"Test note\"}" | jq .data.blockage
# Second call — updates:
curl -s -X PATCH "http://localhost:3004/api/tracker/build/any/overrides" \
  -H "Content-Type: application/json" \
  -d "{\"pon_stage_id\":\"$STAGE_ID\",\"field\":\"blockage\",\"value\":\"Updated note\"}" | jq .data.blockage
```

Expected: `"Test note"` then `"Updated note"`.

- [ ] **Step 3: Commit**

```bash
git add app/api/tracker/build/[projectId]/overrides/route.ts
git commit -m "feat(tracker/build): PATCH override endpoint — upsert pon_manual_overrides"
```

---

### Task B3: BuildTrackerPage component

**Files:**
- Modify: `src/modules/tracker/types.ts` — add BuildRow
- Create: `src/modules/tracker/components/BuildTrackerPage.tsx`
- Modify: `app/(main)/tracker/page.tsx` — rename tab + wire component

- [ ] **Step 1: Add BuildRow to types.ts**

Append to `src/modules/tracker/types.ts`:

```typescript
export interface BuildRow {
  id: string;
  project_id: string;
  zone_no: number;
  pon_no: number;
  hld_pon: number | null;
  z_pon: number | null;
  olt_port: string | null;
  overall_stage: string;
  permissions_total: number; permissions_approved: number;
  poles_total: number; poles_planted: number;
  cwc_total: number; cwc_complete: number;
  cwc_target_date: string | null;
  optical_total: number; optical_complete: number;
  optical_target_date: string | null;
  atp_total: number; atp_passed: number;
  activation_total: number; activation_complete: number;
  activation_target_date: string | null;
  sign_ups: number | null;
  homes_po: number | null;
  homes_recon: number | null;
  available: number | null;
  scope_string: number | null; // metres of stringing
  pct_original: number | null;
  pct_recon: number | null;
  auto_blockage: string | null;
  last_synced_at: string;
  sync_source: string;
  pm_blockage: string | null;
  civil_contractor: string | null;
  stringing_contractor: string | null;
  optical_contractor: string | null;
  override_notes: string | null;
  override_updated_by: string | null;
  override_updated_at: string | null;
}
```

- [ ] **Step 2: Create BuildTrackerPage.tsx**

Create `src/modules/tracker/components/BuildTrackerPage.tsx`:

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle2, Circle, AlertCircle } from 'lucide-react';
import type { BuildRow } from '../types';
import { log } from '@/lib/logger';

const STAGE_ORDER = [
  'not_started', 'permissions', 'poles', 'cwc',
  'optical', 'atp', 'activation', 'maintenance', 'complete',
];

const STAGE_LABELS: Record<string, string> = {
  not_started: 'Not Started', permissions: 'Permissions', poles: 'Poles',
  cwc: 'CWC', optical: 'Optical', atp: 'ATP',
  activation: 'Activation', maintenance: 'Maintenance', complete: 'Complete',
};

const STAGE_COLORS: Record<string, string> = {
  not_started: 'bg-slate-600',
  permissions: 'bg-amber-500',
  poles: 'bg-orange-500',
  cwc: 'bg-yellow-500',
  optical: 'bg-cyan-500',
  atp: 'bg-blue-500',
  activation: 'bg-violet-500',
  maintenance: 'bg-pink-500',
  complete: 'bg-green-500',
};

function StageBar({ complete, total, stage }: { complete: number; total: number; stage: string }) {
  if (total === 0) return <span className="text-slate-600 text-xs">—</span>;
  const pct = Math.round((complete / total) * 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden min-w-[40px]">
        <div
          className={`h-full rounded-full ${STAGE_COLORS[stage] ?? 'bg-slate-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-400 whitespace-nowrap">{complete}/{total}</span>
    </div>
  );
}

export function BuildTrackerPage({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<BuildRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tracker/build/${projectId}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = (await res.json()) as { data?: BuildRow[] };
      setRows(json.data ?? []);
    } catch (err) {
      log.error('BuildTrackerPage: fetch failed', { err, projectId }, 'tracker');
      setError('Failed to load build tracker data');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  async function saveOverride(ponStageId: string, field: string, value: string) {
    try {
      const res = await fetch(`/api/tracker/build/${projectId}/overrides`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pon_stage_id: ponStageId, field, value: value || null }),
      });
      if (!res.ok) throw new Error('Save failed');
      const displayField = field === 'blockage' ? 'pm_blockage' : field;
      setRows((prev) => prev.map((r) =>
        r.id === ponStageId ? { ...r, [displayField]: value || null } : r
      ));
    } catch (err) {
      log.error('BuildTrackerPage: override save failed', { err, ponStageId, field }, 'tracker');
    }
    setEditingCell(null);
  }

  if (loading) return <div className="py-16 text-center text-slate-500">Loading build tracker…</div>;
  if (error) return <div className="py-16 text-center text-red-400">{error}</div>;
  if (rows.length === 0) return (
    <div className="py-16 text-center text-slate-500">
      No PON data found — field systems have not synced yet.
    </div>
  );

  return (
    <div className="overflow-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60">
        <span className="text-sm text-slate-400">{rows.length} PONs · Click blockage cell to edit</span>
        <button
          onClick={() => void fetchData()}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-800/80 text-slate-300 text-xs">
            <th className="px-3 py-2.5 text-left font-medium sticky left-0 bg-slate-800 z-10 w-16">Zone</th>
            <th className="px-3 py-2.5 text-left font-medium w-20">PON</th>
            <th className="px-3 py-2.5 text-left font-medium w-28">OLT Port</th>
            <th className="px-3 py-2.5 text-left font-medium w-28">Stage</th>
            <th className="px-3 py-2.5 text-left font-medium w-36">Permissions</th>
            <th className="px-3 py-2.5 text-left font-medium w-36">Poles</th>
            <th className="px-3 py-2.5 text-left font-medium w-36">CWC</th>
            <th className="px-3 py-2.5 text-left font-medium w-36">Optical</th>
            <th className="px-3 py-2.5 text-left font-medium w-36">ATP</th>
            <th className="px-3 py-2.5 text-left font-medium w-36">Activation</th>
            <th className="px-3 py-2.5 text-right font-medium w-24">String (m)</th>
            <th className="px-3 py-2.5 text-right font-medium w-20">Sign-ups</th>
            <th className="px-3 py-2.5 text-left font-medium w-48">Blockage</th>
            <th className="px-3 py-2.5 text-left font-medium w-32">Last Sync</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const blockage = row.pm_blockage ?? row.auto_blockage;
            const isEditing = editingCell?.id === row.id && editingCell.field === 'blockage';
            return (
              <tr
                key={row.id}
                className={`border-t border-slate-700/40 hover:bg-slate-800/40 ${i % 2 !== 0 ? 'bg-slate-800/20' : ''}`}
              >
                <td className="px-3 py-2 sticky left-0 bg-inherit font-medium text-slate-200 text-sm">
                  {row.zone_no}
                </td>
                <td className="px-3 py-2 text-slate-300">{row.hld_pon ?? row.pon_no}</td>
                <td className="px-3 py-2 text-slate-400 font-mono text-xs">{row.olt_port ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${STAGE_COLORS[row.overall_stage] ?? 'bg-slate-600'} bg-opacity-20 text-white`}>
                    {row.overall_stage === 'complete'
                      ? <CheckCircle2 className="w-3 h-3" />
                      : row.overall_stage === 'not_started'
                      ? <Circle className="w-3 h-3" />
                      : <AlertCircle className="w-3 h-3" />}
                    {STAGE_LABELS[row.overall_stage] ?? row.overall_stage}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <StageBar complete={row.permissions_approved} total={row.permissions_total} stage="permissions" />
                </td>
                <td className="px-3 py-2">
                  <StageBar complete={row.poles_planted} total={row.poles_total} stage="poles" />
                </td>
                <td className="px-3 py-2">
                  <StageBar complete={row.cwc_complete} total={row.cwc_total} stage="cwc" />
                </td>
                <td className="px-3 py-2">
                  <StageBar complete={row.optical_complete} total={row.optical_total} stage="optical" />
                </td>
                <td className="px-3 py-2">
                  <StageBar complete={row.atp_passed} total={row.atp_total} stage="atp" />
                </td>
                <td className="px-3 py-2">
                  <StageBar complete={row.activation_complete} total={row.activation_total} stage="activation" />
                </td>
                <td className="px-3 py-2 text-right text-slate-400 text-xs">
                  {row.scope_string != null ? `${row.scope_string}m` : '—'}
                </td>
                <td className="px-3 py-2 text-right text-slate-400 text-xs">{row.sign_ups ?? '—'}</td>
                <td className="px-3 py-2">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => void saveOverride(row.id, 'blockage', editValue)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveOverride(row.id, 'blockage', editValue);
                        if (e.key === 'Escape') setEditingCell(null);
                      }}
                      className="w-full bg-slate-700 border border-blue-500 rounded px-2 py-1 text-xs text-slate-100 outline-none"
                    />
                  ) : (
                    <span
                      onClick={() => { setEditingCell({ id: row.id, field: 'blockage' }); setEditValue(blockage ?? ''); }}
                      className={`cursor-text block min-h-[1.5rem] rounded px-1 hover:bg-slate-700/60 text-xs ${blockage ? 'text-amber-400' : 'text-slate-600'}`}
                    >
                      {blockage ?? 'Click to add…'}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {row.last_synced_at
                    ? new Date(row.last_synced_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
                    : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Update tracker page — rename PON tab and wire BuildTrackerPage**

In `app/(main)/tracker/page.tsx`:

1. Replace the `PonTrackerPage` import with `BuildTrackerPage`:
```typescript
import { BuildTrackerPage } from '@/modules/tracker/components/BuildTrackerPage';
```

2. Update the TABS definition — rename label:
```typescript
{ id: 'pon', label: 'Build Tracker', icon: Table2 },
```

3. In the tab content render, replace `<PonTrackerPage .../>` with `<BuildTrackerPage .../>`:
```typescript
) : activeTab === 'pon' ? (
  projects.length === 0 ? (
    <div className="py-16 text-center text-slate-500">No active projects found.</div>
  ) : selectedId ? (
    <BuildTrackerPage key={selectedId} projectId={selectedId} />
  ) : null
```

- [ ] **Step 4: Build + smoke test**

```bash
npm run build 2>&1 | grep -E "error TS" | head -20
```

Open `http://localhost:3004/tracker` → Build Tracker tab → select Lawley → verify:
- PON rows appear with stage progress bars
- Blockage cell is editable (click → type → blur → reload → persisted)
- scope_string column labelled "String (m)"
- PONs with no overrides still show (LEFT JOIN working)

- [ ] **Step 5: Commit**

```bash
git add app/api/tracker/build/ \
        src/modules/tracker/components/BuildTrackerPage.tsx \
        src/modules/tracker/types.ts \
        app/\(main\)/tracker/page.tsx
git commit -m "feat(tracker): Build Tracker tab — pon_stage_tracking with PM blockage editing"
```

---

### Task B4: Create PR B

- [ ] **Step 1: CI**

```bash
npm run ci:quick
```

- [ ] **Step 2: Create PR**

```bash
gh pr create \
  --title "feat(tracker): Build Tracker tab from pon_stage_tracking with PM overrides" \
  --body "$(cat <<'EOF'
## Summary
- New Build Tracker tab replaces the PON Tracker tab
- Reads pon_stage_tracking (authoritative source) with LEFT JOIN pon_manual_overrides
- Per-PON progress bars for each build stage (permissions → activation)
- PMs click-to-edit blockage notes — saved to pon_manual_overrides via PATCH endpoint
- scope_string labelled as "String (m)" (metres, not a count)

## Test plan
- [ ] Build Tracker shows real PON rows (not 1 ghost row from pon_tracker)
- [ ] Stage progress bars reflect pon_stage_tracking counts
- [ ] Click blockage cell → type → blur → verify saved to DB
- [ ] PONs without overrides still render (LEFT JOIN working)
- [ ] scope_string column labelled "String (m)"

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Invoke /review**

---

## PR C — Cross-project Dashboard + cleanup

### Task C1: Dashboard API

**Files:**
- Create: `app/api/tracker/dashboard/route.ts`

- [ ] **Step 1: Create the file**

```typescript
/**
 * GET /api/tracker/dashboard
 * Cross-project aggregate KPIs from pon_stage_tracking.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { pool } from '@/lib/db-pool';
import { log } from '@/lib/logger';

export async function GET(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { rows } = await pool.query(
      `SELECT
         pr.id           AS project_id,
         pr.project_name,
         COUNT(p.id)::int                                            AS total_pons,
         COALESCE(SUM(p.permissions_approved), 0)::int               AS permissions_approved,
         COALESCE(SUM(p.permissions_total), 0)::int                  AS permissions_total,
         COALESCE(SUM(p.poles_planted), 0)::int                      AS poles_planted,
         COALESCE(SUM(p.poles_total), 0)::int                        AS poles_total,
         COALESCE(SUM(p.cwc_complete), 0)::int                       AS cwc_complete,
         COALESCE(SUM(p.cwc_total), 0)::int                          AS cwc_total,
         COALESCE(SUM(p.optical_complete), 0)::int                   AS optical_complete,
         COALESCE(SUM(p.optical_total), 0)::int                      AS optical_total,
         COALESCE(SUM(p.atp_passed), 0)::int                         AS atp_passed,
         COALESCE(SUM(p.atp_total), 0)::int                          AS atp_total,
         COALESCE(SUM(p.activation_complete), 0)::int                AS activation_complete,
         COALESCE(SUM(p.activation_total), 0)::int                   AS activation_total,
         COUNT(CASE WHEN p.overall_stage = 'complete' THEN 1 END)::int AS pons_complete,
         COALESCE(SUM(p.sign_ups), 0)::int                           AS sign_ups,
         COALESCE(SUM(p.homes_po), 0)::int                           AS homes_po,
         MAX(p.last_synced_at)                                        AS last_synced_at
       FROM projects pr
       LEFT JOIN pon_stage_tracking p ON p.project_id = pr.id
       WHERE pr.is_active = true
       GROUP BY pr.id, pr.project_name
       ORDER BY pr.project_name`
    );

    return NextResponse.json({ data: rows });
  } catch (err) {
    log.error('[tracker/dashboard GET]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to fetch dashboard' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Test**

```bash
curl -s "http://localhost:3004/api/tracker/dashboard" | jq '.data[] | {project_name, total_pons, activation_complete}'
```

Expected: rows for each active project with real counts.

- [ ] **Step 3: Commit**

```bash
git add app/api/tracker/dashboard/route.ts
git commit -m "feat(tracker/dashboard): cross-project KPI aggregate API"
```

---

### Task C2: DashboardPage component + wire tab

**Files:**
- Create: `src/modules/tracker/components/DashboardPage.tsx`
- Modify: `app/(main)/tracker/page.tsx`

- [ ] **Step 1: Create DashboardPage.tsx**

```typescript
'use client';

import { useState, useEffect } from 'react';
import { BarChart3, CheckCircle2, Zap } from 'lucide-react';
import { log } from '@/lib/logger';

interface ProjectKpi {
  project_id: string;
  project_name: string;
  total_pons: number;
  permissions_approved: number; permissions_total: number;
  poles_planted: number; poles_total: number;
  cwc_complete: number; cwc_total: number;
  optical_complete: number; optical_total: number;
  atp_passed: number; atp_total: number;
  activation_complete: number; activation_total: number;
  pons_complete: number;
  sign_ups: number;
  homes_po: number;
  last_synced_at: string | null;
}

function pct(n: number, d: number): string {
  if (!d) return '—';
  return `${Math.round((n / d) * 100)}%`;
}

export function DashboardPage() {
  const [projects, setProjects] = useState<ProjectKpi[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tracker/dashboard')
      .then((r) => r.json())
      .then((j: { data?: ProjectKpi[] }) => setProjects(j.data ?? []))
      .catch((err) => log.error('DashboardPage: fetch failed', { err }, 'tracker'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-16 text-center text-slate-500">Loading dashboard…</div>;
  if (projects.length === 0) return <div className="py-16 text-center text-slate-500">No active projects.</div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <BarChart3 className="w-5 h-5 text-blue-400" />
        <h2 className="text-base font-semibold text-slate-100">Cross-project Overview</h2>
        <span className="text-xs text-slate-500">{projects.length} active projects</span>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-800/80 text-slate-300 text-xs">
              <th className="px-4 py-2.5 text-left font-medium">Project</th>
              <th className="px-4 py-2.5 text-right font-medium">PONs</th>
              <th className="px-4 py-2.5 text-right font-medium">Done</th>
              <th className="px-4 py-2.5 text-right font-medium">Perms</th>
              <th className="px-4 py-2.5 text-right font-medium">Poles</th>
              <th className="px-4 py-2.5 text-right font-medium">CWC</th>
              <th className="px-4 py-2.5 text-right font-medium">Optical</th>
              <th className="px-4 py-2.5 text-right font-medium">ATP</th>
              <th className="px-4 py-2.5 text-right font-medium">Activated</th>
              <th className="px-4 py-2.5 text-right font-medium">Sign-ups</th>
              <th className="px-4 py-2.5 text-left font-medium">Last Sync</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p, i) => (
              <tr
                key={p.project_id}
                className={`border-t border-slate-700/40 hover:bg-slate-800/40 ${i % 2 !== 0 ? 'bg-slate-800/20' : ''}`}
              >
                <td className="px-4 py-3 font-medium text-slate-200">{p.project_name}</td>
                <td className="px-4 py-3 text-right text-slate-400">{p.total_pons}</td>
                <td className="px-4 py-3 text-right">
                  <span className="flex items-center justify-end gap-1 text-green-400">
                    <CheckCircle2 className="w-3 h-3" />
                    {p.pons_complete}
                    <span className="text-slate-500 text-xs">/{p.total_pons}</span>
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-slate-400">{pct(p.permissions_approved, p.permissions_total)}</td>
                <td className="px-4 py-3 text-right text-slate-400">{pct(p.poles_planted, p.poles_total)}</td>
                <td className="px-4 py-3 text-right text-slate-400">{pct(p.cwc_complete, p.cwc_total)}</td>
                <td className="px-4 py-3 text-right text-slate-400">{pct(p.optical_complete, p.optical_total)}</td>
                <td className="px-4 py-3 text-right text-slate-400">{pct(p.atp_passed, p.atp_total)}</td>
                <td className="px-4 py-3 text-right">
                  <span className="flex items-center justify-end gap-1 text-violet-400">
                    <Zap className="w-3 h-3" />
                    {pct(p.activation_complete, p.activation_total)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-slate-400">{p.sign_ups || '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {p.last_synced_at
                    ? new Date(p.last_synced_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: '2-digit' })
                    : 'Never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add Dashboard tab to tracker page**

In `app/(main)/tracker/page.tsx`, make these changes:

1. Add import:
```typescript
import { DashboardPage } from '@/modules/tracker/components/DashboardPage';
```

2. Add `'dashboard'` to the Tab type:
```typescript
type Tab = 'dashboard' | 'pon' | 'master' | 'settings';
```

3. Replace `LayoutGrid` icon import with `BarChart3` and add tab:
```typescript
import { Table2, BarChart3, Settings } from 'lucide-react';

const TABS = [
  { id: 'dashboard' as const, label: 'Dashboard', icon: BarChart3 },
  { id: 'pon' as const, label: 'Build Tracker', icon: Table2 },
  // ... existing master + settings tabs
];
```

4. Default tab should now be `'dashboard'`:
```typescript
const activeTab: Tab = tabParam && ['dashboard', 'pon', 'master', 'settings'].includes(tabParam) ? tabParam as Tab : 'dashboard';
```

5. Add Dashboard case in the content render:
```typescript
{activeTab === 'dashboard' ? (
  <DashboardPage />
) : activeTab === 'pon' ? (
  // ... existing build tracker content
```

- [ ] **Step 3: Build + smoke test**

```bash
npm run build 2>&1 | grep -E "error TS" | head -20
```

Open `http://localhost:3004/tracker` → Dashboard tab → verify cross-project table with stage percentages.

- [ ] **Step 4: Commit**

```bash
git add src/modules/tracker/components/DashboardPage.tsx \
        app/\(main\)/tracker/page.tsx
git commit -m "feat(tracker): cross-project Dashboard tab with per-stage completion percentages"
```

---

### Task C3: Retire standalone duplicate pages

**Files:**
- Check + remove: `app/(main)/tracker/pon/page.tsx`
- Check + remove: `app/(main)/tracker/master/page.tsx`

- [ ] **Step 1: Check for inbound links**

```bash
grep -r "/tracker/pon\|/tracker/master" src/ app/ pages/ --include="*.tsx" --include="*.ts" -l | grep -v node_modules
```

For each file found, update the link to `/tracker?tab=pon` or `/tracker?tab=master`.

- [ ] **Step 2: Check standalone page contents**

```bash
cat app/\(main\)/tracker/pon/page.tsx
cat app/\(main\)/tracker/master/page.tsx
```

If these are just thin wrappers re-rendering the same components, remove them:

```bash
rm app/\(main\)/tracker/pon/page.tsx
rm app/\(main\)/tracker/master/page.tsx
```

- [ ] **Step 3: Build verify**

```bash
npm run build 2>&1 | grep -E "error TS" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(tracker): remove standalone /tracker/pon and /tracker/master pages"
```

---

### Task C4: Update .claude.md quick reference

**Files:**
- Modify: `src/modules/tracker/.claude.md`

- [ ] **Step 1: Replace module quick reference**

```markdown
# tracker module

## Purpose
Consolidated project tracker at `/tracker` — four tabs:
1. **Dashboard** — cross-project KPI overview (pon_stage_tracking aggregates)
2. **Build Tracker** — per-project PON-level build progress from pon_stage_tracking
3. **Financial Tracker** — per-project pole/contractor rows from master_tracker (AG Grid)
4. **Settings** — dropdown value management

## Data Sources
| Layer | Table | Notes |
|-------|-------|-------|
| Build Tracker | `pon_stage_tracking` LEFT JOIN `pon_manual_overrides` | Overrides are lazy-insert — LEFT JOIN mandatory |
| Financial Tracker | `master_tracker` | project_id is TEXT, cast to UUID at boundaries |
| Dashboard | `pon_stage_tracking` aggregated per project | |

## Critical Rules
- `scope_string` = metres of stringing (never a count) — label as "String (m)"
- `pon_manual_overrides` is lazy-insert (may not exist). ALL joins = LEFT JOIN
- `master_tracker.project_id` is TEXT — cast `::uuid` when joining to `projects`
- PM editable fields: blockage, civil_contractor, stringing_contractor, optical_contractor, optical_splitter, optical_type, atp_submitter_notes, override_notes
- AG Grid uses `ag-theme-alpine-dark` class

## API Endpoints
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/tracker/dashboard` | GET | Cross-project KPIs |
| `/api/tracker/build/[projectId]` | GET | PON build rows with overrides |
| `/api/tracker/build/[projectId]/overrides` | PATCH | Upsert pon_manual_overrides |
| `/api/tracker/master/[projectId]` | GET / POST | Financial tracker rows |
| `/api/tracker/export/pon/[projectId]` | GET | Excel export (reads pon_stage_tracking) |
| `/api/tracker/export/master/[projectId]` | GET | Excel export of master_tracker |
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/tracker/.claude.md
git commit -m "docs(tracker): update .claude.md for consolidated tracker module"
```

---

### Task C5: Create PR C

- [ ] **Step 1: CI check**

```bash
npm run ci:quick
```

- [ ] **Step 2: Create PR**

```bash
gh pr create \
  --title "feat(tracker): Dashboard tab + retire standalone tracker pages" \
  --body "$(cat <<'EOF'
## Summary
- New Dashboard tab: cross-project KPI table with % complete per build stage
- Retire standalone /tracker/pon and /tracker/master pages (consolidated into tabbed /tracker)
- Update tracker .claude.md quick reference

## Test plan
- [ ] Dashboard shows all active projects with real stage completion percentages
- [ ] Navigating /tracker/pon or /tracker/master returns 404 or redirects cleanly
- [ ] No broken sidebar nav links
- [ ] Default tab is Dashboard

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Invoke /review and wait for APPROVED before merging**

---

## Self-review

### Spec coverage

| Requirement | Task |
|-------------|------|
| Fix master_tracker save bug | A2 |
| Fix PON export wrong table | A3 |
| AG Grid for Financial Tracker | A4 |
| Build Tracker reading pon_stage_tracking | B1–B3 |
| PM override editing (blockage, contractors) | B2 |
| scope_string labelled as metres | A1, B3 header |
| Cross-project dashboard | C1–C2 |
| Retire ghost pon_tracker table usage | A3 |
| Remove duplicate standalone pages | C3 |
| .claude.md updated | C4 |
| pon_manual_overrides LEFT JOIN respected | B1, B2 |
| master_tracker.project_id cast at boundary | A2 |

### Placeholder scan

No TBD, TODO, "fill in later", or "similar to Task N" patterns found.

### Type consistency

- `BuildRow` defined `types.ts` Task B3 Step 1 → used in `BuildTrackerPage.tsx` Step 2 ✓
- `MasterRow` from `master-tracker.types.ts` unchanged ✓
- `DATA_COLS` array in route.ts matches existing `MasterRow` fields ✓
- AG Grid `ColDef<MasterRow>` field names match `MasterRow` interface ✓
- `ALLOWED_FIELDS` in override endpoint matches live `pon_manual_overrides` columns (confirmed from DB) ✓

### Migration sequence

342 = scope_string comment fix. No migrations needed for PR B or C — `pon_stage_tracking` and `pon_manual_overrides` exist from 1.0a.
