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

/**
 * Explicit ordered project list — confirmed by Lew 2026-03-26.
 * FibreTime projects come from Project_Costing; BU projects appended at bottom.
 * DO NOT add dynamic rows from the Data tab.
 */
const PC_PROJECTS = [
  'Lawley',
  'Mohadin',
  'Mamelodi POP 1',
  'Etwatwa POP 2',
  'Grabouw',
  'Ivory Park',
  "Thembisa POP 1 (P1/2)",
  "Thembisa POP 2 (P1/2)",
  "Thembisa POP 3  (P1/2)",
  "Themb'elihle",
  'Mamelodi POP 2',
  'Mamelodi POP 3',
  'Tonga',
];

const BU_PROJECTS = ['BritelinkMCT', 'BICT-US', 'MDU'];

/** Map FT_Revenue or Data T2 name to canonical PC_PROJECTS name */
function matchProject(name: string, pcNames: string[]): string | null {
  const n = norm(name);
  const exact = pcNames.find(p => norm(p) === n);
  if (exact) return exact;
  // Prefix match: "Thembisa POP 1" → "Thembisa POP 1 (P1/2)"
  const prefix = pcNames.find(p => {
    const pn = norm(p).split(' (')[0];
    return n === pn || n.startsWith(pn) || pn.startsWith(n);
  });
  return prefix ?? null;
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

    // ── 1. Project_Costing: forecast per project (keyed by canonical name) ──
    // Sheet has two sections: "Prospective" (rows 3-21) and "Executable" (rows 23-33).
    // We use the EXECUTABLE section — find its header row first, then read until blank or "Total".
    const forecastMap = new Map<string, { forecastRevenue: number; forecastCos: number }>();
    let execHeaderIdx = -1;
    for (let i = 0; i < pcValues.length; i++) {
      const cell = String((pcValues[i] as unknown[])[3] ?? '').trim();
      if (cell === 'Project Scope - Executable') { execHeaderIdx = i; break; }
    }
    const execStart = execHeaderIdx >= 0 ? execHeaderIdx + 1 : 23; // fallback row 23
    for (let i = execStart; i < pcValues.length; i++) {
      const row = pcValues[i] as unknown[];
      const rawName = String(row[3] ?? '').trim();
      if (!rawName || typeof row[3] !== 'string') continue;
      if (norm(rawName) === 'total' || rawName.startsWith('Cost/Revenue')) break;
      const canonical = matchProject(rawName, PC_PROJECTS) ?? rawName;
      if (!forecastMap.has(canonical)) {
        forecastMap.set(canonical, { forecastRevenue: toNum(row[8]), forecastCos: toNum(row[9]) });
      }
    }
    logger.info('PC forecast map', { projects: Array.from(forecastMap.keys()) });

    // ── 2. FT_Revenue: actual revenue for FibreTime projects ──────────────
    const ftRevMap = new Map<string, number>();
    const ftHeaders = (ftValues[0] ?? []) as unknown[];
    let projCol = 6;
    if (!String(ftHeaders[6] ?? '').toLowerCase().includes('project')) {
      const idx = ftHeaders.findIndex(h => String(h ?? '').toLowerCase().includes('project'));
      if (idx >= 0) projCol = idx;
    }
    let debitCol = ftHeaders.findIndex(h => String(h ?? '').toLowerCase().includes('debit excl'));
    if (debitCol < 0) debitCol = 9;

    for (let i = 1; i < ftValues.length; i++) {
      const row = ftValues[i] as unknown[];
      const name = String(row[projCol] ?? '').trim();
      if (!name) continue;
      const canonical = matchProject(name, PC_PROJECTS);
      if (!canonical) continue; // only accumulate known PC projects
      ftRevMap.set(canonical, (ftRevMap.get(canonical) ?? 0) + toNum(row[debitCol]));
    }

    // ── 3. Data tab: actual revenue + COS ─────────────────────────────────
    const dataCosT2 = new Map<string, number>();   // canonical PC project → COS
    const dataIncT1 = new Map<string, number>();   // BU T1 → income
    const dataCosT1T2 = new Map<string, number>(); // BU project → COS

    for (let i = 1; i < dataValues.length; i++) {
      const row = dataValues[i] as unknown[];
      const type = String(row[2] ?? '').trim();
      const t1 = String(row[15] ?? '').trim();
      const t2 = String(row[16] ?? '').trim();
      const amt = toNum(row[6]);

      if (type === 'Income' && BU_PROJECTS.includes(t1)) {
        dataIncT1.set(t1, (dataIncT1.get(t1) ?? 0) + amt);
      }

      if (type === 'Expense') {
        // FibreTime project COS — only for known PC projects matched via T2
        const canonicalT2 = matchProject(t2, PC_PROJECTS);
        if (canonicalT2) {
          dataCosT2.set(canonicalT2, (dataCosT2.get(canonicalT2) ?? 0) + amt);
        }
        // BU project COS (BritelinkMCT, BICT-US, MDU)
        if (BU_PROJECTS.includes(t1)) {
          const key = t2 === 'MDU' ? 'MDU' : t1;
          dataCosT1T2.set(key, (dataCosT1T2.get(key) ?? 0) + amt);
        }
      }
    }

    // ── 4. Build project rows — FIXED ordered list, no dynamic discovery ───
    const allProjects = [...PC_PROJECTS, ...BU_PROJECTS];

    const rows: ProjectProfitabilityRow[] = allProjects.map(project => {
      const fc = forecastMap.get(project);
      const forecastRevenue = fc?.forecastRevenue ?? 0;
      const forecastCos = fc?.forecastCos ?? 0;
      const forecastGP = forecastRevenue - forecastCos;
      const forecastMargin = forecastRevenue > 0 ? forecastGP / forecastRevenue : null;

      let actualRevenue = 0;
      let actualCos = 0;

      if (BU_PROJECTS.includes(project)) {
        actualRevenue = dataIncT1.get(project) ?? 0;
        actualCos = dataCosT1T2.get(project) ?? 0;
      } else {
        actualRevenue = ftRevMap.get(project) ?? 0;
        actualCos = dataCosT2.get(project) ?? 0;
      }

      const actualGP = actualRevenue - actualCos;
      const actualMargin = actualRevenue > 0 ? actualGP / actualRevenue : null;

      return { project, forecastRevenue, forecastCos, forecastGP, forecastMargin, actualRevenue, actualCos, actualGP, actualMargin };
    });

    // Filter: keep only rows with at least some data (no empty placeholder rows)
    const filtered = rows.filter(r => r.forecastRevenue > 0 || r.actualRevenue > 0 || r.actualCos > 0);
    // Order is preserved from allProjects (explicit list) — no sort

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
