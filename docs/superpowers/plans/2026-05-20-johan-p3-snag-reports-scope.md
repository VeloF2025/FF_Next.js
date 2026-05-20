# P3 — Per-pole / per-PON / per-zone snag reports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let managers generate per-pole / per-PON / per-zone snag PDF + Excel reports from the Works-QA Field App, persist them as immutable snapshots, and surface them in the existing snag-reports library with a source filter.

**Architecture:** New SQL migration adds scope columns + `source='scope'` to `snag_reports`. New POST route runs a scoped query, INSERTs a row, renders HTML via the existing universal report template, runs Puppeteer → PDF, uploads to VF Storage, writes `pdf_url` back. A separate GET route regenerates Excel on demand. New context-aware button in `WorksQAPage` opens a multi-scope dialog; existing `SnagReportsPage` gains a `source` filter chip.

**Tech Stack:** Next.js 14 Pages Router · TypeScript · `pg.Pool` via `@/lib/db-pool` · Puppeteer (already wired) · `xlsx` library · Vitest · Playwright · VF Storage (HTTP upload pattern from `pages/api/storage/upload.ts`).

**Spec:** `docs/superpowers/specs/2026-05-20-johan-p3-snag-reports-scope-design.md` (commit `823877e5b`).

**Spec deltas locked in this plan:**
- Migration number **358** (spec said 357; that number is already taken twice by `357_field_default_location` and `357_ft_pre_provisions_outstanding`).
- Permission keys use **dot notation** matching existing codebase: `construction-qa.snags.report.read` (not `qa:report:read`). `construction-qa.snags.report.delete` for the new delete permission.
- All new routes import `sql` from `@/lib/db-pool` (the `pg.Pool`-backed neon-compatible wrapper), **not** `@neondatabase/serverless`. The existing `pages/api/snags/reports.ts` still uses the shim but P3 work does NOT migrate it (out of scope).

---

## File map

**Create:**
- `scripts/migrations/sql/358_snag_reports_scope.sql`
- `scripts/migrations/sql/rollback_358_snag_reports_scope.sql`
- `src/modules/construction-qa/services/reportNumberGenerator.ts` (< 80 lines)
- `src/modules/construction-qa/services/reportNumberGenerator.test.ts`
- `src/modules/construction-qa/services/snagReportRenderer.ts` (< 250 lines)
- `src/modules/construction-qa/services/snagReportRenderer.test.ts`
- `src/modules/construction-qa/services/snagReportXlsx.ts` (< 200 lines)
- `src/modules/construction-qa/services/snagReportXlsx.test.ts`
- `pages/api/snags/reports-scope.ts` (< 250 lines)
- `pages/api/snags/reports-scope-pdf.ts` (< 80 lines)
- `pages/api/snags/reports-scope-xlsx.ts` (< 100 lines)
- `pages/api/snags/__tests__/reports-scope.test.ts`
- `pages/api/snags/__tests__/reports-scope-xlsx.test.ts`
- `pages/api/snags/__tests__/reports-source-filter.test.ts`
- `src/modules/works-qa/hooks/useReportScopeForm.ts` (< 100 lines)
- `src/modules/works-qa/hooks/__tests__/useReportScopeForm.test.ts`
- `src/modules/works-qa/components/SnagReportButton.tsx` (< 120 lines)
- `src/modules/works-qa/components/SnagReportScopeDialog.tsx` (< 200 lines)
- `src/modules/works-qa/components/ScopeChipPicker.tsx` (< 150 lines)
- `src/modules/works-qa/components/WorksQAPageHeader.tsx` (extracted from WorksQAPage, < 100 lines)
- `tests/e2e/p3-snag-report-flow.spec.ts`

**Modify:**
- `pages/api/snags/reports.ts` — add `?source=` filter (extend existing handler, ~15 LOC delta)
- `src/modules/works-qa/components/WorksQAPage.tsx` — extract header, render `<SnagReportButton />` (net negative LOC after extraction)
- `src/modules/construction-qa/components/snags/SnagReportsPage.tsx` — add source filter chip + scope card variant
- Permission seed file (located in Task 11)

---

## DAG

```
T1  Migration 358
T2  reportNumberGenerator
T3  snagReportRenderer (HTML only, no puppeteer)
T4  POST /api/snags/reports-scope  (depends on T1, T2, T3)
T5  GET PDF stream + Excel render  (depends on T4)
T6  GET /api/snags/reports ?source= filter  (depends on T1)
T7  useReportScopeForm hook
T8  SnagReportScopeDialog + ScopeChipPicker  (depends on T7)
T9  SnagReportButton + WorksQAPage refactor  (depends on T8)
T10 SnagReportsPage library filter chip  (depends on T6)
T11 Permission seed for construction-qa.snags.report.delete
T12 Playwright e2e smoke test  (depends on T9, T10)
T13 /review, dev deploy, Johan WA
```

T1–T6 are backend and run sequentially. T7 can start in parallel with backend. T8 needs T7. T9 needs T8. T10 needs T6. T12 needs everything. T13 is the gate.

---

## Task 1: Migration 358 — `snag_reports` scope columns

**Files:**
- Create: `scripts/migrations/sql/358_snag_reports_scope.sql`
- Create: `scripts/migrations/sql/rollback_358_snag_reports_scope.sql`
- Test: `tests/migrations/358_snag_reports_scope.test.ts`

- [ ] **Step 1.1: Write the failing test**

```typescript
// tests/migrations/358_snag_reports_scope.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from '@/lib/db-pool';

describe('migration 358 — snag_reports scope columns', () => {
  beforeAll(async () => {
    // Migration runner is expected to have applied 358 already in CI; this test
    // verifies the resulting schema shape.
  });

  it('adds scope, scope_zone_no, scope_pon_no, scope_poles columns', async () => {
    const rows = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'snag_reports'
        AND column_name IN ('scope', 'scope_zone_no', 'scope_pon_no', 'scope_poles',
                            'scope_from_date', 'scope_to_date', 'scope_severities',
                            'scope_categories', 'pdf_url', 'generated_by', 'generated_at')
      ORDER BY column_name
    `;
    expect(rows.map(r => r.column_name)).toEqual([
      'generated_at', 'generated_by', 'pdf_url',
      'scope', 'scope_categories', 'scope_from_date', 'scope_pon_no',
      'scope_poles', 'scope_severities', 'scope_to_date', 'scope_zone_no',
    ]);
  });

  it('extends source check to allow "scope"', async () => {
    await expect(sql`
      INSERT INTO snag_reports (project_id, report_number, source, audit_date,
                                pdf_url, generated_at)
      VALUES ((SELECT id FROM projects LIMIT 1),
              'SCOPE-TEST-20260520-1', 'scope', CURRENT_DATE,
              'https://example/test.pdf', NOW())
      RETURNING id
    `).resolves.toHaveLength(1);
    // Cleanup
    await sql`DELETE FROM snag_reports WHERE report_number = 'SCOPE-TEST-20260520-1'`;
  });

  it('enforces scope rows require pdf_url and generated_at', async () => {
    await expect(sql`
      INSERT INTO snag_reports (project_id, report_number, source, audit_date)
      VALUES ((SELECT id FROM projects LIMIT 1),
              'SCOPE-TEST-NULL-PDF', 'scope', CURRENT_DATE)
    `).rejects.toThrow(/snag_reports_scope_requires_pdf/);
  });

  it('creates snag_reports_scope_idx', async () => {
    const rows = await sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'snag_reports' AND indexname = 'snag_reports_scope_idx'
    `;
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npx vitest run tests/migrations/358_snag_reports_scope.test.ts`
Expected: FAIL — columns do not yet exist on `snag_reports`.

- [ ] **Step 1.3: Write the migration**

```sql
-- scripts/migrations/sql/358_snag_reports_scope.sql
ALTER TABLE snag_reports
  ADD COLUMN scope            TEXT NOT NULL DEFAULT 'project',
  ADD COLUMN scope_zone_no    INT,
  ADD COLUMN scope_pon_no     INT,
  ADD COLUMN scope_poles      TEXT[],
  ADD COLUMN scope_from_date  DATE,
  ADD COLUMN scope_to_date    DATE,
  ADD COLUMN scope_severities TEXT[],
  ADD COLUMN scope_categories TEXT[],
  ADD COLUMN pdf_url          TEXT,
  ADD COLUMN generated_by     UUID REFERENCES users(id),
  ADD COLUMN generated_at     TIMESTAMPTZ;

ALTER TABLE snag_reports DROP CONSTRAINT snag_reports_source_check;
ALTER TABLE snag_reports
  ADD CONSTRAINT snag_reports_source_check
  CHECK (source IN ('tqr', 'works_qa', 'scope'));

ALTER TABLE snag_reports
  ADD CONSTRAINT snag_reports_scope_requires_pdf
  CHECK (source <> 'scope' OR (pdf_url IS NOT NULL AND generated_at IS NOT NULL));

CREATE INDEX snag_reports_scope_idx
  ON snag_reports (project_id, scope, scope_zone_no, scope_pon_no);

CREATE INDEX snag_reports_generated_at_idx
  ON snag_reports (generated_at DESC)
  WHERE source = 'scope';
```

- [ ] **Step 1.4: Write the rollback**

```sql
-- scripts/migrations/sql/rollback_358_snag_reports_scope.sql
DROP INDEX IF EXISTS snag_reports_generated_at_idx;
DROP INDEX IF EXISTS snag_reports_scope_idx;
ALTER TABLE snag_reports DROP CONSTRAINT IF EXISTS snag_reports_scope_requires_pdf;
ALTER TABLE snag_reports DROP CONSTRAINT IF EXISTS snag_reports_source_check;
ALTER TABLE snag_reports
  ADD CONSTRAINT snag_reports_source_check
  CHECK (source IN ('tqr', 'works_qa'));
ALTER TABLE snag_reports
  DROP COLUMN IF EXISTS generated_at,
  DROP COLUMN IF EXISTS generated_by,
  DROP COLUMN IF EXISTS pdf_url,
  DROP COLUMN IF EXISTS scope_categories,
  DROP COLUMN IF EXISTS scope_severities,
  DROP COLUMN IF EXISTS scope_to_date,
  DROP COLUMN IF EXISTS scope_from_date,
  DROP COLUMN IF EXISTS scope_poles,
  DROP COLUMN IF EXISTS scope_pon_no,
  DROP COLUMN IF EXISTS scope_zone_no,
  DROP COLUMN IF EXISTS scope;
```

- [ ] **Step 1.5: Apply migration**

Run: `PGPASSWORD='a23f6104debd1d3e88e8f00c0067f22f' psql -h localhost -p 5436 -U postgres.ironman-platform -d fibreflow -f scripts/migrations/sql/358_snag_reports_scope.sql`
Expected: `ALTER TABLE` / `CREATE INDEX` outputs, no errors.

- [ ] **Step 1.6: Run test to verify it passes**

Run: `npx vitest run tests/migrations/358_snag_reports_scope.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 1.7: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-p3-spec
git add scripts/migrations/sql/358_snag_reports_scope.sql \
        scripts/migrations/sql/rollback_358_snag_reports_scope.sql \
        tests/migrations/358_snag_reports_scope.test.ts
git commit -m "feat(snags): migration 358 — snag_reports scope columns"
```

**Rollback if blocked:** `psql -f scripts/migrations/sql/rollback_358_snag_reports_scope.sql`.

---

## Task 2: `reportNumberGenerator` service

**Files:**
- Create: `src/modules/construction-qa/services/reportNumberGenerator.ts`
- Test: `src/modules/construction-qa/services/reportNumberGenerator.test.ts`

- [ ] **Step 2.1: Write the failing test**

```typescript
// src/modules/construction-qa/services/reportNumberGenerator.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { generateScopeReportNumber } from './reportNumberGenerator';
import { sql } from '@/lib/db-pool';

describe('generateScopeReportNumber', () => {
  let projectId: string;
  beforeEach(async () => {
    const rows = await sql`SELECT id FROM projects WHERE project_name ILIKE 'lawley%' LIMIT 1`;
    projectId = rows[0]?.id;
    if (!projectId) throw new Error('Test requires a Lawley project');
    await sql`DELETE FROM snag_reports WHERE source = 'scope' AND project_id = ${projectId} AND report_number LIKE 'SCOPE-%'`;
  });

  it('returns SCOPE-<projectCode>-<YYYYMMDD>-001 on first call', async () => {
    const num = await generateScopeReportNumber(projectId, new Date('2026-05-20'));
    expect(num).toMatch(/^SCOPE-LAWL-20260520-001$/);
  });

  it('increments sequence for same project + date', async () => {
    await sql`
      INSERT INTO snag_reports (project_id, report_number, source, audit_date, pdf_url, generated_at)
      VALUES (${projectId}, 'SCOPE-LAWL-20260520-001', 'scope', '2026-05-20', 'x', NOW())
    `;
    const num = await generateScopeReportNumber(projectId, new Date('2026-05-20'));
    expect(num).toBe('SCOPE-LAWL-20260520-002');
  });

  it('uses advisory lock to serialize concurrent calls', async () => {
    // Simulate two concurrent calls and assert distinct sequences
    const [a, b] = await Promise.all([
      generateScopeReportNumber(projectId, new Date('2026-05-20')),
      generateScopeReportNumber(projectId, new Date('2026-05-20')),
    ]);
    expect(a).not.toBe(b);
    expect([a, b].sort()).toEqual(['SCOPE-LAWL-20260520-001', 'SCOPE-LAWL-20260520-002']);
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `npx vitest run src/modules/construction-qa/services/reportNumberGenerator.test.ts`
Expected: FAIL — `generateScopeReportNumber` is not exported.

- [ ] **Step 2.3: Implement the service**

```typescript
// src/modules/construction-qa/services/reportNumberGenerator.ts
import { sql, transaction } from '@/lib/db-pool';

function projectCode(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'PROJ';
}

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Generates a unique `SCOPE-<projectCode>-<YYYYMMDD>-<seq>` report_number.
 * Uses a PG advisory lock keyed on (project_id, day) to serialize concurrent generators.
 */
export async function generateScopeReportNumber(projectId: string, when: Date = new Date()): Promise<string> {
  const projectRows = await sql`SELECT project_name FROM projects WHERE id = ${projectId} LIMIT 1`;
  if (projectRows.length === 0) throw new Error(`Project not found: ${projectId}`);
  const code = projectCode(projectRows[0].project_name as string);
  const datePart = yyyymmdd(when);
  const prefix = `SCOPE-${code}-${datePart}-`;

  return transaction(async (client) => {
    // hashtext gives a 32-bit signed int; combine project_id and date for the lock key
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1)::bigint * 100000 + hashtext($2)::bigint)`,
      [projectId, datePart],
    );
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM snag_reports
       WHERE project_id = $1 AND report_number LIKE $2`,
      [projectId, `${prefix}%`],
    );
    const seq = String(((rows[0]?.n ?? 0) as number) + 1).padStart(3, '0');
    return `${prefix}${seq}`;
  });
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `npx vitest run src/modules/construction-qa/services/reportNumberGenerator.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 2.5: Commit**

```bash
git add src/modules/construction-qa/services/reportNumberGenerator.ts \
        src/modules/construction-qa/services/reportNumberGenerator.test.ts
