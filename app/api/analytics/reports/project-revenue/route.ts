/**
 * GET /api/analytics/reports/project-revenue
 *
 * Returns Cost Centre Profitability: COS vs Revenue per project.
 * Sources: "FT_Revenue" (actual invoiced revenue) + "Project_Costing" (COS Total).
 * Both sources are required — 500 if either fails.
 *
 * Access restricted to authorised users via RBAC (analytics.reports / view)
 * or direct user-ID allowlist.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';
import { verifyToken } from '@/lib/auth/jwt';
import { userHasPermission } from '@/lib/permissions';
import { getWorksheetRange } from '@/lib/graph/sharepoint-excel';

const logger = createLogger('analytics:api:cost-centre-profitability');

/** Allowlist — fallback guard independent of RBAC table */
const ALLOWED_USERS = new Set([
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', // Hein
  '7d84184b-2a2b-4fbb-a52e-9815d0e92237', // Lew
]);

// 🟢 WORKING: Cost Centre Profitability response types — COS vs Revenue per project
export interface ProjectProfitability {
  project: string;
  revenue: number;
  cos: number;
  grossProfit: number;
  margin: number;
}

export interface CostCentreRevenueItem {
  tier1: string;
  revenue: number;
  cos: number;
  grossProfit: number;
  margin: number;
  children: ProjectProfitability[];
}

interface ApiResponse {
  success: true;
  data: CostCentreRevenueItem[];
  meta: { generatedAt: string; itemCount: number; sources: string[] };
}

function toNumber(cell: unknown): number {
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'string') return parseFloat(cell.replace(/[^0-9.\-]/g, '')) || 0;
  return 0;
}

