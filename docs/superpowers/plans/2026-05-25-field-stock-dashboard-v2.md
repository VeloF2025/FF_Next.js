# Field-Stock Dashboard v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new orphaned `/procurement/field-stock/dashboard-v2` page showing four new metric groups (stock value, contractor exposure, serial lifecycle, ageing) with drill-down links, leaving the existing dashboard untouched.

**Architecture:** A thin `withAuth` API handler (`dashboard-v2.ts`) delegates to `dashboardV2Service.getDashboardV2Summary()`, which runs four parallel `sql` queries (via `@/lib/db-pool`) and shapes a `DashboardV2Summary`. A `useDashboardV2` hook fetches it; the page composes five extracted presentational components on the `var(--ff-*)` theme.

**Tech Stack:** Next.js Pages Router, TypeScript, `@/lib/db-pool` (`pg.Pool` neon-compatible `sql`), `@/lib/apiResponse`, `@/lib/logger`, Tailwind + `var(--ff-*)` tokens, Vitest, Playwright MCP.

**Spec:** `docs/superpowers/specs/2026-05-25-field-stock-dashboard-v2-design.md`

**Worktree:** `/home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard` (branch `feat/wave2-pr10-dashboard-v2`). All `git`/`npm` commands run with `git -C <worktree>` or after the harness `cd`s in; the worktree guard hook blocks main-tree writes.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/types/field-stock/dashboardV2.ts` (create) | `DashboardV2Summary` + sub-type interfaces |
| `src/types/field-stock/index.ts` (modify) | re-export the new type |
| `src/modules/procurement/field-stock/services/dashboardV2Service.ts` (create) | 4 parallel SQL queries → `DashboardV2Summary` |
| `pages/api/procurement/field-stock/dashboard-v2.ts` (create) | thin `withAuth` GET handler |
| `src/modules/procurement/field-stock/hooks/useDashboardV2.ts` (create) | client fetch hook |
| `src/components/field-stock/dashboard-v2/KpiHeroRow.tsx` (create) | 4 headline cards |
| `src/components/field-stock/dashboard-v2/StockValueByLocation.tsx` (create) | value per location |
| `src/components/field-stock/dashboard-v2/ContractorExposureTable.tsx` (create) | top contractors table |
| `src/components/field-stock/dashboard-v2/SerialLifecyclePanel.tsx` (create) | 11-state breakdown + funnel |
| `src/components/field-stock/dashboard-v2/AgeingPanel.tsx` (create) | stagnant + issued-not-installed |
| `pages/procurement/field-stock/dashboard-v2.tsx` (create) | page composing the above |
| `tests/api/procurement/field-stock/dashboard-v2.test.ts` (create) | HTTP boundary (service mocked) |
| `tests/services/field-stock/dashboardV2Service.test.ts` (create) | shaping logic (`sql` mocked) |

Constants: ageing `THRESHOLD_DAYS = 30`, `TOP_CONTRACTORS = 10` live in the service.

---

## Task 1: Types

**Files:**
- Create: `src/types/field-stock/dashboardV2.ts`
- Modify: `src/types/field-stock/index.ts`

- [ ] **Step 1: Create the type module**

```ts
// src/types/field-stock/dashboardV2.ts
export interface StockValueByLocationRow {
  name: string;
  type: string;
  value: number;
  itemCount: number;
}

export interface ContractorExposureRow {
  name: string;
  heldValue: number;
  unaccountedValue: number;
  isBlocked: boolean;
}

export interface DashboardV2Summary {
  stockValue: {
    total: number;
    byLocation: StockValueByLocationRow[];
  };
  contractorExposure: {
    totalHeldValue: number;
    totalUnaccountedValue: number;
    totalPendingRecovery: number;
    blockedCount: number;
    top: ContractorExposureRow[];
  };
  serialsLifecycle: {
    byStatus: Record<string, number>;
    installed: number;
    activated: number;
    recentlyInstalled: number;
    recentlyActivated: number;
  };
  ageing: {
    thresholdDays: number;
    stagnantStockCount: number;
    stagnantStockValue: number;
    serialsIssuedNotInstalled: number;
  };
}
```

- [ ] **Step 2: Re-export from the barrel**

Add to `src/types/field-stock/index.ts` (append after the existing exports):

```ts
export type {
  DashboardV2Summary,
  StockValueByLocationRow,
  ContractorExposureRow,
} from './dashboardV2';
```

- [ ] **Step 3: Typecheck**

Run: `git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard status >/dev/null; npx tsc --noEmit -p /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard/tsconfig.json 2>&1 | grep dashboardV2 || echo "no dashboardV2 type errors"`
Expected: `no dashboardV2 type errors`

- [ ] **Step 4: Commit**

```bash
git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard add src/types/field-stock/dashboardV2.ts src/types/field-stock/index.ts
git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard commit -m "feat(wave2): PR-10 dashboard v2 types"
```

---

## Task 2: Service shaping logic (TDD)

**Files:**
- Create: `tests/services/field-stock/dashboardV2Service.test.ts`
- Create: `src/modules/procurement/field-stock/services/dashboardV2Service.ts`

The four queries fire in this exact order inside `Promise.all`, so the test queues four `mockResolvedValueOnce` in the same order: **(1) stockValue rows, (2) contractor rows, (3) lifecycle rows, (4) ageing single-row array.**

- [ ] **Step 1: Write the failing test**

```ts
// tests/services/field-stock/dashboardV2Service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ sql: sqlMock }));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { getDashboardV2Summary } from '@/modules/procurement/field-stock/services/dashboardV2Service';