git commit -m "feat(snags): report_number generator with advisory lock"
```

---

## Task 3: `snagReportRenderer` — HTML-only renderer

**Files:**
- Create: `src/modules/construction-qa/services/snagReportRenderer.ts`
- Test: `src/modules/construction-qa/services/snagReportRenderer.test.ts`

- [ ] **Step 3.1: Write the failing test**

```typescript
// src/modules/construction-qa/services/snagReportRenderer.test.ts
import { describe, it, expect } from 'vitest';
import { renderScopeSnagReportHtml } from './snagReportRenderer';
import type { SnagReportScopeRow, SnagReportMeta } from './snagReportRenderer';

const meta: SnagReportMeta = {
  reportNumber: 'SCOPE-LAWL-20260520-001',
  projectName: 'Lawley',
  scope: 'zone',
  zones: [24], pons: [], poles: [],
  fromDate: '2026-04-20', toDate: '2026-05-20',
  severities: ['critical', 'major', 'minor'],
  categories: ['photo_quality', 'pole_quality'],
  generatedAt: '2026-05-20T02:30:00Z',
};
const rows: SnagReportScopeRow[] = [{
  id: 's1', snag_number: 1, category: 'pole_quality', severity: 'major', status: 'open',
  description: 'Pole leaning', zone_no: 24, pon_no: 265, pole_number: 'LAW.P.X001',
  pole_qa_photo_id: 'p1', slot_key: 'civil_after', created_at: '2026-05-19T10:00:00Z',
  noc_ticket_uid: 'NOC-12345',
}];