function findColContains(headers: unknown[], include: string): number {
  const incL = include.toLowerCase();
  return headers.findIndex((h) => String(h ?? '').toLowerCase().includes(incL));
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Parse "FT_Revenue" worksheet.
 * Header row at index 0.
 * col 6 = "Project Name", col 9 = " Debit Excl VAT" (detect by "debit excl").
 * Returns Map<normalizedProjectName, totalRevenue>.
 */
function parseFTRevenue(values: unknown[][]): Map<string, { display: string; total: number }> {
  const headers = (values[0] ?? []) as unknown[];
  logger.info('FT_Revenue headers', { headers: headers.slice(0, 15) });

  // Project Name — col 6 expected, fallback search
  let projectCol = 6;
  const projectHeader = String(headers[6] ?? '').toLowerCase();
  if (!projectHeader.includes('project')) {
    projectCol = findColContains(headers, 'project name');
    if (projectCol < 0) projectCol = findColContains(headers, 'project');
    if (projectCol < 0) projectCol = 6;
  }

  // Debit Excl VAT — detect by "debit excl", fallback col 9
  let debitCol = findColContains(headers, 'debit excl');
  if (debitCol < 0) debitCol = 9;

  logger.info('FT_Revenue column detection', { projectCol, debitCol });

  const grouped = new Map<string, { display: string; total: number }>();

  for (let i = 1; i < values.length; i++) {
    const row = values[i] as unknown[];
    const project = String(row[projectCol] ?? '').trim();
    const amount = toNumber(row[debitCol]);
    if (!project && amount === 0) continue;
    const display = project || '(Unassigned)';
    const key = normalize(display);
    const existing = grouped.get(key);
    if (existing) {
      existing.total += amount;
    } else {
      grouped.set(key, { display, total: amount });
    }
  }

  logger.info('FT_Revenue parsed', { projects: grouped.size });
  return grouped;
}

/**
 * Parse "Project_Costing" worksheet.
 * Header row at index 2 (rows 0+1 are meta/section headers).
 * col 3 = project name, col 9 = "COS - Total" (detect by cos+total, fallback col 9).
 * Data rows start at index 3, skip rows where col 3 is empty.
 * Returns Map<normalizedProjectName, { display, cos }>.
 */
function parseProjectCosting(
  values: unknown[][]
): Map<string, { display: string; cos: number }> {
  if (values.length < 4) {
    logger.warn('Project_Costing: insufficient rows', { rowCount: values.length });
    return new Map();
  }

  const headers = (values[2] ?? []) as unknown[];
  logger.info('Project_Costing headers (row 2)', { headers: headers.slice(0, 15) });

  // COS Total — detect by contains("cos") AND contains("total"), fallback col 9
  let cosCol = headers.findIndex(
    (h) =>
      String(h ?? '').toLowerCase().includes('cos') &&
      String(h ?? '').toLowerCase().includes('total')
  );
  if (cosCol < 0) cosCol = 9;

  logger.info('Project_Costing column detection', { cosCol });

  const cosMap = new Map<string, { display: string; cos: number }>();

  for (let i = 3; i < values.length; i++) {
    const row = values[i] as unknown[];
    const project = String(row[3] ?? '').trim();
    if (!project) continue; // skip empty project name rows
    const cos = toNumber(row[cosCol]);
    const key = normalize(project);
    cosMap.set(key, { display: project, cos });
  }

  logger.info('Project_Costing parsed', { projects: cosMap.size });
  return cosMap;
}

/**
 * Merge FT_Revenue + Project_Costing into a single CostCentreRevenueItem.
 * Case-insensitive name matching via normalized keys.
 * Projects with revenue but no COS → cos=0.
 * Projects with COS but no revenue → revenue=0.
 */
function buildProfitabilityItem(
  revenueMap: Map<string, { display: string; total: number }>,
  cosMap: Map<string, { display: string; cos: number }>
): CostCentreRevenueItem {
  // Union of all project keys
  const allKeys = new Set([...revenueMap.keys(), ...cosMap.keys()]);

  const children: ProjectProfitability[] = Array.from(allKeys).map((key) => {
    const rev = revenueMap.get(key);
    const cost = cosMap.get(key);
    const display = rev?.display ?? cost?.display ?? key;
    const revenue = rev?.total ?? 0;
    const cos = cost?.cos ?? 0;
    const grossProfit = revenue - cos;
    const margin = revenue !== 0 ? grossProfit / revenue : 0;
    return { project: display, revenue, cos, grossProfit, margin };
  });

  children.sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = children.reduce((s, c) => s + c.revenue, 0);
  const totalCos = children.reduce((s, c) => s + c.cos, 0);
  const totalGP = totalRevenue - totalCos;
  const totalMargin = totalRevenue !== 0 ? totalGP / totalRevenue : 0;

  return {
    tier1: 'Fibertime',
    revenue: totalRevenue,
    cos: totalCos,
    grossProfit: totalGP,
    margin: totalMargin,
    children,
  };
}

// 🟢 WORKING: Cost Centre Profitability GET handler — FT_Revenue + Project_Costing (both required)
export async function GET(_req: NextRequest): Promise<NextResponse> {
  // --- Authentication ---
  const cookieStore = await cookies();
  const token = cookieStore.get('ff_auth_token')?.value;

  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    );
  }

  const payload = await verifyToken(token);
  if (!payload?.sub) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
      { status: 401 }
    );
  }

  const userId = payload.sub;

  // --- Authorisation ---
  const hasAccess = await userHasPermission(userId, 'analytics.reports', 'view');
  if (!hasAccess && !ALLOWED_USERS.has(userId)) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access restricted to authorised users' },
      },
      { status: 403 }
    );
  }

  logger.info('Cost centre profitability requested', { userId });

  try {
    // Fetch both sheets in parallel — both required for profitability view
    const [ftResult, costingResult] = await Promise.allSettled([
      getWorksheetRange('FT_Revenue'),
      getWorksheetRange('Project_Costing'),
    ]);

    if (ftResult.status === 'rejected') {
      throw new Error(`FT_Revenue fetch failed: ${String(ftResult.reason)}`);
    }
    if (costingResult.status === 'rejected') {
      throw new Error(`Project_Costing fetch failed: ${String(costingResult.reason)}`);
    }

    const ftValues = ftResult.value.values ?? [];
    if (ftValues.length < 2) {
      throw new Error('FT_Revenue sheet returned no data rows');
    }

    const costingValues = costingResult.value.values ?? [];

    const revenueMap = parseFTRevenue(ftValues);
    const cosMap = parseProjectCosting(costingValues);

    const ft = buildProfitabilityItem(revenueMap, cosMap);

    const response: ApiResponse = {
      success: true,
      data: [ft],
      meta: {
        generatedAt: new Date().toISOString(),
        itemCount: 1,
        sources: ['FT_Revenue', 'Project_Costing'],
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Cost centre profitability fetch failed', { error: message });

    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}