describe('getDashboardV2Summary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shapes the four metric groups from raw rows', async () => {
    sqlMock
      // 1. stock value by location
      .mockResolvedValueOnce([
        { name: 'Main WH', type: 'warehouse', value: '1500.50', item_count: '3' },
        { name: 'Site A', type: 'site_store', value: '200', item_count: '1' },
      ])
      // 2. contractor rows (ordered by unaccounted desc)
      .mockResolvedValueOnce([
        { name: 'Acme', held_value: '500', unaccounted_value: '300', is_blocked: true },
        { name: 'Bolt', held_value: '100', unaccounted_value: '0', is_blocked: false },
      ])
      // 3. lifecycle rows grouped by status
      .mockResolvedValueOnce([
        { status: 'installed', cnt: '4', recent_installed: '1', recent_activated: '0' },
        { status: 'activated', cnt: '6', recent_installed: '0', recent_activated: '2' },
      ])
      // 4. ageing single row
      .mockResolvedValueOnce([
        { stagnant_count: '7', stagnant_value: '900.25', issued_not_installed: '5' },
      ]);

    const result = await getDashboardV2Summary();

    expect(result.stockValue.total).toBe(1700.5);
    expect(result.stockValue.byLocation).toEqual([
      { name: 'Main WH', type: 'warehouse', value: 1500.5, itemCount: 3 },
      { name: 'Site A', type: 'site_store', value: 200, itemCount: 1 },
    ]);
    expect(result.contractorExposure.totalHeldValue).toBe(600);
    expect(result.contractorExposure.totalUnaccountedValue).toBe(300);
    expect(result.contractorExposure.blockedCount).toBe(1);
    expect(result.contractorExposure.top[0]).toEqual({
      name: 'Acme', heldValue: 500, unaccountedValue: 300, isBlocked: true,
    });
    expect(result.serialsLifecycle.byStatus).toEqual({ installed: 4, activated: 6 });
    expect(result.serialsLifecycle.installed).toBe(4);
    expect(result.serialsLifecycle.activated).toBe(6);
    expect(result.serialsLifecycle.recentlyInstalled).toBe(1);
    expect(result.serialsLifecycle.recentlyActivated).toBe(2);
    expect(result.ageing).toEqual({
      thresholdDays: 30,
      stagnantStockCount: 7,
      stagnantStockValue: 900.25,
      serialsIssuedNotInstalled: 5,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard && npx vitest run tests/services/field-stock/dashboardV2Service.test.ts`
Expected: FAIL — cannot resolve `@/modules/.../dashboardV2Service` (module not created yet).

- [ ] **Step 3: Write the service**

```ts
// src/modules/procurement/field-stock/services/dashboardV2Service.ts
/**
 * Dashboard v2 metrics service.
 * Four parallel aggregation queries → DashboardV2Summary.
 * Schema verified against live DB 2026-05-21..2026-05-25.
 */
import { sql } from '@/lib/db-pool';
import type {
  DashboardV2Summary,
  StockValueByLocationRow,
  ContractorExposureRow,
} from '@/types/field-stock';

const THRESHOLD_DAYS = 30;
const TOP_CONTRACTORS = 10;

interface StockValueRaw { name: string; type: string; value: string | number; item_count: string | number; }
interface ContractorRaw { name: string; held_value: string | number; unaccounted_value: string | number; is_blocked: boolean; }
interface LifecycleRaw { status: string; cnt: string | number; recent_installed: string | number; recent_activated: string | number; }
interface AgeingRaw { stagnant_count: string | number; stagnant_value: string | number; issued_not_installed: string | number; }

const n = (v: unknown): number => Number(v) || 0;

export async function getDashboardV2Summary(): Promise<DashboardV2Summary> {
  const [valueRows, contractorRows, lifecycleRows, ageingRows] = (await Promise.all([
    sql`
      SELECT sl.name AS name,
             sl.location_type AS type,
             COALESCE(SUM(COALESCE(sq.total_value, sq.quantity * sq.unit_cost, 0)), 0) AS value,
             COUNT(DISTINCT sq.stock_item_id) AS item_count
      FROM stock_quants sq
      JOIN stock_locations sl ON sl.id = sq.location_id
      WHERE sl.is_active = true
      GROUP BY sl.id, sl.name, sl.location_type
      HAVING COALESCE(SUM(COALESCE(sq.total_value, sq.quantity * sq.unit_cost, 0)), 0) <> 0
      ORDER BY value DESC
    `,
    sql`
      SELECT contractor_name AS name,
             COALESCE(current_held_value, 0) AS held_value,
             COALESCE(unaccounted_value, 0) AS unaccounted_value,
             COALESCE(is_blocked, false) AS is_blocked
      FROM contractor_stock_accountability
      ORDER BY unaccounted_value DESC NULLS LAST, current_held_value DESC NULLS LAST
    `,
    sql`
      SELECT status,
             COUNT(*) AS cnt,
             SUM(CASE WHEN installed_date > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END) AS recent_installed,
             SUM(CASE WHEN status = 'activated' AND status_changed_at > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END) AS recent_activated
      FROM stock_serials
      GROUP BY status
    `,
    sql`
      SELECT
        (SELECT COUNT(*) FROM stock_quants
           WHERE quantity > 0 AND last_movement_date < NOW() - (${THRESHOLD_DAYS} || ' days')::interval) AS stagnant_count,
        (SELECT COALESCE(SUM(COALESCE(total_value, quantity * unit_cost, 0)), 0) FROM stock_quants
           WHERE quantity > 0 AND last_movement_date < NOW() - (${THRESHOLD_DAYS} || ' days')::interval) AS stagnant_value,
        (SELECT COUNT(*) FROM stock_serials
           WHERE status IN ('issued', 'in_transit')
             AND status_changed_at < NOW() - (${THRESHOLD_DAYS} || ' days')::interval) AS issued_not_installed
    `,
  ])) as [StockValueRaw[], ContractorRaw[], LifecycleRaw[], AgeingRaw[]];

  // Stock value
  const byLocation: StockValueByLocationRow[] = valueRows.map((r) => ({
    name: r.name,
    type: r.type,
    value: n(r.value),
    itemCount: n(r.item_count),
  }));
  const stockValueTotal = byLocation.reduce((acc, r) => acc + r.value, 0);

  // Contractor exposure
  let totalHeldValue = 0;
  let totalUnaccountedValue = 0;
  let blockedCount = 0;
  const contractors: ContractorExposureRow[] = contractorRows.map((r) => {
    const heldValue = n(r.held_value);
    const unaccountedValue = n(r.unaccounted_value);
    totalHeldValue += heldValue;
    totalUnaccountedValue += unaccountedValue;
    if (r.is_blocked) blockedCount += 1;
    return { name: r.name, heldValue, unaccountedValue, isBlocked: Boolean(r.is_blocked) };
  });

  // Serial lifecycle
  const byStatus: Record<string, number> = {};
  let recentlyInstalled = 0;
  let recentlyActivated = 0;
  for (const r of lifecycleRows) {
    byStatus[r.status] = n(r.cnt);
    recentlyInstalled += n(r.recent_installed);
    recentlyActivated += n(r.recent_activated);
  }

  // Ageing
  const ageingRow = ageingRows[0] ?? { stagnant_count: 0, stagnant_value: 0, issued_not_installed: 0 };

  return {
    stockValue: { total: stockValueTotal, byLocation },
    contractorExposure: {
      totalHeldValue,
      totalUnaccountedValue,
      totalPendingRecovery: 0,
      blockedCount,
      top: contractors.slice(0, TOP_CONTRACTORS),
    },
    serialsLifecycle: {
      byStatus,
      installed: byStatus['installed'] ?? 0,
      activated: byStatus['activated'] ?? 0,
      recentlyInstalled,
      recentlyActivated,
    },
    ageing: {
      thresholdDays: THRESHOLD_DAYS,
      stagnantStockCount: n(ageingRow.stagnant_count),
      stagnantStockValue: n(ageingRow.stagnant_value),
      serialsIssuedNotInstalled: n(ageingRow.issued_not_installed),
    },
  };
}
```

> NOTE: `totalPendingRecovery` is summed in Task 2b (kept out of the first test to keep query 2's mock minimal). It comes from `pending_recovery_amount` — see Step 5 below; the first version returns 0 and the test asserts only the fields shown.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard && npx vitest run tests/services/field-stock/dashboardV2Service.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Add pending-recovery to the contractor query + shaping**

In the contractor `sql` query add `COALESCE(pending_recovery_amount, 0) AS pending_recovery`; add `pending_recovery: string | number;` to `ContractorRaw`; declare `let totalPendingRecovery = 0;` and inside the map `totalPendingRecovery += n(r.pending_recovery);`; set `totalPendingRecovery` in the returned `contractorExposure`. Extend the test's contractor mock rows with `pending_recovery: '50'` / `'0'` and assert `result.contractorExposure.totalPendingRecovery).toBe(50)`.

- [ ] **Step 6: Run test again**

Run: `cd /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard && npx vitest run tests/services/field-stock/dashboardV2Service.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard add src/modules/procurement/field-stock/services/dashboardV2Service.ts tests/services/field-stock/dashboardV2Service.test.ts
git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard commit -m "feat(wave2): PR-10 dashboard v2 metrics service"
```

---

## Task 3: API handler (TDD)

**Files:**
- Create: `tests/api/procurement/field-stock/dashboard-v2.test.ts`
- Create: `pages/api/procurement/field-stock/dashboard-v2.ts`

- [ ] **Step 1: Write the failing test** (mirrors `tests/api/procurement/field-stock/serials-search.test.ts` harness)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { getSummaryMock } = vi.hoisted(() => ({ getSummaryMock: vi.fn() }));
vi.mock('@/lib/auth', () => ({ withAuth: (h: unknown) => h, withPermission: () => (h: unknown) => h }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('@/modules/procurement/field-stock/services/dashboardV2Service', () => ({
  getDashboardV2Summary: getSummaryMock,
}));

import handler from '../../../../pages/api/procurement/field-stock/dashboard-v2';

interface CapturedRes extends Partial<NextApiResponse> { statusCode?: number; jsonData?: unknown; }
function makeRes(): NextApiResponse & CapturedRes {
  const res: CapturedRes = {};
  res.status = vi.fn((c: number) => { res.statusCode = c; return res as NextApiResponse; });
  res.json = vi.fn((d: unknown) => { res.jsonData = d; return res as NextApiResponse; });
  res.setHeader = vi.fn(() => res as NextApiResponse);
  return res as NextApiResponse & CapturedRes;
}
function makeReq(method: string): NextApiRequest {
  return { method, query: {}, headers: {} } as unknown as NextApiRequest;
}

describe('GET /api/procurement/field-stock/dashboard-v2', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with the summary on happy path', async () => {
    const summary = { stockValue: { total: 1, byLocation: [] }, contractorExposure: { totalHeldValue: 0, totalUnaccountedValue: 0, totalPendingRecovery: 0, blockedCount: 0, top: [] }, serialsLifecycle: { byStatus: {}, installed: 0, activated: 0, recentlyInstalled: 0, recentlyActivated: 0 }, ageing: { thresholdDays: 30, stagnantStockCount: 0, stagnantStockValue: 0, serialsIssuedNotInstalled: 0 } };
    getSummaryMock.mockResolvedValueOnce(summary);
    const res = makeRes();
    await handler(makeReq('GET'), res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toMatchObject({ success: true, data: { stockValue: { total: 1 } } });
  });

  it('rejects non-GET with 405', async () => {
    const res = makeRes();
    await handler(makeReq('POST'), res);
    expect(res.statusCode).toBe(405);
  });

  it('returns 500 when the service throws', async () => {
    getSummaryMock.mockRejectedValueOnce(new Error('db down'));
    const res = makeRes();
    await handler(makeReq('GET'), res);
    expect(res.statusCode).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard && npx vitest run tests/api/procurement/field-stock/dashboard-v2.test.ts`
Expected: FAIL — handler module not found.

- [ ] **Step 3: Write the handler**

```ts
// pages/api/procurement/field-stock/dashboard-v2.ts
/**
 * Field Stock Dashboard v2 API
 * GET /api/procurement/field-stock/dashboard-v2 — four new metric groups.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { getDashboardV2Summary } from '@/modules/procurement/field-stock/services/dashboardV2Service';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }
  try {
    const summary = await getDashboardV2Summary();
    return apiResponse.success(res, summary);
  } catch (error) {
    log.error('Field stock dashboard v2 API error', { error }, 'field-stock/dashboard-v2');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard && npx vitest run tests/api/procurement/field-stock/dashboard-v2.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Smoke the live endpoint** (worktree has `.env.local` symlinked)

Run: `cd /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard && npx tsx -e "import('./src/modules/procurement/field-stock/services/dashboardV2Service').then(m=>m.getDashboardV2Summary()).then(s=>console.log(JSON.stringify(s.ageing), 'stockTotal=', s.stockValue.total)).catch(e=>{console.error(e);process.exit(1)})"`
Expected: prints an `ageing` object and a numeric `stockTotal` with no error (proves the SQL runs against the live DB). If `tsx` cannot load `@/` aliases, skip this step — the browser smoke in Task 9 covers live data.

- [ ] **Step 6: Commit**

```bash
git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard add "pages/api/procurement/field-stock/dashboard-v2.ts" tests/api/procurement/field-stock/dashboard-v2.test.ts
git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard commit -m "feat(wave2): PR-10 dashboard v2 API handler"
```

---

## Task 4: Fetch hook

**Files:**
- Create: `src/modules/procurement/field-stock/hooks/useDashboardV2.ts`

- [ ] **Step 1: Write the hook** (mirrors `useFieldStockDashboard.ts`)

```ts
// src/modules/procurement/field-stock/hooks/useDashboardV2.ts
/** useDashboardV2 — fetches the v2 metric summary. */
import { useState, useCallback, useEffect } from 'react';
import { log } from '@/lib/logger';
import type { DashboardV2Summary } from '@/types/field-stock';

interface UseDashboardV2Return {
  summary: DashboardV2Summary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useDashboardV2(): UseDashboardV2Return {
  const [summary, setSummary] = useState<DashboardV2Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/procurement/field-stock/dashboard-v2', { credentials: 'include' });
      const result = await res.json();
      if (!result.success) throw new Error(result.error?.message || 'Failed to load dashboard');
      setSummary(result.data as DashboardV2Summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load dashboard';
      setError(message);
      log.error('Failed to fetch dashboard v2', { error: err }, 'useDashboardV2');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => { await fetchData(); }, [fetchData]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  return { summary, loading, error, refresh };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard/tsconfig.json 2>&1 | grep useDashboardV2 || echo "ok"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard add src/modules/procurement/field-stock/hooks/useDashboardV2.ts
git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard commit -m "feat(wave2): PR-10 useDashboardV2 hook"
```

---

## Task 5: KpiHeroRow component

**Files:**
- Create: `src/components/field-stock/dashboard-v2/KpiHeroRow.tsx`

- [ ] **Step 1: Write the component** (presentational, <200 lines, `var(--ff-*)` tokens)

```tsx
// src/components/field-stock/dashboard-v2/KpiHeroRow.tsx
import { Banknote, AlertTriangle, ScanLine, Hourglass } from 'lucide-react';
import { formatCurrency } from '@/lib/formatCurrency';
import type { DashboardV2Summary } from '@/types/field-stock';

interface KpiCardProps { label: string; value: string; icon: React.ReactNode; accent: string; }

function KpiCard({ label, value, icon, accent }: KpiCardProps) {
  return (
    <div className="rounded-xl border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[var(--ff-text-secondary)]">{label}</p>
        <div className={`rounded-lg p-2 ${accent}`}>{icon}</div>
      </div>
      <p className="mt-2 text-3xl font-bold text-[var(--ff-text-primary)]">{value}</p>
    </div>
  );
}

export function KpiHeroRow({ summary }: { summary: DashboardV2Summary }) {
  const liveSerials = Object.values(summary.serialsLifecycle.byStatus).reduce((a, b) => a + b, 0);
  const ageingAlerts = summary.ageing.stagnantStockCount + summary.ageing.serialsIssuedNotInstalled;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard label="Stock value" value={formatCurrency(summary.stockValue.total)}
        icon={<Banknote className="h-5 w-5 text-emerald-500" />} accent="bg-emerald-500/10" />
      <KpiCard label="Unaccounted exposure" value={formatCurrency(summary.contractorExposure.totalUnaccountedValue)}
        icon={<AlertTriangle className="h-5 w-5 text-red-500" />} accent="bg-red-500/10" />
      <KpiCard label="Live serials" value={liveSerials.toLocaleString('en-ZA')}
        icon={<ScanLine className="h-5 w-5 text-blue-500" />} accent="bg-blue-500/10" />
      <KpiCard label={`Ageing alerts (>${summary.ageing.thresholdDays}d)`} value={ageingAlerts.toLocaleString('en-ZA')}
        icon={<Hourglass className="h-5 w-5 text-amber-500" />} accent="bg-amber-500/10" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard add src/components/field-stock/dashboard-v2/KpiHeroRow.tsx
git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard commit -m "feat(wave2): PR-10 KpiHeroRow"
```

---

## Task 6: StockValueByLocation + AgeingPanel components

**Files:**
- Create: `src/components/field-stock/dashboard-v2/StockValueByLocation.tsx`
- Create: `src/components/field-stock/dashboard-v2/AgeingPanel.tsx`

- [ ] **Step 1: StockValueByLocation**

```tsx
// src/components/field-stock/dashboard-v2/StockValueByLocation.tsx
import { formatCurrency } from '@/lib/formatCurrency';
import type { DashboardV2Summary } from '@/types/field-stock';

export function StockValueByLocation({ summary }: { summary: DashboardV2Summary }) {
  const rows = summary.stockValue.byLocation;
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  return (
    <section className="rounded-xl border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-5">
      <h2 className="mb-4 text-lg font-semibold text-[var(--ff-text-primary)]">Stock value by location</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--ff-text-tertiary)]">No valued stock on hand.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={`${r.name}-${r.type}`}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-[var(--ff-text-primary)]">{r.name}
                  <span className="ml-2 text-xs text-[var(--ff-text-tertiary)]">{r.type} · {r.itemCount} items</span>
                </span>
                <span className="font-medium text-[var(--ff-text-primary)]">{formatCurrency(r.value)}</span>
              </div>
              <div className="mt-1 h-2 w-full rounded-full bg-[var(--ff-bg-tertiary)]">
                <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${(r.value / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: AgeingPanel** (links to filtered serials register)

```tsx
// src/components/field-stock/dashboard-v2/AgeingPanel.tsx
import Link from 'next/link';
import { formatCurrency } from '@/lib/formatCurrency';
import type { DashboardV2Summary } from '@/types/field-stock';

export function AgeingPanel({ summary }: { summary: DashboardV2Summary }) {
  const a = summary.ageing;
  return (
    <section className="rounded-xl border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-5">
      <h2 className="mb-4 text-lg font-semibold text-[var(--ff-text-primary)]">Ageing &amp; slow-movers (&gt;{a.thresholdDays} days)</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-sm text-[var(--ff-text-secondary)]">Stagnant stock lines</p>
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{a.stagnantStockCount.toLocaleString('en-ZA')}</p>
        </div>
        <div>
          <p className="text-sm text-[var(--ff-text-secondary)]">Stagnant value</p>
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{formatCurrency(a.stagnantStockValue)}</p>
        </div>
        <div>
          <p className="text-sm text-[var(--ff-text-secondary)]">Issued, not installed</p>
          <Link href="/procurement/field-stock/serials?status=issued,in_transit"
            className="text-2xl font-bold text-blue-500 hover:underline">
            {a.serialsIssuedNotInstalled.toLocaleString('en-ZA')}
          </Link>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard add src/components/field-stock/dashboard-v2/StockValueByLocation.tsx src/components/field-stock/dashboard-v2/AgeingPanel.tsx
git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard commit -m "feat(wave2): PR-10 stock-value + ageing panels"
```

---

## Task 7: ContractorExposureTable + SerialLifecyclePanel components

**Files:**
- Create: `src/components/field-stock/dashboard-v2/ContractorExposureTable.tsx`
- Create: `src/components/field-stock/dashboard-v2/SerialLifecyclePanel.tsx`

- [ ] **Step 1: ContractorExposureTable** (row click → Accountability tab; old dashboard reaches accountability via `?tab=`—but the legacy page uses local state, so link to the page root and note the tab)

```tsx
// src/components/field-stock/dashboard-v2/ContractorExposureTable.tsx
import { formatCurrency } from '@/lib/formatCurrency';
import type { DashboardV2Summary } from '@/types/field-stock';

export function ContractorExposureTable({ summary }: { summary: DashboardV2Summary }) {
  const { top, totalHeldValue, totalUnaccountedValue, blockedCount } = summary.contractorExposure;
  return (
    <section className="rounded-xl border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Contractor exposure</h2>
        <span className="text-xs text-[var(--ff-text-tertiary)]">
          Held {formatCurrency(totalHeldValue)} · Unaccounted {formatCurrency(totalUnaccountedValue)} · {blockedCount} blocked
        </span>
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-[var(--ff-text-tertiary)]">No contractor stock on record.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-[var(--ff-text-tertiary)]">
                <th className="px-2 py-1">Contractor</th>
                <th className="px-2 py-1 text-right">Held</th>
                <th className="px-2 py-1 text-right">Unaccounted</th>
                <th className="px-2 py-1">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ff-border-light)]">
              {top.map((c) => (
                <tr key={c.name}>
                  <td className="px-2 py-2 text-[var(--ff-text-primary)]">{c.name}</td>
                  <td className="px-2 py-2 text-right text-[var(--ff-text-primary)]">{formatCurrency(c.heldValue)}</td>
                  <td className="px-2 py-2 text-right font-medium text-[var(--ff-text-primary)]">{formatCurrency(c.unaccountedValue)}</td>
                  <td className="px-2 py-2">
                    {c.isBlocked
                      ? <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-500">Blocked</span>
                      : <span className="text-xs text-[var(--ff-text-tertiary)]">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: SerialLifecyclePanel** (each state links to filtered register; funnel = installed→activated)

```tsx
// src/components/field-stock/dashboard-v2/SerialLifecyclePanel.tsx
import Link from 'next/link';
import type { DashboardV2Summary } from '@/types/field-stock';

const STATUS_ORDER = [
  'available', 'reserved', 'allocated_to_project', 'in_transit', 'issued',
  'installed', 'activated', 'faulty', 'in_repair', 'returned', 'scrapped',
] as const;

export function SerialLifecyclePanel({ summary }: { summary: DashboardV2Summary }) {
  const { byStatus, installed, activated, recentlyInstalled, recentlyActivated } = summary.serialsLifecycle;
  const activationRate = installed > 0 ? Math.round((activated / installed) * 100) : 0;
  return (
    <section className="rounded-xl border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-5">
      <h2 className="mb-4 text-lg font-semibold text-[var(--ff-text-primary)]">Serial lifecycle</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_ORDER.map((s) => (
          <Link key={s} href={`/procurement/field-stock/serials?status=${s}`}
            className="rounded-full border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] px-3 py-1 text-xs text-[var(--ff-text-primary)] hover:border-blue-500">
            {s} <span className="font-semibold">{(byStatus[s] ?? 0).toLocaleString('en-ZA')}</span>
          </Link>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3 border-t border-[var(--ff-border-light)] pt-4">
        <div><p className="text-sm text-[var(--ff-text-secondary)]">Installed (7d)</p><p className="text-2xl font-bold text-[var(--ff-text-primary)]">{recentlyInstalled}</p></div>
        <div><p className="text-sm text-[var(--ff-text-secondary)]">Activated (7d)</p><p className="text-2xl font-bold text-[var(--ff-text-primary)]">{recentlyActivated}</p></div>
        <div><p className="text-sm text-[var(--ff-text-secondary)]">Install→activate</p><p className="text-2xl font-bold text-[var(--ff-text-primary)]">{activationRate}%</p></div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard add src/components/field-stock/dashboard-v2/ContractorExposureTable.tsx src/components/field-stock/dashboard-v2/SerialLifecyclePanel.tsx
git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard commit -m "feat(wave2): PR-10 contractor + lifecycle panels"
```

---

## Task 8: The page

**Files:**
- Create: `pages/procurement/field-stock/dashboard-v2.tsx`

- [ ] **Step 1: Write the page** (<300 lines; composes the five components; loading/error/empty states; refresh)

```tsx
// pages/procurement/field-stock/dashboard-v2.tsx
import { useState } from 'react';
import { AppLayout } from '@/components/layout';
import { RefreshCw, ShoppingCart } from 'lucide-react';
import { useDashboardV2 } from '@/modules/procurement/field-stock/hooks/useDashboardV2';
import { KpiHeroRow } from '@/components/field-stock/dashboard-v2/KpiHeroRow';
import { StockValueByLocation } from '@/components/field-stock/dashboard-v2/StockValueByLocation';
import { ContractorExposureTable } from '@/components/field-stock/dashboard-v2/ContractorExposureTable';
import { SerialLifecyclePanel } from '@/components/field-stock/dashboard-v2/SerialLifecyclePanel';
import { AgeingPanel } from '@/components/field-stock/dashboard-v2/AgeingPanel';

export default function FieldStockDashboardV2() {
  const { summary, loading, error, refresh } = useDashboardV2();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => { setRefreshing(true); await refresh(); setRefreshing(false); };

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-500/10 p-2"><ShoppingCart className="h-6 w-6 text-purple-500" /></div>
              <div>
                <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Field Stock — Dashboard v2</h1>
                <p className="text-sm text-[var(--ff-text-secondary)]">Stock value, contractor exposure, serial lifecycle &amp; ageing</p>
              </div>
            </div>
            <button onClick={handleRefresh} disabled={refreshing}
              className="flex items-center gap-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] px-3 py-2 text-sm text-[var(--ff-text-primary)] disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>

        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          {loading && !summary && (
            <div className="py-20 text-center text-[var(--ff-text-secondary)]">Loading dashboard…</div>
          )}
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-500">
              <p className="font-medium">Error loading dashboard</p>
              <p className="text-sm">{error}</p>
              <button onClick={handleRefresh} className="mt-2 text-sm underline">Try again</button>
            </div>
          )}
          {summary && (
            <>
              <KpiHeroRow summary={summary} />
              <div className="grid gap-6 lg:grid-cols-2">
                <StockValueByLocation summary={summary} />
                <ContractorExposureTable summary={summary} />
              </div>
              <SerialLifecyclePanel summary={summary} />
              <AgeingPanel summary={summary} />
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
```

- [ ] **Step 2: Typecheck the whole feature**

Run: `npx tsc --noEmit -p /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard/tsconfig.json 2>&1 | grep -E "dashboard-v2|dashboardV2|field-stock/dashboard-v2" || echo "ok"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard add "pages/procurement/field-stock/dashboard-v2.tsx"
git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard commit -m "feat(wave2): PR-10 dashboard v2 page"
```

---

## Task 9: Verify, browser-smoke, PR

**Files:** none (verification + PR).

- [ ] **Step 1: Run all the new tests**

Run: `cd /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard && npx vitest run tests/services/field-stock/dashboardV2Service.test.ts tests/api/procurement/field-stock/dashboard-v2.test.ts`
Expected: all PASS.

- [ ] **Step 2: CI quick gate**

Run: `cd /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard && npm run ci:quick`
Expected: PASS — 0 lint errors; warnings & silent-catch counts must not regress the baseline. Fix any new lint errors before continuing (never `--no-verify`).

- [ ] **Step 3: Production build**

Run: `cd /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard && npm run build`
Expected: build succeeds; `/procurement/field-stock/dashboard-v2` appears in the route manifest.

- [ ] **Step 4: Browser smoke (Playwright MCP — mandatory)**

Start dev on the agreed port and drive it with `mcp__playwriter__execute` (the connected browser MCP; do NOT also use chrome-devtools/boss-ghost — `feedback_browser_mcp_exclusive`):
  1. `PORT=3004 npm run dev` in the worktree (background).
  2. Log in if needed, navigate to `http://localhost:3004/procurement/field-stock/dashboard-v2`.
  3. Screenshot the KPI row, stock-value + contractor section, lifecycle, ageing.
  4. Navigate to `http://localhost:3004/procurement/field-stock` and screenshot — **prove the old dashboard still renders unchanged** (parallel-run proof).
  5. Save screenshots for the PR body.

- [ ] **Step 5: Cross-check one headline number** (`feedback_cross_check_stats`)

Run a direct SQL check of stagnant-stock count against the dashboard's Ageing card, e.g.:
`psql "$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '\"')" -c "SELECT COUNT(*) FROM stock_quants WHERE quantity>0 AND last_movement_date < NOW() - INTERVAL '30 days';"`
Expected: matches the "Stagnant stock lines" figure shown in the browser.

- [ ] **Step 6: Push + open PR**

```bash
git -C /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard push -u origin feat/wave2-pr10-dashboard-v2
```
Then `gh pr create` with: summary, the screenshots, the parallel-run proof, and an explicit "no migration — schema probed" note. Base = `master`.

- [ ] **Step 7: Review + merge + deploy** (do NOT self-review)

- Invoke **review-team** (multi-domain, ~600–800 lines) — `feedback_review_team_for_code_prs`.
- Wait for CI green on the `velo-fibreflow` self-hosted runner: `gh run watch <id> --exit-status` (fallback: `bash scripts/ci-local.sh` in a clean checkout if GHA doesn't schedule).
- Merge only after blind-approve + CI green: `gh pr merge <N> --merge --delete-branch`.
- Remove the worktree (`git worktree remove /home/hein/Workspace/FF_Next.js-wave2-pr10-dashboard --force; git worktree prune`) — `feedback_worktree_cleanup`.
- `bash scripts/deploy-local.sh dev`.

---

## Notes / deferred

- **Trend lines (stretch, NOT this PR):** a 30-day activation trend would come from the `serial_events` table — out of scope; v1 ships the point-in-time funnel only.
- **Contractor row deep-link:** the legacy accountability view uses local tab state (no `?tab=` query support), so the exposure table does not yet deep-link into a pre-selected tab. If a `?tab=accountability` deep link is wanted, that's a tiny separate follow-up on `index.tsx`.
- **Promotion to default route:** separate follow-up PR after parallel-run validation (locked #2).