describe('renderScopeSnagReportHtml', () => {
  it('emits an A4 HTML doc with the universal template wrapper', async () => {
    const html = await renderScopeSnagReportHtml(meta, rows, { slotUrls: {} });
    expect(html).toMatch(/<!DOCTYPE html>/);
    expect(html).toContain('Lawley');
    expect(html).toContain('SCOPE-LAWL-20260520-001');
  });

  it('cover blurb is past tense and lists the scope summary', async () => {
    const html = await renderScopeSnagReportHtml(meta, rows, { slotUrls: {} });
    expect(html).toMatch(/covers snags raised between 2026-04-20 and 2026-05-20/);
    expect(html).toContain('Zone 24');
  });

  it('groups by zone → PON → pole and shows ticket UID', async () => {
    const html = await renderScopeSnagReportHtml(meta, rows, { slotUrls: {} });
    expect(html).toContain('PON 265');
    expect(html).toContain('LAW.P.X001');
    expect(html).toContain('NOC-12345');
  });

  it('renders KPIs: total + by severity + resolved %', async () => {
    const html = await renderScopeSnagReportHtml(meta, rows, { slotUrls: {} });
    expect(html).toMatch(/Total snags.*1/s);
    expect(html).toMatch(/Major.*1/s);
  });

  it('uses ISO dates everywhere', async () => {
    const html = await renderScopeSnagReportHtml(meta, rows, { slotUrls: {} });
    // No locale strings like "20 May 2026" or "5/20/2026"
    expect(html).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    expect(html).not.toMatch(/\d{1,2} May 2026/);
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `npx vitest run src/modules/construction-qa/services/snagReportRenderer.test.ts`
Expected: FAIL — `renderScopeSnagReportHtml` not exported.

- [ ] **Step 3.3: Implement the renderer**

```typescript
// src/modules/construction-qa/services/snagReportRenderer.ts
import { renderReportHtml } from '@/templates/reports/report-template';
import type { ReportData, ReportTableRow } from '@/templates/reports/report-template';
import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';

export interface SnagReportMeta {
  reportNumber: string;
  projectName: string;
  scope: 'pole' | 'pon' | 'zone';
  zones: number[];
  pons: number[];
  poles: string[];
  fromDate: string; // ISO YYYY-MM-DD
  toDate: string;
  severities: string[];
  categories: string[];
  generatedAt: string; // ISO
}

export interface SnagReportScopeRow {
  id: string;
  snag_number: number;
  category: string;
  severity: 'minor' | 'major' | 'critical';
  status: string;
  description: string;
  zone_no: number | null;
  pon_no: number | null;
  pole_number: string | null;
  pole_qa_photo_id: string | null;
  slot_key: string | null;
  created_at: string;
  noc_ticket_uid: string | null;
}

interface RenderOptions {
  /** Pre-resolved slot URLs keyed by `${pole_qa_photo_id}:${slot_key}`. Empty {} skips thumbs. */
  slotUrls: Record<string, string | null>;
}

/** Resolves slot thumbnail URLs in a single batched query, keyed by (photo_id, slot_key). */
export async function resolveSlotUrls(rows: SnagReportScopeRow[]): Promise<Record<string, string | null>> {
  const pairs = rows.filter(r => r.pole_qa_photo_id && r.slot_key);
  if (pairs.length === 0) return {};
  const ids = Array.from(new Set(pairs.map(p => p.pole_qa_photo_id))) as string[];
  const photoRows = await sql`SELECT * FROM pole_qa_photos WHERE id = ANY(${ids})`;
  const result: Record<string, string | null> = {};
  for (const p of pairs) {
    const photo = photoRows.find((x: { id: string }) => x.id === p.pole_qa_photo_id);
    if (!photo) continue;
    const urlCol = `${p.slot_key}_url`;
    result[`${p.pole_qa_photo_id}:${p.slot_key}`] = (photo as Record<string, unknown>)[urlCol] as string | null ?? null;
  }
  return result;
}

function scopeSummary(meta: SnagReportMeta): string {
  const parts: string[] = [];
  if (meta.zones.length) parts.push(`Zone ${meta.zones.join(', ')}`);
  if (meta.pons.length)  parts.push(`PON ${meta.pons.join(', ')}`);
  if (meta.poles.length) parts.push(`Pole${meta.poles.length > 1 ? 's' : ''} ${meta.poles.join(', ')}`);
  return parts.join(' · ') || 'Whole project';
}

function coverBlurb(meta: SnagReportMeta, totalSnags: number): string {
  return `This report covers snags raised between ${meta.fromDate} and ${meta.toDate} across ${scopeSummary(meta)}. ${totalSnags} snag${totalSnags === 1 ? '' : 's'} were identified and tracked.`;
}

export async function renderScopeSnagReportHtml(
  meta: SnagReportMeta,
  rows: SnagReportScopeRow[],
  opts: RenderOptions,
): Promise<string> {
  log.info('snagReportRenderer.start', { reportNumber: meta.reportNumber, rowCount: rows.length });

  const bySev = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.severity] = (acc[r.severity] ?? 0) + 1;
    return acc;
  }, {});
  const resolved = rows.filter(r => ['resolved', 'verified', 'closed'].includes(r.status)).length;
  const resolvedPct = rows.length === 0 ? 0 : Math.round((resolved / rows.length) * 100);

  const tableRows: ReportTableRow[] = rows.map(r => ({
    cells: [
      r.zone_no === null ? '' : String(r.zone_no),
      r.pon_no === null ? '' : String(r.pon_no),
      r.pole_number ?? '',
      r.category,
      { kind: 'pill', variant: r.severity === 'critical' ? 'bad' : r.severity === 'major' ? 'warning' : 'neutral', text: r.severity },
      r.description,
      r.status,
      r.noc_ticket_uid ?? '',
    ],
  }));

  const data: ReportData = {
    title: `Snag Report — ${meta.projectName}`,
    subtitle: meta.reportNumber,
    cover: { blurb: coverBlurb(meta, rows.length), generatedAt: meta.generatedAt },
    kpis: [
      { label: 'Total snags', value: String(rows.length), accent: 'emerald' },
      { label: 'Critical',    value: String(bySev.critical ?? 0), accent: 'rose' },
      { label: 'Major',       value: String(bySev.major ?? 0),    accent: 'amber' },
      { label: 'Minor',       value: String(bySev.minor ?? 0),    accent: 'slate' },
      { label: 'Resolved',    value: `${resolvedPct}%`,           accent: 'blue' },
    ],
    table: {
      columns: [
        { label: 'Zone' }, { label: 'PON' }, { label: 'Pole' },
        { label: 'Category' }, { label: 'Severity' }, { label: 'Description' },
        { label: 'Status' }, { label: 'Ticket' },
      ],
      rows: tableRows,
    },
  };

  // slotUrls reserved for future per-photo thumbnail rendering — currently table-only.
  void opts.slotUrls;
  return renderReportHtml(data);
}
```

- [ ] **Step 3.4: Run test to verify it passes**

Run: `npx vitest run src/modules/construction-qa/services/snagReportRenderer.test.ts`
Expected: PASS (5 tests). If `renderReportHtml` signature differs from assumption, read `src/templates/reports/report-template.ts` exports and adjust the import — the file is already in the repo.

- [ ] **Step 3.5: Commit**

```bash
git add src/modules/construction-qa/services/snagReportRenderer.ts \
        src/modules/construction-qa/services/snagReportRenderer.test.ts
git commit -m "feat(snags): scoped report HTML renderer"
```

---

## Task 4: POST `/api/snags/reports-scope` generate route

**Files:**
- Create: `pages/api/snags/reports-scope.ts`
- Test: `pages/api/snags/__tests__/reports-scope.test.ts`

- [ ] **Step 4.1: Write the failing test**

```typescript
// pages/api/snags/__tests__/reports-scope.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import handler from '../reports-scope';
import { sql } from '@/lib/db-pool';
import { signTestToken } from '@/tests/api/testAuth';

describe('POST /api/snags/reports-scope', () => {
  let projectId: string;
  let managerToken: string;
  beforeEach(async () => {
    const rows = await sql`SELECT id FROM projects WHERE project_name ILIKE 'lawley%' LIMIT 1`;
    projectId = rows[0].id;
    managerToken = await signTestToken({ role: 'manager' });
    await sql`DELETE FROM snag_reports WHERE source = 'scope' AND project_id = ${projectId}`;
  });

  it('returns 400 if scope=pole but poles[] empty', async () => {
    const { req, res } = createMocks({
      method: 'POST', headers: { authorization: `Bearer ${managerToken}` },
      body: { project_id: projectId, scope: 'pole', poles: [] },
    });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 400 if scope query yields zero snags', async () => {
    const { req, res } = createMocks({
      method: 'POST', headers: { authorization: `Bearer ${managerToken}` },
      body: { project_id: projectId, scope: 'zone', zones: [99999] },
    });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData()).error).toMatch(/no snags/i);
  });

  it('persists a snag_reports row with all scope columns + pdf_url', async () => {
    // Assumes seed data: at least one snag exists for zone 24 in Lawley
    const { req, res } = createMocks({
      method: 'POST', headers: { authorization: `Bearer ${managerToken}` },
      body: { project_id: projectId, scope: 'zone', zones: [24] },
    });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(201);
    const body = JSON.parse(res._getData()).data;
    expect(body.report_number).toMatch(/^SCOPE-LAWL-\d{8}-\d{3}$/);
    expect(body.pdf_url).toMatch(/^https?:\/\//);

    const persisted = await sql`SELECT * FROM snag_reports WHERE id = ${body.id}`;
    expect(persisted[0].source).toBe('scope');
    expect(persisted[0].scope).toBe('zone');
    expect(persisted[0].scope_zone_no).toBeNull();    // multi-zone uses array; single-zone may also use array
    expect(persisted[0].pdf_url).toBe(body.pdf_url);
    expect(persisted[0].generated_at).not.toBeNull();
  });

  it('denies viewer role', async () => {
    const viewerToken = await signTestToken({ role: 'viewer' });
    const { req, res } = createMocks({
      method: 'POST', headers: { authorization: `Bearer ${viewerToken}` },
      body: { project_id: projectId, scope: 'zone', zones: [24] },
    });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(403);
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `npx vitest run pages/api/snags/__tests__/reports-scope.test.ts`
Expected: FAIL — `reports-scope.ts` does not exist.

- [ ] **Step 4.3: Implement the route**

```typescript
// pages/api/snags/reports-scope.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { sql, transaction } from '@/lib/db-pool';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission } from '@/lib/auth';
import puppeteer from 'puppeteer';
import { generateScopeReportNumber } from '@/modules/construction-qa/services/reportNumberGenerator';
import {
  renderScopeSnagReportHtml,
  resolveSlotUrls,
  type SnagReportMeta,
  type SnagReportScopeRow,
} from '@/modules/construction-qa/services/snagReportRenderer';
import { uploadToVfStorage } from '@/lib/vfStorage';

type ScopeBody = {
  project_id: string;
  scope: 'pole' | 'pon' | 'zone';
  zones?: number[];
  pons?: number[];
  poles?: string[];
  from_date?: string;
  to_date?: string;
  severities?: ('minor'|'major'|'critical')[];
  categories?: string[];
};

function validateScope(b: ScopeBody): string | null {
  if (!b.project_id) return 'project_id is required';
  if (!['pole', 'pon', 'zone'].includes(b.scope)) return 'scope must be pole|pon|zone';
  if (b.scope === 'pole' && (!b.poles || b.poles.length === 0)) return 'poles[] required when scope=pole';
  if (b.scope === 'pon'  && (!b.pons  || b.pons.length === 0))  return 'pons[] required when scope=pon';
  if (b.scope === 'zone' && (!b.zones || b.zones.length === 0)) return 'zones[] required when scope=zone';
  return null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['POST']);

  const body = req.body as ScopeBody;
  const err = validateScope(body);
  if (err) return apiResponse.error(res, ErrorCode.BAD_REQUEST, err);

  const today = new Date();
  const isoToday = today.toISOString().slice(0, 10);
  const isoMinus30 = new Date(today.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
  const fromDate = body.from_date ?? isoMinus30;
  const toDate   = body.to_date   ?? isoToday;
  const severities = body.severities ?? ['minor', 'major', 'critical'];
  const categories = body.categories ?? null;

  // Scope query — joins pole_qa_photos for zone/pon/pole metadata
  const rows = await sql`
    SELECT s.id, s.snag_number, s.category, s.severity, s.status, s.description,
           p.zone_no, p.pon_no, p.pole_number, s.pole_qa_photo_id, s.slot_key,
           s.created_at::text AS created_at,
           nt.uid AS noc_ticket_uid
    FROM snags s
    LEFT JOIN pole_qa_photos p ON p.id = s.pole_qa_photo_id
    LEFT JOIN noc_tickets nt   ON nt.id = s.noc_ticket_id
    WHERE s.project_id = ${body.project_id}
      AND (${body.zones ?? null}::int[]  IS NULL OR p.zone_no    = ANY(${body.zones ?? null}::int[]))
      AND (${body.pons  ?? null}::int[]  IS NULL OR p.pon_no     = ANY(${body.pons  ?? null}::int[]))
      AND (${body.poles ?? null}::text[] IS NULL OR p.pole_number = ANY(${body.poles ?? null}::text[]))
      AND s.created_at >= ${fromDate}::date
      AND s.created_at <  (${toDate}::date + INTERVAL '1 day')
      AND s.severity = ANY(${severities}::text[])
      AND (${categories}::text[] IS NULL OR s.category = ANY(${categories}::text[]))
    ORDER BY p.zone_no NULLS LAST, p.pon_no NULLS LAST, p.pole_number NULLS LAST, s.created_at
  ` as SnagReportScopeRow[];

  if (rows.length === 0) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'No snags match the requested scope');
  }

  const projectRows = await sql`SELECT project_name FROM projects WHERE id = ${body.project_id}`;
  const projectName = projectRows[0].project_name as string;
  const userId = (req as NextApiRequest & { user: { id: string } }).user.id;
  const reportNumber = await generateScopeReportNumber(body.project_id, today);

  // Insert row with pdf_url=NULL — we'll backfill after upload. Need DEFERRABLE constraint? No,
  // snag_reports_scope_requires_pdf is CHECK only, so we INSERT with a placeholder URL then UPDATE.
  // Simpler: skip the constraint by inserting after upload completes. Use a transaction.
  const meta: SnagReportMeta = {
    reportNumber, projectName, scope: body.scope,
    zones: body.zones ?? [], pons: body.pons ?? [], poles: body.poles ?? [],
    fromDate, toDate, severities, categories: categories ?? ['photo_quality', 'pole_quality', 'verification', 'other'],
    generatedAt: new Date().toISOString(),
  };

  log.info('reports-scope.rendering', { reportNumber, rowCount: rows.length });
  const slotUrls = await resolveSlotUrls(rows);
  const html = await renderScopeSnagReportHtml(meta, rows, { slotUrls });

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  let pdfBuffer: Buffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    pdfBuffer = Buffer.from(await page.pdf({ format: 'A4', printBackground: true }));
  } finally {
    await browser.close();
  }

  const storagePath = `snag-reports/${body.project_id}/${reportNumber}.pdf`;
  const pdfUrl = await uploadToVfStorage(storagePath, pdfBuffer, 'application/pdf');
  log.info('reports-scope.uploaded', { reportNumber, pdfUrl });

  const inserted = await transaction(async (client) => {
    const r = await client.query(
      `INSERT INTO snag_reports
         (project_id, report_number, source, audit_date,
          scope, scope_zone_no, scope_pon_no, scope_poles,
          scope_from_date, scope_to_date, scope_severities, scope_categories,
          pdf_url, generated_by, generated_at,
          total_findings)
       VALUES ($1, $2, 'scope', CURRENT_DATE,
               $3, $4, $5, $6,
               $7, $8, $9, $10,
               $11, $12, NOW(),
               $13)
       RETURNING *`,
      [
        body.project_id, reportNumber,
        body.scope,
        (body.zones && body.zones.length === 1) ? body.zones[0] : null,
        (body.pons  && body.pons.length  === 1) ? body.pons[0]  : null,
        body.poles ?? null,
        fromDate, toDate, severities, categories,
        pdfUrl, userId,
        rows.length,
      ],
    );
    return r.rows[0];
  });

  return apiResponse.created(res, inserted);
}

export default withAuth(withPermission('construction-qa.snags.report.read', 'view')(handler));
```

- [ ] **Step 4.4: Pre-flight checks**

```bash
ls src/lib/vfStorage.ts 2>/dev/null && echo "OK" || echo "MISSING — must adapt to actual helper"
```

If `src/lib/vfStorage.ts` does not exist, read `pages/api/storage/upload.ts` and `pages/api/agreements-upload.ts` to find the actual VF Storage helper, and adjust the import + call signature.

- [ ] **Step 4.5: Run test to verify it passes**

Run: `npx vitest run pages/api/snags/__tests__/reports-scope.test.ts`
Expected: PASS (4 tests). May need DB seed for "snag exists for zone 24" — create one in the test setup if missing.

- [ ] **Step 4.6: Commit**

```bash
git add pages/api/snags/reports-scope.ts pages/api/snags/__tests__/reports-scope.test.ts
git commit -m "feat(snags): POST /api/snags/reports-scope generate route"
```

---

## Task 5: GET PDF stream + Excel download routes

**Files:**
- Create: `pages/api/snags/reports-scope-pdf.ts`
- Create: `pages/api/snags/reports-scope-xlsx.ts`
- Create: `src/modules/construction-qa/services/snagReportXlsx.ts`
- Test: `src/modules/construction-qa/services/snagReportXlsx.test.ts`
- Test: `pages/api/snags/__tests__/reports-scope-xlsx.test.ts`

- [ ] **Step 5.1: Write the failing test for the xlsx renderer**

```typescript
// src/modules/construction-qa/services/snagReportXlsx.test.ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildScopeSnagWorkbook } from './snagReportXlsx';
import type { SnagReportMeta, SnagReportScopeRow } from './snagReportRenderer';

const meta: SnagReportMeta = {
  reportNumber: 'SCOPE-LAWL-20260520-001', projectName: 'Lawley', scope: 'zone',
  zones: [24], pons: [], poles: [], fromDate: '2026-04-20', toDate: '2026-05-20',
  severities: ['critical', 'major', 'minor'], categories: ['pole_quality'],
  generatedAt: '2026-05-20T02:30:00Z',
};
const rows: SnagReportScopeRow[] = [{
  id: 's1', snag_number: 1, category: 'pole_quality', severity: 'major', status: 'open',
  description: 'Pole leaning', zone_no: 24, pon_no: 265, pole_number: 'LAW.P.X001',
  pole_qa_photo_id: 'p1', slot_key: 'civil_after', created_at: '2026-05-19T10:00:00Z',
  noc_ticket_uid: 'NOC-12345',
}];

describe('buildScopeSnagWorkbook', () => {
  it('produces a 3-sheet workbook (Summary, Snags, Scope)', () => {
    const wb = buildScopeSnagWorkbook(meta, rows);
    expect(wb.SheetNames).toEqual(['Summary', 'Snags', 'Scope']);
  });
  it('uses ISO dates in Snags sheet', () => {
    const wb = buildScopeSnagWorkbook(meta, rows);
    const snags = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Snags);
    expect(snags[0].created_at).toBe('2026-05-19');
  });
  it('Summary KPIs reflect row counts', () => {
    const wb = buildScopeSnagWorkbook(meta, rows);
    const sum = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Summary);
    const totalRow = sum.find(r => r.label === 'Total snags');
    expect(totalRow?.value).toBe(1);
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `npx vitest run src/modules/construction-qa/services/snagReportXlsx.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement the xlsx builder**

```typescript
// src/modules/construction-qa/services/snagReportXlsx.ts
import * as XLSX from 'xlsx';
import type { SnagReportMeta, SnagReportScopeRow } from './snagReportRenderer';

function isoDate(ts: string): string { return ts.slice(0, 10); }

export function buildScopeSnagWorkbook(meta: SnagReportMeta, rows: SnagReportScopeRow[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const bySev = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.severity] = (acc[r.severity] ?? 0) + 1;
    return acc;
  }, {});
  const resolved = rows.filter(r => ['resolved', 'verified', 'closed'].includes(r.status)).length;

  const summarySheet = XLSX.utils.json_to_sheet([
    { label: 'Report number', value: meta.reportNumber },
    { label: 'Project',       value: meta.projectName },
    { label: 'Generated at',  value: isoDate(meta.generatedAt) },
    { label: 'Scope',         value: meta.scope },
    { label: 'From',          value: meta.fromDate },
    { label: 'To',            value: meta.toDate },
    { label: 'Total snags',   value: rows.length },
    { label: 'Critical',      value: bySev.critical ?? 0 },
    { label: 'Major',         value: bySev.major ?? 0 },
    { label: 'Minor',         value: bySev.minor ?? 0 },
    { label: 'Resolved',      value: resolved },
  ]);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  const snagsSheet = XLSX.utils.json_to_sheet(rows.map(r => ({
    zone_no: r.zone_no, pon_no: r.pon_no, pole_number: r.pole_number,
    category: r.category, severity: r.severity, status: r.status,
    description: r.description, noc_ticket_uid: r.noc_ticket_uid,
    created_at: isoDate(r.created_at),
  })));
  XLSX.utils.book_append_sheet(wb, snagsSheet, 'Snags');

  const scopeSheet = XLSX.utils.json_to_sheet([
    { label: 'zones',      value: meta.zones.join(', ') },
    { label: 'pons',       value: meta.pons.join(', ') },
    { label: 'poles',      value: meta.poles.join(', ') },
    { label: 'severities', value: meta.severities.join(', ') },
    { label: 'categories', value: meta.categories.join(', ') },
  ]);
  XLSX.utils.book_append_sheet(wb, scopeSheet, 'Scope');

  return wb;
}
```

- [ ] **Step 5.4: Run xlsx builder test**

Run: `npx vitest run src/modules/construction-qa/services/snagReportXlsx.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5.5: Write the failing API test for the xlsx route**

```typescript
// pages/api/snags/__tests__/reports-scope-xlsx.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import handler from '../reports-scope-xlsx';
import { sql } from '@/lib/db-pool';
import { signTestToken } from '@/tests/api/testAuth';

describe('GET /api/snags/reports-scope-xlsx', () => {
  let reportId: string;
  let token: string;
  beforeEach(async () => {
    token = await signTestToken({ role: 'manager' });
    const projectRows = await sql`SELECT id FROM projects LIMIT 1`;
    const ins = await sql`
      INSERT INTO snag_reports (project_id, report_number, source, audit_date,
        scope, scope_zone_no, scope_from_date, scope_to_date, scope_severities,
        scope_categories, pdf_url, generated_at, total_findings)
      VALUES (${projectRows[0].id}, 'SCOPE-XLSX-TEST', 'scope', CURRENT_DATE,
              'zone', 24, '2026-04-20', '2026-05-20', ARRAY['major']::text[],
              ARRAY['pole_quality']::text[], 'https://example/test.pdf', NOW(), 0)
      RETURNING id
    `;
    reportId = ins[0].id;
  });

  it('returns 404 for unknown id', async () => {
    const { req, res } = createMocks({
      method: 'GET', headers: { authorization: `Bearer ${token}` },
      query: { id: '00000000-0000-0000-0000-000000000000' },
    });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(404);
  });

  it('streams xlsx with correct content-type', async () => {
    const { req, res } = createMocks({
      method: 'GET', headers: { authorization: `Bearer ${token}` },
      query: { id: reportId },
    });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    expect(res.getHeader('content-type')).toContain('spreadsheetml');
  });
});
```

- [ ] **Step 5.6: Run failing test**

Run: `npx vitest run pages/api/snags/__tests__/reports-scope-xlsx.test.ts`
Expected: FAIL — `reports-scope-xlsx.ts` missing.

- [ ] **Step 5.7: Implement xlsx route**

```typescript
// pages/api/snags/reports-scope-xlsx.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import * as XLSX from 'xlsx';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { buildScopeSnagWorkbook } from '@/modules/construction-qa/services/snagReportXlsx';
import type { SnagReportMeta, SnagReportScopeRow } from '@/modules/construction-qa/services/snagReportRenderer';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  const id = req.query.id;
  if (typeof id !== 'string') return apiResponse.error(res, 'BAD_REQUEST', 'id required');

  const reportRows = await sql`
    SELECT sr.*, p.project_name FROM snag_reports sr
    INNER JOIN projects p ON p.id = sr.project_id
    WHERE sr.id = ${id} AND sr.source = 'scope'
  `;
  if (reportRows.length === 0) return apiResponse.notFound(res, 'Scope report', id);
  const r = reportRows[0];

  const meta: SnagReportMeta = {
    reportNumber: r.report_number, projectName: r.project_name, scope: r.scope,
    zones: r.scope_zone_no ? [r.scope_zone_no] : [],
    pons:  r.scope_pon_no  ? [r.scope_pon_no]  : [],
    poles: r.scope_poles ?? [],
    fromDate: r.scope_from_date, toDate: r.scope_to_date,
    severities: r.scope_severities ?? [], categories: r.scope_categories ?? [],
    generatedAt: r.generated_at.toISOString(),
  };

  // Regenerate scope query rows (same logic as POST route — DRY by extracting later if it grows)
  const rows = await sql`
    SELECT s.id, s.snag_number, s.category, s.severity, s.status, s.description,
           p.zone_no, p.pon_no, p.pole_number, s.pole_qa_photo_id, s.slot_key,
           s.created_at::text AS created_at, nt.uid AS noc_ticket_uid
    FROM snags s
    LEFT JOIN pole_qa_photos p ON p.id = s.pole_qa_photo_id
    LEFT JOIN noc_tickets nt   ON nt.id = s.noc_ticket_id
    WHERE s.project_id = ${r.project_id}
      AND (${r.scope_zone_no ? [r.scope_zone_no] : null}::int[]  IS NULL OR p.zone_no    = ANY(${r.scope_zone_no ? [r.scope_zone_no] : null}::int[]))
      AND (${r.scope_pon_no  ? [r.scope_pon_no]  : null}::int[]  IS NULL OR p.pon_no     = ANY(${r.scope_pon_no  ? [r.scope_pon_no]  : null}::int[]))
      AND (${r.scope_poles}::text[]                              IS NULL OR p.pole_number = ANY(${r.scope_poles}::text[]))
      AND s.created_at >= ${r.scope_from_date}::date
      AND s.created_at <  (${r.scope_to_date}::date + INTERVAL '1 day')
      AND s.severity = ANY(${r.scope_severities}::text[])
      AND (${r.scope_categories}::text[] IS NULL OR s.category = ANY(${r.scope_categories}::text[]))
  ` as SnagReportScopeRow[];

  const wb = buildScopeSnagWorkbook(meta, rows);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${r.report_number}.xlsx"`);
  res.status(200).end(buf);
}

