/**
 * GET /api/analytics/reports/project-revenue
 *
 * Project Profitability — Forecast vs Actual
 *
 * Project list: Project_Costing (col 3) + BritelinkMCT + BICT-US + MDU
 *
 * Forecast Revenue:  Project_Costing col 8
 * Forecast COS:      Project_Costing col 9
 *
 * Actual Revenue:
 *   - FibreTime projects → FT_Revenue sheet (col 6 = project, col 9 = amount)
 *   - BritelinkMCT       → Data tab Type=Income / Cost Centre T1=BritelinkMCT
 *   - BICT-US            → Data tab Type=Income / Cost Centre T1=BICT-US
 *   - MDU                → Data tab Type=Income / Cost Centre T1=MDU (none currently)
 *
 * Actual COS:
 *   - FibreTime projects → Data tab Type=Expense / Cost Centre T2=project
 *   - BritelinkMCT       → Data tab Type=Expense / Cost Centre T1=BritelinkMCT / T2=BritelinkMCT
 *   - BICT-US            → Data tab Type=Expense / Cost Centre T1=BICT-US
 *   - MDU                → Data tab Type=Expense / Cost Centre T1=BritelinkMCT / T2=MDU
 *
 * 🟢 WORKING
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';
import { verifyToken } from '@/lib/auth/jwt';
import { userHasPermission } from '@/lib/permissions';
import { getWorksheetRange } from '@/lib/graph/sharepoint-excel';

export const dynamic = 'force-dynamic';

const logger = createLogger('analytics:api:project-profitability');

const ALLOWED_USERS = new Set([
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', // Hein
  '7d84184b-2a2b-4fbb-a52e-9815d0e92237', // Lew
]);

export interface ProjectProfitabilityRow {
  project: string;
  forecastRevenue: number;
  forecastCos: number;
  forecastGP: number;
  forecastMargin: number | null; // null if no forecast
  actualRevenue: number;
  actualCos: number;
  actualGP: number;
  actualMargin: number | null;
}

export interface ProjectProfitabilityData {
  rows: ProjectProfitabilityRow[];
  totals: Omit<ProjectProfitabilityRow, 'project' | 'forecastMargin' | 'actualMargin'> & {
    forecastMargin: number | null;
    actualMargin: number | null;
  };
}

function toNum(cell: unknown): number {
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'string') return parseFloat(cell.replace(/[^0-9.\-]/g, '')) || 0;
  return 0;
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Match FT_Revenue project name to Project_Costing name (fuzzy) */
function matchProject(ftName: string, pcNames: string[]): string | null {
  const n = norm(ftName);
  // Exact match
  const exact = pcNames.find(p => norm(p) === n);
  if (exact) return exact;
  // Prefix match (e.g. "Thembisa POP 1" vs "Thembisa POP 1 (P1/2)")
  const prefix = pcNames.find(p => norm(p).startsWith(n) || n.startsWith(norm(p).split(' (')[0]));
  if (prefix) return prefix;
  return null;
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get('ff_auth_token')?.value;
  if (!token) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload?.sub) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }, { status: 401 });

  const hasAccess = await userHasPermission(payload.sub, 'analytics.reports', 'view');
  if (!hasAccess && !ALLOWED_USERS.has(payload.sub)) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'Access restricted' } }, { status: 403 });
  }

  try {
    const [pcResult, ftResult, dataResult] = await Promise.all([
      getWorksheetRange('Project_Costing'),
      getWorksheetRange('FT_Revenue'),
      getWorksheetRange('Data'),
    ]);

    const pcValues = pcResult.values ?? [];
    const ftValues = ftResult.values ?? [];
    const dataValues = dataResult.values ?? [];

    // ── 1. Project_Costing: forecast per project ──────────────────────────
    const forecastMap = new Map<string, { forecastRevenue: number; forecastCos: number }>();
    // header at row index 2, data from row 3
    for (let i = 3; i < pcValues.length; i++) {
      const row = pcValues[i] as unknown[];
      const name = String(row[3] ?? '').trim();
      if (!name || typeof row[3] !== 'string') continue;
      if (norm(name) === 'total') continue;
      forecastMap.set(name, {
        forecastRevenue: toNum(row[8]),
        forecastCos: toNum(row[9]),
      });
    }
    const pcProjectNames = Array.from(forecastMap.keys());
    logger.info('PC projects', { count: pcProjectNames.length });

    // ── 2. FT_Revenue: actual revenue for FibreTime projects ──────────────
    const ftRevMap = new Map<string, number>();
    const ftHeaders = (ftValues[0] ?? []) as unknown[];
    let projCol = 6;
    const projH = String(ftHeaders[6] ?? '').toLowerCase();
    if (!projH.includes('project')) {
      const idx = ftHeaders.findIndex(h => String(h ?? '').toLowerCase().includes('project'));
      if (idx >= 0) projCol = idx;
    }
    let debitCol = ftHeaders.findIndex(h => String(h ?? '').toLowerCase().includes('debit excl'));
    if (debitCol < 0) debitCol = 9;

    for (let i = 1; i < ftValues.length; i++) {
      const row = ftValues[i] as unknown[];
      const name = String(row[projCol] ?? '').trim();
      if (!name) continue;
      const matched = matchProject(name, pcProjectNames) ?? name;
      ftRevMap.set(matched, (ftRevMap.get(matched) ?? 0) + toNum(row[debitCol]));
    }

    // ── 3. Data tab: actual revenue + COS ─────────────────────────────────
    // Indexes: col2=Type, col6=AmountExclVAT, col10=Category, col15=T1, col16=T2
    const dataCosT2 = new Map<string, number>();   // T2-keyed (FibreTime project COS)
    const dataIncT1 = new Map<string, number>();   // T1-keyed (BritelinkMCT / BICT-US income)
    const dataCosT1T2 = new Map<string, number>(); // "T1|T2" keyed (MDU, BritelinkMCT COS)

    for (let i = 1; i < dataValues.length; i++) {
      const row = dataValues[i] as unknown[];
      const type = String(row[2] ?? '').trim();
      const t1 = String(row[15] ?? '').trim();
      const t2 = String(row[16] ?? '').trim();
      const amt = toNum(row[6]);

      if (type === 'Income') {
        if (t1 && !['', 'Loan', 'Liabilities', 'Transfer', 'Opex', 'Correction', 'Refund', 'Leave', 'Unallocated Income', 'VAT Control', 'Rent'].includes(t1)) {
          dataIncT1.set(t1, (dataIncT1.get(t1) ?? 0) + amt);
        }
      }

      if (type === 'Expense') {
        // T2-based COS (FibreTime projects)
        if (t2 && !['OPEX', 'CAPEX', 'Loan', 'Liabilities', 'Business Development', 'Fixed Assets', 'BritelinkMCT', 'BICT-US'].includes(t2)) {
          const matchedT2 = matchProject(t2, pcProjectNames) ?? t2;
          dataCosT2.set(matchedT2, (dataCosT2.get(matchedT2) ?? 0) + amt);
        }
        // T1-based COS (BritelinkMCT, BICT-US, MDU)
        if (['BritelinkMCT', 'BICT-US', 'MDU'].includes(t1)) {
          const key = t2 === 'MDU' ? 'MDU' : t1;
          dataCosT1T2.set(key, (dataCosT1T2.get(key) ?? 0) + amt);
        }
      }
    }

    // ── 4. Build project rows ──────────────────────────────────────────────
    const EXTRA_PROJECTS = ['BritelinkMCT', 'BICT-US', 'MDU'];
    const allProjects = [...pcProjectNames, ...EXTRA_PROJECTS];

    const rows: ProjectProfitabilityRow[] = allProjects.map(project => {
      const fc = forecastMap.get(project);
      const forecastRevenue = fc?.forecastRevenue ?? 0;
      const forecastCos = fc?.forecastCos ?? 0;
      const forecastGP = forecastRevenue - forecastCos;
      const forecastMargin = forecastRevenue > 0 ? forecastGP / forecastRevenue : null;

      let actualRevenue = 0;
      let actualCos = 0;

      if (EXTRA_PROJECTS.includes(project)) {
        actualRevenue = dataIncT1.get(project) ?? 0;
        actualCos = dataCosT1T2.get(project) ?? 0;
      } else {
        actualRevenue = ftRevMap.get(project) ?? 0;
        actualCos = dataCosT2.get(project) ?? (dataCosT2.get(norm(project)) ?? 0);
      }

      const actualGP = actualRevenue - actualCos;
      const actualMargin = actualRevenue > 0 ? actualGP / actualRevenue : null;

      return { project, forecastRevenue, forecastCos, forecastGP, forecastMargin, actualRevenue, actualCos, actualGP, actualMargin };
    });

    // Filter: keep rows with at least some data
    const filtered = rows.filter(r => r.forecastRevenue > 0 || r.actualRevenue > 0 || r.actualCos > 0);
    filtered.sort((a, b) => b.forecastRevenue - a.forecastRevenue || b.actualRevenue - a.actualRevenue);

    // Totals
    const totals = filtered.reduce(
      (acc, r) => ({
        ...acc,
        forecastRevenue: acc.forecastRevenue + r.forecastRevenue,
        forecastCos: acc.forecastCos + r.forecastCos,
        forecastGP: acc.forecastGP + r.forecastGP,
        actualRevenue: acc.actualRevenue + r.actualRevenue,
        actualCos: acc.actualCos + r.actualCos,
        actualGP: acc.actualGP + r.actualGP,
      }),
      { forecastRevenue: 0, forecastCos: 0, forecastGP: 0, actualRevenue: 0, actualCos: 0, actualGP: 0 }
    );

    const data: ProjectProfitabilityData = {
      rows: filtered,
      totals: {
        ...totals,
        forecastMargin: totals.forecastRevenue > 0 ? totals.forecastGP / totals.forecastRevenue : null,
        actualMargin: totals.actualRevenue > 0 ? totals.actualGP / totals.actualRevenue : null,
      },
    };

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Project profitability failed', { error: message });
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, { status: 500 });
  }
}