export default withAuth(withPermission('construction-qa.snags.report.read', 'view')(handler));
```

- [ ] **Step 5.8: Implement PDF stream route**

```typescript
// pages/api/snags/reports-scope-pdf.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  const id = req.query.id;
  if (typeof id !== 'string') return apiResponse.error(res, 'BAD_REQUEST', 'id required');

  const rows = await sql`SELECT pdf_url, report_number FROM snag_reports WHERE id = ${id} AND source = 'scope'`;
  if (rows.length === 0 || !rows[0].pdf_url) return apiResponse.notFound(res, 'Scope report', id);

  // 302 redirect to VF Storage URL — keeps Next.js out of the byte stream
  res.redirect(302, rows[0].pdf_url);
}

export default withAuth(withPermission('construction-qa.snags.report.read', 'view')(handler));
```

- [ ] **Step 5.9: Run all xlsx + pdf tests**

Run: `npx vitest run pages/api/snags/__tests__/reports-scope-xlsx.test.ts src/modules/construction-qa/services/snagReportXlsx.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5.10: Commit**

```bash
git add pages/api/snags/reports-scope-pdf.ts \
        pages/api/snags/reports-scope-xlsx.ts \
        pages/api/snags/__tests__/reports-scope-xlsx.test.ts \
        src/modules/construction-qa/services/snagReportXlsx.ts \
        src/modules/construction-qa/services/snagReportXlsx.test.ts
git commit -m "feat(snags): PDF stream + Excel download routes"
```

---

## Task 6: Extend `/api/snags/reports` with `?source=` filter

**Files:**
- Modify: `pages/api/snags/reports.ts` (existing, 172 lines)
- Test: `pages/api/snags/__tests__/reports-source-filter.test.ts`

- [ ] **Step 6.1: Write the failing test**

```typescript
// pages/api/snags/__tests__/reports-source-filter.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import handler from '../reports';
import { sql } from '@/lib/db-pool';
import { signTestToken } from '@/tests/api/testAuth';

describe('GET /api/snags/reports?source=scope', () => {
  let token: string;
  let projectId: string;
  beforeEach(async () => {
    token = await signTestToken({ role: 'manager' });
    const p = await sql`SELECT id FROM projects LIMIT 1`;
    projectId = p[0].id;
    await sql`DELETE FROM snag_reports WHERE report_number LIKE 'SRC-FILTER-%'`;
    await sql`
      INSERT INTO snag_reports (project_id, report_number, source, audit_date, pdf_url, generated_at)
      VALUES (${projectId}, 'SRC-FILTER-A', 'scope', CURRENT_DATE, 'https://x/a.pdf', NOW()),
             (${projectId}, 'SRC-FILTER-B', 'tqr',   CURRENT_DATE, NULL, NULL),
             (${projectId}, 'SRC-FILTER-C', 'works_qa', CURRENT_DATE, NULL, NULL)
    `;
  });

  it('returns only scope rows when source=scope', async () => {
    const { req, res } = createMocks({
      method: 'GET', headers: { authorization: `Bearer ${token}` },
      query: { projectId, source: 'scope' },
    });
    await handler(req as any, res as any);
    const data = JSON.parse(res._getData()).data;
    expect(data.every((r: { source: string }) => r.source === 'scope')).toBe(true);
    expect(data.some((r: { report_number: string }) => r.report_number === 'SRC-FILTER-A')).toBe(true);
    expect(data.some((r: { report_number: string }) => r.report_number === 'SRC-FILTER-B')).toBe(false);
  });

  it('returns all rows when source omitted', async () => {
    const { req, res } = createMocks({
      method: 'GET', headers: { authorization: `Bearer ${token}` },
      query: { projectId },
    });
    await handler(req as any, res as any);
    const data = JSON.parse(res._getData()).data;
    const reportNumbers = data.map((r: { report_number: string }) => r.report_number);
    expect(reportNumbers).toEqual(expect.arrayContaining(['SRC-FILTER-A', 'SRC-FILTER-B', 'SRC-FILTER-C']));
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

Run: `npx vitest run pages/api/snags/__tests__/reports-source-filter.test.ts`
Expected: FAIL — second test passes (returns all), first test fails (returns all instead of filtering).

- [ ] **Step 6.3: Modify the route**

In `pages/api/snags/reports.ts` `handleGet`, inside the `if (projectId && typeof projectId === 'string')` branch, change the SQL to take an optional `source` filter. Because the file uses the Neon shim and conditional SQL breaks the shim (per CLAUDE.md tech-debt note), use **two explicit query branches**:

```typescript
// Add near the destructure at top of handleGet:
const { projectId, page = '1', pageSize = '20', source } = req.query;
const sourceFilter = typeof source === 'string' && ['tqr', 'works_qa', 'scope'].includes(source)
  ? source
  : null;

// Inside the `if (projectId && typeof projectId === 'string')` branch, replace the existing query with:
const rows = sourceFilter
  ? await sql`
      SELECT sr.*, p.project_name AS project_name
      FROM snag_reports sr
      INNER JOIN projects p ON p.id = sr.project_id
      WHERE sr.project_id = ${projectId} AND sr.source = ${sourceFilter}
      ORDER BY sr.audit_date DESC, sr.generated_at DESC NULLS LAST
      LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Array<SnagReport & { project_name: string }>
  : await sql`
      SELECT sr.*, p.project_name AS project_name
      FROM snag_reports sr
      INNER JOIN projects p ON p.id = sr.project_id
      WHERE sr.project_id = ${projectId}
      ORDER BY sr.audit_date DESC, sr.generated_at DESC NULLS LAST
      LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Array<SnagReport & { project_name: string }>;

const countRows = sourceFilter
  ? await sql`SELECT COUNT(*) AS total FROM snag_reports WHERE project_id = ${projectId} AND source = ${sourceFilter}` as Array<{ total: string }>
  : await sql`SELECT COUNT(*) AS total FROM snag_reports WHERE project_id = ${projectId}` as Array<{ total: string }>;
```

- [ ] **Step 6.4: Run test**

Run: `npx vitest run pages/api/snags/__tests__/reports-source-filter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6.5: Commit**

```bash
git add pages/api/snags/reports.ts pages/api/snags/__tests__/reports-source-filter.test.ts
git commit -m "feat(snags): GET /api/snags/reports ?source= filter"
```

---

## Task 7: `useReportScopeForm` hook

**Files:**
- Create: `src/modules/works-qa/hooks/useReportScopeForm.ts`
- Test: `src/modules/works-qa/hooks/__tests__/useReportScopeForm.test.ts`

- [ ] **Step 7.1: Write the failing test**

```typescript
// src/modules/works-qa/hooks/__tests__/useReportScopeForm.test.ts
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReportScopeForm } from '../useReportScopeForm';

describe('useReportScopeForm', () => {
  it('defaults scope from URL params: pole_id → pole, pon_no → pon, zone_no → zone, else project', () => {
    const { result: a } = renderHook(() => useReportScopeForm({ zone_no: 24 }));
    expect(a.current.scope).toBe('zone');
    expect(a.current.zones).toEqual([24]);

    const { result: b } = renderHook(() => useReportScopeForm({ zone_no: 24, pon_no: 265 }));
    expect(b.current.scope).toBe('pon');
    expect(b.current.pons).toEqual([265]);

    const { result: c } = renderHook(() => useReportScopeForm({ pole_id: 'LAW.P.X001' }));
    expect(c.current.scope).toBe('pole');
    expect(c.current.poles).toEqual(['LAW.P.X001']);
  });

  it('validates: scope=pole requires non-empty poles[]', () => {
    const { result } = renderHook(() => useReportScopeForm({}));
    act(() => result.current.setScope('pole'));
    expect(result.current.validate()).toMatch(/poles/i);
  });

  it('toSubmitBody produces the POST shape', () => {
    const { result } = renderHook(() => useReportScopeForm({ zone_no: 24 }));
    act(() => result.current.setProjectId('p1'));
    const body = result.current.toSubmitBody();
    expect(body).toMatchObject({ project_id: 'p1', scope: 'zone', zones: [24] });
  });

  it('default date range is last 30 days, ISO format', () => {
    const { result } = renderHook(() => useReportScopeForm({}));
    expect(result.current.fromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.current.toDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 7.2: Run failing test**

Run: `npx vitest run src/modules/works-qa/hooks/__tests__/useReportScopeForm.test.ts`
Expected: FAIL.

- [ ] **Step 7.3: Implement the hook**

```typescript
// src/modules/works-qa/hooks/useReportScopeForm.ts
import { useMemo, useState } from 'react';

export type ScopeKind = 'pole' | 'pon' | 'zone';
type UrlContext = { zone_no?: number; pon_no?: number; pole_id?: string };

function defaultScope(ctx: UrlContext): ScopeKind {
  if (ctx.pole_id) return 'pole';
  if (ctx.pon_no !== undefined) return 'pon';
  return 'zone';
}

function isoMinusDays(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

export function useReportScopeForm(ctx: UrlContext) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [scope, setScope]   = useState<ScopeKind>(() => defaultScope(ctx));
  const [zones, setZones]   = useState<number[]>(ctx.zone_no !== undefined ? [ctx.zone_no] : []);
  const [pons,  setPons]    = useState<number[]>(ctx.pon_no  !== undefined ? [ctx.pon_no]  : []);
  const [poles, setPoles]   = useState<string[]>(ctx.pole_id ? [ctx.pole_id] : []);
  const [fromDate, setFromDate] = useState<string>(isoMinusDays(30));
  const [toDate,   setToDate]   = useState<string>(isoMinusDays(0));
  const [severities, setSeverities] = useState<string[]>(['minor', 'major', 'critical']);
  const [categories, setCategories] = useState<string[]>(['photo_quality', 'pole_quality', 'verification', 'other']);

  const validate = (): string | null => {
    if (!projectId) return 'projectId is required';
    if (scope === 'pole' && poles.length === 0) return 'poles[] required when scope=pole';
    if (scope === 'pon'  && pons.length  === 0) return 'pons[] required when scope=pon';
    if (scope === 'zone' && zones.length === 0) return 'zones[] required when scope=zone';
    if (fromDate > toDate) return 'fromDate must be <= toDate';
    return null;
  };

  const toSubmitBody = () => ({
    project_id: projectId!,
    scope, zones, pons, poles,
    from_date: fromDate, to_date: toDate,
    severities, categories,
  });

  return useMemo(() => ({
    projectId, setProjectId, scope, setScope,
    zones, setZones, pons, setPons, poles, setPoles,
    fromDate, setFromDate, toDate, setToDate,
    severities, setSeverities, categories, setCategories,
    validate, toSubmitBody,
  }), [projectId, scope, zones, pons, poles, fromDate, toDate, severities, categories]);
}
```

- [ ] **Step 7.4: Run test**

Run: `npx vitest run src/modules/works-qa/hooks/__tests__/useReportScopeForm.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7.5: Commit**

```bash
git add src/modules/works-qa/hooks/useReportScopeForm.ts \
        src/modules/works-qa/hooks/__tests__/useReportScopeForm.test.ts
git commit -m "feat(works-qa): useReportScopeForm hook"
```

---

## Task 8: `SnagReportScopeDialog` + `ScopeChipPicker`

**Files:**
- Create: `src/modules/works-qa/components/SnagReportScopeDialog.tsx`
- Create: `src/modules/works-qa/components/ScopeChipPicker.tsx`
- Create: `src/modules/works-qa/components/__tests__/SnagReportScopeDialog.test.tsx`

- [ ] **Step 8.1: Write the failing test**

```typescript
// src/modules/works-qa/components/__tests__/SnagReportScopeDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SnagReportScopeDialog } from '../SnagReportScopeDialog';

const onClose = vi.fn();
const fetchMock = vi.fn();
beforeEach(() => {
  onClose.mockReset();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('SnagReportScopeDialog', () => {
  it('renders with role=dialog and aria-modal', () => {
    render(<SnagReportScopeDialog open projectId="p1" defaultCtx={{ zone_no: 24 }} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('closes on Escape', () => {
    render(<SnagReportScopeDialog open projectId="p1" defaultCtx={{}} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('blocks submit until projectId set and validation passes', async () => {
    render(<SnagReportScopeDialog open projectId="p1" defaultCtx={{ zone_no: 24 }} onClose={onClose} />);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: 'r1', report_number: 'SCOPE-LAWL-20260520-001', pdf_url: 'https://x/r.pdf' } }),
    });
    fireEvent.click(screen.getByRole('button', { name: /Generate/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/snags/reports-scope', expect.objectContaining({ method: 'POST' })));
  });

  it('shows confirmation panel with report_number + PDF/Excel buttons on success', async () => {
    render(<SnagReportScopeDialog open projectId="p1" defaultCtx={{ zone_no: 24 }} onClose={onClose} />);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: 'r1', report_number: 'SCOPE-LAWL-20260520-001', pdf_url: 'https://x/r.pdf' } }),
    });
    fireEvent.click(screen.getByRole('button', { name: /Generate/i }));
    await waitFor(() => expect(screen.getByText(/SCOPE-LAWL-20260520-001/)).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /Open PDF/i })).toHaveAttribute('href', 'https://x/r.pdf');
    expect(screen.getByRole('link', { name: /Download Excel/i })).toHaveAttribute('href', '/api/snags/reports-scope-xlsx?id=r1');
  });

  it('renders inline error on HTTP failure', async () => {
    render(<SnagReportScopeDialog open projectId="p1" defaultCtx={{ zone_no: 24 }} onClose={onClose} />);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'No snags match the requested scope' }) });
    fireEvent.click(screen.getByRole('button', { name: /Generate/i }));
    await waitFor(() => expect(screen.getByText(/No snags match/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 8.2: Run failing test**

Run: `npx vitest run src/modules/works-qa/components/__tests__/SnagReportScopeDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 8.3: Implement `ScopeChipPicker`**

```tsx
// src/modules/works-qa/components/ScopeChipPicker.tsx
import { useState } from 'react';

interface Props<T extends string | number> {
  label: string;
  options: T[];
  selected: T[];
  onChange: (next: T[]) => void;
  disabled?: boolean;
}

export function ScopeChipPicker<T extends string | number>({ label, options, selected, onChange, disabled }: Props<T>) {
  const [filter, setFilter] = useState('');
  const visible = options.filter(o => String(o).toLowerCase().includes(filter.toLowerCase()));

  const toggle = (opt: T) => {
    if (disabled) return;
    onChange(selected.includes(opt) ? selected.filter(x => x !== opt) : [...selected, opt]);
  };

  return (
    <div className="mb-3">
      <div className="text-sm font-medium text-slate-200 mb-1">{label}</div>
      {options.length > 8 ? (
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={`Filter ${label.toLowerCase()}...`}
          className="w-full mb-2 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
          disabled={disabled}
        />
      ) : null}
      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
        {visible.map(opt => (
          <button
            key={String(opt)}
            type="button"
            onClick={() => toggle(opt)}
            disabled={disabled}
            className={
              'px-2 py-0.5 rounded-full text-xs border transition ' +
              (selected.includes(opt)
                ? 'bg-emerald-600 border-emerald-500 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500')
            }
          >
            {String(opt)}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8.4: Implement `SnagReportScopeDialog`**

```tsx
// src/modules/works-qa/components/SnagReportScopeDialog.tsx
import { useEffect, useId, useState } from 'react';
import useSWR from 'swr';
import { useReportScopeForm, type ScopeKind } from '../hooks/useReportScopeForm';
import { ScopeChipPicker } from './ScopeChipPicker';
import { log } from '@/lib/logger';

interface Props {
  open: boolean;
  projectId: string;
  defaultCtx: { zone_no?: number; pon_no?: number; pole_id?: string };
  onClose: () => void;
}

interface ZoneOption { zone_no: number }
interface PonOption  { pon_no: number; zone_no: number }
interface PoleOption { pole_number: string; pon_no: number }

const fetcher = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  const b = await r.json();
  return (b.data ?? b) as T;
};

export function SnagReportScopeDialog({ open, projectId, defaultCtx, onClose }: Props) {
  const dialogTitleId = useId();
  const form = useReportScopeForm(defaultCtx);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; report_number: string; pdf_url: string } | null>(null);

  useEffect(() => { form.setProjectId(projectId); }, [projectId, form]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, busy, onClose]);

  const { data: zones = [] } = useSWR<ZoneOption[]>(
    open ? `/api/snags/zone-pon-options?projectId=${projectId}&kind=zones` : null, fetcher);
  const { data: pons = [] } = useSWR<PonOption[]>(
    open && form.scope !== 'zone' ? `/api/snags/zone-pon-options?projectId=${projectId}&kind=pons&zones=${form.zones.join(',')}` : null, fetcher);
  const { data: poles = [] } = useSWR<PoleOption[]>(
    open && form.scope === 'pole' ? `/api/snags/zone-pon-options?projectId=${projectId}&kind=poles&pons=${form.pons.join(',')}` : null, fetcher);

  if (!open) return null;

  async function submit() {
    setError(null);
    const v = form.validate();
    if (v) { setError(v); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/snags/reports-scope', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form.toSubmitBody()),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setResult(body.data);
      log.info('snag-report-scope.created', { id: body.data.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={dialogTitleId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-auto p-6">
        <div className="flex justify-between items-start mb-4">
          <h2 id={dialogTitleId} className="text-lg font-semibold text-slate-100">Generate snag report</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-slate-400 hover:text-slate-200">×</button>
        </div>

        {result ? (
          <div className="space-y-4">
            <div className="bg-emerald-950 border border-emerald-700 rounded p-4">
              <div className="text-emerald-300 font-medium">Report ready</div>
              <div className="text-slate-100 mt-1">{result.report_number}</div>
            </div>
            <div className="flex gap-3">
              <a href={result.pdf_url} target="_blank" rel="noopener noreferrer" className="px-4 py-2 bg-emerald-600 text-white rounded">Open PDF</a>
              <a href={`/api/snags/reports-scope-xlsx?id=${result.id}`} className="px-4 py-2 bg-slate-700 text-white rounded">Download Excel</a>
              <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-800 border border-slate-600 text-slate-200 rounded ml-auto">Close</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium text-slate-200 mb-1">Scope</div>
              <div className="flex gap-2">
                {(['pole', 'pon', 'zone'] as ScopeKind[]).map(k => (
                  <label key={k} className="flex items-center gap-1 text-sm text-slate-300">
                    <input type="radio" name="scope" value={k} checked={form.scope === k} onChange={() => form.setScope(k)} disabled={busy} />
                    {k}
                  </label>
                ))}
              </div>
            </div>

            {(form.scope === 'zone' || form.scope === 'pon' || form.scope === 'pole') && (
              <ScopeChipPicker label="Zones" options={zones.map(z => z.zone_no)} selected={form.zones} onChange={form.setZones} disabled={busy} />
            )}
            {(form.scope === 'pon' || form.scope === 'pole') && (
              <ScopeChipPicker label="PONs" options={pons.map(p => p.pon_no)} selected={form.pons} onChange={form.setPons} disabled={busy} />
            )}
            {form.scope === 'pole' && (
              <ScopeChipPicker label="Poles" options={poles.map(p => p.pole_number)} selected={form.poles} onChange={form.setPoles} disabled={busy} />
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-slate-300">From
                <input type="date" value={form.fromDate} onChange={e => form.setFromDate(e.target.value)} disabled={busy}
                  className="w-full mt-1 px-2 py-1 bg-slate-800 border border-slate-700 rounded" />
              </label>
              <label className="text-sm text-slate-300">To
                <input type="date" value={form.toDate} onChange={e => form.setToDate(e.target.value)} disabled={busy}
                  className="w-full mt-1 px-2 py-1 bg-slate-800 border border-slate-700 rounded" />
              </label>
            </div>

            <ScopeChipPicker<string> label="Severity" options={['minor','major','critical']} selected={form.severities} onChange={form.setSeverities} disabled={busy} />
            <ScopeChipPicker<string> label="Category" options={['photo_quality','pole_quality','verification','other']} selected={form.categories} onChange={form.setCategories} disabled={busy} />

            {error && <div className="text-rose-400 text-sm">{error}</div>}

            <div className="flex justify-end gap-2 pt-3">
              <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 bg-slate-800 border border-slate-600 text-slate-200 rounded">Cancel</button>
              <button type="button" onClick={submit} disabled={busy} className="px-4 py-2 bg-emerald-600 text-white rounded">
                {busy ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Note:** This component is ~180 lines and references a `GET /api/snags/zone-pon-options` endpoint. If that endpoint does not exist already (`pages/api/snags/zone-pon-options.ts` is listed in the snags dir — verify it returns the expected shape; if it does not, add a minimal version as part of Step 8.5 below).

- [ ] **Step 8.5: Verify or extend `zone-pon-options`**

Run: `cat pages/api/snags/zone-pon-options.ts | head -40`
- If it accepts `?projectId=&kind=zones|pons|poles` and returns the expected shape: continue.
- Otherwise: add `?kind=` switch handling. Keep that change atomic in the same commit as the dialog. File must stay under 300 lines.

- [ ] **Step 8.6: Run dialog test**

Run: `npx vitest run src/modules/works-qa/components/__tests__/SnagReportScopeDialog.test.tsx`
Expected: PASS (5 tests). If SWR is throwing in tests, wrap the render in `SWRConfig` with `dedupingInterval: 0`.

- [ ] **Step 8.7: Commit**

```bash
git add src/modules/works-qa/components/SnagReportScopeDialog.tsx \
        src/modules/works-qa/components/ScopeChipPicker.tsx \
        src/modules/works-qa/components/__tests__/SnagReportScopeDialog.test.tsx \
        pages/api/snags/zone-pon-options.ts  # only if modified
git commit -m "feat(works-qa): scope report dialog + chip picker"
```

---

## Task 9: `SnagReportButton` + `WorksQAPage` refactor

**Files:**
- Create: `src/modules/works-qa/components/SnagReportButton.tsx`
- Create: `src/modules/works-qa/components/WorksQAPageHeader.tsx`
- Modify: `src/modules/works-qa/components/WorksQAPage.tsx` (216 → ~150 lines after extraction)
- Test: `src/modules/works-qa/components/__tests__/SnagReportButton.test.tsx`

- [ ] **Step 9.1: Write the failing test**

```tsx
// src/modules/works-qa/components/__tests__/SnagReportButton.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SnagReportButton } from '../SnagReportButton';

const onOpenDialog = vi.fn();

describe('SnagReportButton', () => {
  it('shows "Zone report" label when only zone_no in ctx', () => {
    render(<SnagReportButton projectId="p1" ctx={{ zone_no: 24 }} onOpenDialog={onOpenDialog} />);
    expect(screen.getByRole('button', { name: /Zone report/ })).toBeInTheDocument();
  });
  it('shows "PON report" label when pon_no in ctx', () => {
    render(<SnagReportButton projectId="p1" ctx={{ zone_no: 24, pon_no: 265 }} onOpenDialog={onOpenDialog} />);
    expect(screen.getByRole('button', { name: /PON report/ })).toBeInTheDocument();
  });
  it('shows "Pole report" label when pole_id in ctx', () => {
    render(<SnagReportButton projectId="p1" ctx={{ pole_id: 'LAW.P.X001' }} onOpenDialog={onOpenDialog} />);
    expect(screen.getByRole('button', { name: /Pole report/ })).toBeInTheDocument();
  });
  it('shows "Project report" when ctx empty', () => {
    render(<SnagReportButton projectId="p1" ctx={{}} onOpenDialog={onOpenDialog} />);
    expect(screen.getByRole('button', { name: /Project report/ })).toBeInTheDocument();
  });
  it('Advanced opens dialog regardless of ctx', () => {
    render(<SnagReportButton projectId="p1" ctx={{ zone_no: 24 }} onOpenDialog={onOpenDialog} />);
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    expect(onOpenDialog).toHaveBeenCalled();
  });
});
```

- [ ] **Step 9.2: Run failing test**

Run: `npx vitest run src/modules/works-qa/components/__tests__/SnagReportButton.test.tsx`
Expected: FAIL.

- [ ] **Step 9.3: Implement `SnagReportButton`**

```tsx
// src/modules/works-qa/components/SnagReportButton.tsx
import { useState } from 'react';
import { SnagReportScopeDialog } from './SnagReportScopeDialog';

interface Props {
  projectId: string;
  ctx: { zone_no?: number; pon_no?: number; pole_id?: string };
  onOpenDialog?: () => void;  // injectable for tests
}

function label(ctx: Props['ctx']): string {
  if (ctx.pole_id) return 'Pole report';
  if (ctx.pon_no !== undefined) return 'PON report';
  if (ctx.zone_no !== undefined) return 'Zone report';
  return 'Project report';
}

export function SnagReportButton({ projectId, ctx, onOpenDialog }: Props) {
  const [open, setOpen] = useState(false);
  const openDialog = () => { setOpen(true); onOpenDialog?.(); };

  return (
    <>
      <div className="inline-flex rounded-md border border-slate-700 overflow-hidden">
        <button type="button" onClick={openDialog} className="px-3 py-1.5 bg-slate-800 text-sm text-slate-200 hover:bg-slate-700">
          {label(ctx)}
        </button>
        <button type="button" onClick={openDialog} aria-label="Advanced" className="px-2 py-1.5 bg-slate-800 border-l border-slate-700 text-sm text-slate-400 hover:bg-slate-700">
          Advanced ▾
        </button>
      </div>
      <SnagReportScopeDialog open={open} projectId={projectId} defaultCtx={ctx} onClose={() => setOpen(false)} />
    </>
  );
}
```

- [ ] **Step 9.4: Extract `WorksQAPageHeader`**

Read the current `WorksQAPage.tsx` (216 lines), identify the existing header markup (project card + filter bar + sync/refresh buttons), and extract it verbatim into:

```tsx
// src/modules/works-qa/components/WorksQAPageHeader.tsx
import { WorksQAProjectCard } from './WorksQAProjectCard';
import { WorksQAFiltersBar } from './WorksQAFiltersBar';
import { SnagReportButton } from './SnagReportButton';
import type { WorksQAProjectStats } from '../types/works-qa.types';

interface Props {
  project: WorksQAProjectStats;
  projectId: string;
  zoneNo: number | null;
  ponNo: number | null;
  poleId: string | null;
  onBack: () => void;
  onSync: () => void;
  onPushQuery: (updates: Record<string, string | null>) => void;
  syncing: boolean;
}

export function WorksQAPageHeader(p: Props) {
  return (
    <div className="border-b border-slate-800 p-4 space-y-3">
      <div className="flex justify-between items-start gap-3">
        <WorksQAProjectCard project={p.project} />
        <SnagReportButton
          projectId={p.projectId}
          ctx={{
            zone_no: p.zoneNo ?? undefined,
            pon_no:  p.ponNo  ?? undefined,
            pole_id: p.poleId ?? undefined,
          }}
        />
      </div>
      <WorksQAFiltersBar zoneNo={p.zoneNo} ponNo={p.ponNo} onChange={p.onPushQuery} />
    </div>
  );
}
```

- [ ] **Step 9.5: Refactor `WorksQAPage` to use `WorksQAPageHeader`**

Replace the existing header markup in `WorksQAPage.tsx` with `<WorksQAPageHeader … />`. Verify the file is now < 200 lines via `wc -l`.

- [ ] **Step 9.6: Run all works-qa component tests**

Run: `npx vitest run src/modules/works-qa/components/__tests__/`
Expected: PASS for new tests + no regressions on existing tests.

- [ ] **Step 9.7: Commit**

```bash
git add src/modules/works-qa/components/SnagReportButton.tsx \
        src/modules/works-qa/components/WorksQAPageHeader.tsx \
        src/modules/works-qa/components/WorksQAPage.tsx \
        src/modules/works-qa/components/__tests__/SnagReportButton.test.tsx
git commit -m "feat(works-qa): context-aware snag report button + page header extract"
```

---

## Task 10: Extend `SnagReportsPage` library with source filter

**Files:**
- Modify: `src/modules/construction-qa/components/snags/SnagReportsPage.tsx` (338 lines — adding ~50 LOC; if file would exceed 300, extract the new chip + scope-card variant into sibling components in this task)
- Test: `src/modules/construction-qa/components/snags/__tests__/SnagReportsPage.test.tsx`

- [ ] **Step 10.1: Write the failing test**

```tsx
// src/modules/construction-qa/components/snags/__tests__/SnagReportsPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { SnagReportsPage } from '../SnagReportsPage';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>{children}</SWRConfig>
);

describe('SnagReportsPage source filter', () => {
  it('passes source=scope to the API when Scoped chip selected', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [], pagination: { total: 0, page: 1, pageSize: 20 } }) });
    render(<SnagReportsPage projectId="p1" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /Scoped/i }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(c => String(c[0]));
      expect(calls.some(u => u.includes('source=scope'))).toBe(true);
    });
  });

  it('renders scope summary line for source=scope cards', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          id: 'r1', source: 'scope', report_number: 'SCOPE-LAWL-20260520-001',
          scope: 'zone', scope_zone_no: 24, scope_pon_no: null, scope_poles: null,
          scope_from_date: '2026-04-20', scope_to_date: '2026-05-20',
          pdf_url: 'https://x/r.pdf', project_name: 'Lawley', total_findings: 7,
          audit_date: '2026-05-20', generated_at: '2026-05-20T02:30:00Z',
        }],
        pagination: { total: 1, page: 1, pageSize: 20 },
      }),
    });
    render(<SnagReportsPage projectId="p1" />, { wrapper });
    expect(await screen.findByText(/SCOPE-LAWL-20260520-001/)).toBeInTheDocument();
    expect(screen.getByText(/Zone 24/)).toBeInTheDocument();
    expect(screen.getByText(/2026-04-20 → 2026-05-20/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open PDF/i })).toHaveAttribute('href', 'https://x/r.pdf');
  });
});
```

- [ ] **Step 10.2: Run failing test**

Run: `npx vitest run src/modules/construction-qa/components/snags/__tests__/SnagReportsPage.test.tsx`
Expected: FAIL.

- [ ] **Step 10.3: Modify the page**

Read `SnagReportsPage.tsx`. Add:

1. `const [source, setSource] = useState<'all'|'tqr'|'works_qa'|'scope'>('all');` near other state.
2. A chip row above the existing filters: 4 buttons (`All`, `TQR`, `Works QA`, `Scoped`) that call `setSource`. Use the same chip styling already in the file.
3. Append `&source=${source}` to the SWR fetch URL when `source !== 'all'`.
4. In the card render loop, when `report.source === 'scope'`, render an alternate card body:
   - Title: `report_number`
   - Summary line: a scope-summary string built from `scope_zone_no` / `scope_pon_no` / `scope_poles` (`"Zone 24"`, `"Zone 24 · PON 265"`, `"Pole LAW.P.X001"`).
   - Date range: `scope_from_date → scope_to_date` (ISO).
   - Actions: `<a href={pdf_url}>Open PDF</a>` and `<a href={`/api/snags/reports-scope-xlsx?id=${id}`}>Excel</a>`.

If adding this code pushes the file > 300 lines, extract a `ScopeReportCard.tsx` (< 100 lines) into the same directory and import it from `SnagReportsPage`.

- [ ] **Step 10.4: Run test**

Run: `npx vitest run src/modules/construction-qa/components/snags/__tests__/SnagReportsPage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 10.5: Confirm file size**

Run: `wc -l src/modules/construction-qa/components/snags/SnagReportsPage.tsx`
Expected: ≤ 300 lines. If exceeded, complete the `ScopeReportCard` extraction described in 10.3 before committing.

- [ ] **Step 10.6: Commit**

```bash
git add src/modules/construction-qa/components/snags/SnagReportsPage.tsx \
        src/modules/construction-qa/components/snags/__tests__/SnagReportsPage.test.tsx
# If ScopeReportCard.tsx was extracted:
git add src/modules/construction-qa/components/snags/ScopeReportCard.tsx
git commit -m "feat(snags): library source filter + scope report card"
```

---

## Task 11: Permission seed for `construction-qa.snags.report.delete`

**Files:**
- Modify: the permission seed file (locate via `grep -rn "construction-qa.snags.report" --include="*.ts" --include="*.sql"`)
- Test: `pages/api/snags/__tests__/reports-scope-delete.test.ts`

- [ ] **Step 11.1: Locate the seed**

```bash
grep -rn "construction-qa.snags" --include="*.ts" --include="*.sql" pages/api scripts | head -10
```

The result will point to either `scripts/migrations/sql/*permissions*.sql` or a `pages/api/_permissions/seed.ts`-style file. Use the file pattern found.

- [ ] **Step 11.2: Write the failing test**

```typescript
// pages/api/snags/__tests__/reports-scope-delete.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from '@/lib/db-pool';

describe('construction-qa.snags.report.delete permission row', () => {
  it('exists in permissions table', async () => {
    const rows = await sql`
      SELECT permission_key FROM permissions
      WHERE permission_key = 'construction-qa.snags.report.delete'
    `;
    expect(rows.length).toBe(1);
  });

  it('grants super_admin and manager; denies technician + viewer', async () => {
    const rows = await sql`
      SELECT role, action_view, action_create, action_edit, action_delete
      FROM role_permissions
      WHERE permission_key = 'construction-qa.snags.report.delete'
      ORDER BY role
    `;
    const byRole = Object.fromEntries(rows.map(r => [r.role, r]));
    expect(byRole.super_admin?.action_delete).toBe(true);
    expect(byRole.manager?.action_delete).toBe(true);
    expect(byRole.technician?.action_delete).toBe(false);
    expect(byRole.viewer?.action_delete).toBe(false);
  });
});
```

- [ ] **Step 11.3: Run failing test**

Run: `npx vitest run pages/api/snags/__tests__/reports-scope-delete.test.ts`
Expected: FAIL — permission row missing.

- [ ] **Step 11.4: Add the permission**

If the seed is SQL-driven, add a migration `scripts/migrations/sql/359_snag_report_delete_permission.sql` (or whichever number is next free):

```sql
INSERT INTO permissions (permission_key, description)
VALUES ('construction-qa.snags.report.delete', 'Delete snag reports (immutable audit trail)')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, action_view, action_create, action_edit, action_delete)
VALUES
  ('super_admin', 'construction-qa.snags.report.delete', true,  true,  true,  true),
  ('manager',     'construction-qa.snags.report.delete', true,  false, false, true),
  ('project_manager', 'construction-qa.snags.report.delete', true, false, false, false),
  ('technician',  'construction-qa.snags.report.delete', false, false, false, false),
  ('viewer',      'construction-qa.snags.report.delete', false, false, false, false)
ON CONFLICT (role, permission_key) DO UPDATE SET
  action_view   = EXCLUDED.action_view,
  action_create = EXCLUDED.action_create,
  action_edit   = EXCLUDED.action_edit,
  action_delete = EXCLUDED.action_delete;
```

…with a matching rollback. If the seed is a TS file, add the equivalent entries in code instead.

- [ ] **Step 11.5: Apply + verify**

```bash
PGPASSWORD='a23f6104debd1d3e88e8f00c0067f22f' psql -h localhost -p 5436 -U postgres.ironman-platform -d fibreflow -f scripts/migrations/sql/359_snag_report_delete_permission.sql
npx vitest run pages/api/snags/__tests__/reports-scope-delete.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 11.6: Commit**

```bash
git add scripts/migrations/sql/359_snag_report_delete_permission.sql \
        scripts/migrations/sql/rollback_359_snag_report_delete_permission.sql \
        pages/api/snags/__tests__/reports-scope-delete.test.ts
git commit -m "feat(rbac): construction-qa.snags.report.delete permission row"
```

---

## Task 12: Playwright e2e smoke test

**Files:**
- Create: `tests/e2e/p3-snag-report-flow.spec.ts`

- [ ] **Step 12.1: Write the test**

```typescript
// tests/e2e/p3-snag-report-flow.spec.ts
import { test, expect } from '@playwright/test';

const DEV_BASE = process.env.E2E_BASE_URL ?? 'https://dev.fibreflow.app';

test('P3: generate Zone 24 snag report from WorksQAPage', async ({ page, request }) => {
  // Assumes the test session is already signed in via Playwright auth setup.
  await page.goto(`${DEV_BASE}/works-qa?project_id=<LAWLEY_PROJECT_ID>&zone_no=24`);

  await expect(page.getByRole('button', { name: /Zone report/ })).toBeVisible();
  await page.getByRole('button', { name: /Zone report/ }).click();

  // Dialog open
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: /Generate/i })).toBeVisible();

  // Submit
  await page.getByRole('button', { name: /Generate/i }).click();

  // Confirmation
  await expect(page.getByText(/SCOPE-/)).toBeVisible({ timeout: 30_000 });
  const pdfLink = page.getByRole('link', { name: /Open PDF/i });
  await expect(pdfLink).toBeVisible();

  // Validate PDF is reachable
  const pdfHref = await pdfLink.getAttribute('href');
  expect(pdfHref).toMatch(/^https?:\/\//);
  const head = await request.head(pdfHref!);
  expect(head.ok()).toBe(true);

  // Library row visible
  await page.goto(`${DEV_BASE}/field-ops/snags/reports?projectId=<LAWLEY_PROJECT_ID>`);
  await page.getByRole('button', { name: /Scoped/i }).click();
  await expect(page.getByText(/SCOPE-LAWL-/).first()).toBeVisible({ timeout: 10_000 });
});
```

- [ ] **Step 12.2: Replace `<LAWLEY_PROJECT_ID>` placeholders**

```bash
PGPASSWORD='a23f6104debd1d3e88e8f00c0067f22f' psql -h localhost -p 5436 -U postgres.ironman-platform -d fibreflow -c "SELECT id FROM projects WHERE project_name ILIKE 'lawley%' LIMIT 1"
```

Replace both `<LAWLEY_PROJECT_ID>` placeholders in the test with the returned UUID. (Do NOT commit a placeholder.)

- [ ] **Step 12.3: Run the test against dev**

After dev deploy in Task 13, run:
```bash
npx playwright test tests/e2e/p3-snag-report-flow.spec.ts --project=chromium
```
Expected: PASS.

- [ ] **Step 12.4: Commit**

```bash
git add tests/e2e/p3-snag-report-flow.spec.ts
git commit -m "test(p3): e2e snag report scope flow"
```

---

## Task 13: Final gates — review, deploy, Johan WA

- [ ] **Step 13.1: Local CI**

Run: `npm run ci:quick`
Expected: PASS. If silent-catch ratchet trips at >74, find the new catch and add `log.warn` with `pg_code` / `pg_detail` (match the pattern used in PR #1666).

- [ ] **Step 13.2: Push branch + open PR**

```bash
cd /home/hein/Workspace/FF_Next.js-p3-spec
git push -u origin johan/p3-snag-reports-scope
gh pr create --title "feat(snags): P3 — per-pole/PON/zone snag reports" --body "$(cat <<'EOF'
## Summary
- Migration 358 adds scope columns + `source='scope'` to `snag_reports`
- New POST `/api/snags/reports-scope` generates immutable PDF snapshots (stored in VF Storage)
- New GET endpoints for PDF stream + on-demand Excel regeneration
- Existing `/api/snags/reports` extended with `?source=` filter
- New context-aware `SnagReportButton` + `SnagReportScopeDialog` in WorksQAPage
- `SnagReportsPage` library gains a source filter chip + scope card variant
- New `construction-qa.snags.report.delete` permission (super_admin + manager only)

Implements spec `docs/superpowers/specs/2026-05-20-johan-p3-snag-reports-scope-design.md` (commit 823877e5b).

## Test plan
- [ ] `npm run ci:quick` green
- [ ] Migration 358 applied on dev; rollback verified
- [ ] Playwright `p3-snag-report-flow.spec.ts` green against dev
- [ ] Johan WA sign-off (Afrikaans message)
- [ ] Production deploy after-hours with Hein's approval

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 13.3: Blind code review (REQUIRED)**

Invoke `/review-team` (NOT `/review` — this PR is ~1500+ LOC across backend + DB + frontend + Playwright). The reviewer agent receives only the diff + relevant CLAUDE.md files — never any context from this implementation session.

Wait for review verdict. If `REQUEST_CHANGES`, address every HIGH and MEDIUM finding in a follow-up commit. Do not merge with HIGH findings open.

- [ ] **Step 13.4: Wait for CI on self-hosted runner**

```bash
gh run watch <run-id> --exit-status
```
Expected: PASS. If GHA never schedules, fall back to `bash scripts/ci-local.sh` in a clean worktree and post the result as a PR comment.

- [ ] **Step 13.5: Merge**

```bash
gh pr merge <PR#> --merge --delete-branch
```

- [ ] **Step 13.6: Dev deploy**

```bash
cd /home/hein/Workspace/FF_Next.js
git checkout master && git pull
bash scripts/deploy-local.sh dev
```

Step 3a of the deploy script auto-applies migration 358 and (if numbered 359) the permission migration.

Expected: HTTP 200 on `dev.fibreflow.app`.

- [ ] **Step 13.7: Smoke-check on dev**

Open `https://dev.fibreflow.app/works-qa?project_id=<LAWLEY>&zone_no=24`, click `Zone report`, submit, verify confirmation panel shows `report_number` + working `Open PDF` link.

- [ ] **Step 13.8: Send Johan WA (Afrikaans)**

> P3 is op `dev.fibreflow.app`. Gaan na Works QA, kies 'n projek, en kyk vir die **Zone/PON/Pole report** knoppie regs bo. Klik dit, kies skopus, druk "Generate". Jy moet 'n PDF kry plus 'n Excel-download. Kontroleer dat die syfers reg lyk vir Zone 24. Laat weet of dit reg werk.

- [ ] **Step 13.9: Production deploy** (after Johan sign-off, after-hours, with Hein's OK)

```bash
bash scripts/deploy-local.sh production
```

- [ ] **Step 13.10: Update changelog + memories**

```bash
/log feat(snags): P3 — per-pole/PON/zone snag reports
```

Add a project memory entry for the new scoped-reports flow (`project_p3_snag_reports_scope.md`) so future sessions know about migration 358 + the immutable-snapshot pattern.

---

## Out of scope (explicitly NOT in this plan)

- Bulk per-pole VLM upload (P4 — separate plan)
- `snag_demotes_vlm` trigger (parent spec §4.6 mig 355)
- Cross-project scope reports
- Email / WhatsApp delivery of generated reports
- Scheduled / cron-driven regeneration
- Sharing scope reports via public token (would need `share_session_actors` pattern)
- Migrating `pages/api/snags/reports.ts` from the Neon serverless shim to `pg.Pool`

---

## Self-review notes (filled during plan writing)

**Spec coverage:** All four locked decisions from the spec map to tasks: D1 (persist) → T1+T4, D2 (immutable snapshot) → T4 storage upload step, D3 (library home) → T6+T10, D4 (PDF + xlsx) → T4+T5. RBAC mapped to T11. Browser verification mapped to T12.

**Spec deltas captured:** Migration number bump (357 → 358), permission key dot notation, slot-thumbnail logic moved from SQL to renderer (per spec self-review fix).

**File-size guardrails:** Every file has an explicit budget; T9 + T10 include the refactor instructions when limits would be exceeded.

**Risks acknowledged:**
- `pages/api/snags/zone-pon-options.ts` may not accept `?kind=` — Step 8.5 has a contingency.
- `src/lib/vfStorage.ts` may not be the actual helper path — Step 4.4 has a contingency.
- `renderReportHtml` signature in the universal template — pre-flight read of `src/templates/reports/report-template.ts` in Step 3.4 before the renderer is committed.
