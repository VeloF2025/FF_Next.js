/**
 * GET /api/analytics/reports/project-revenue
 *
 * Returns Cost Centre Profitability: COS vs Revenue per project.
 * Sources: "FT_Revenue" (actual invoiced revenue) + "Project_Costing" (COS Total).
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
export interface ProjectProfitabilityRow {
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
  children: ProjectProfitabilityRow[];
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

/**
 * Parse "FT_Revenue" worksheet.
 * Header row at index 0.
 * col 6 = "Project Name", col 9 = " Debit Excl VAT" (detect by "debit excl").
 * Returns Map<projectName, totalRevenue>.
 */
function parseFTRevenue(values: unknown[][]): Map<string, number> {
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

  const grouped = new Map<string, number>();

  for (let i = 1; i < values.length; i++) {
    const row = values[i] as unknown[];
    const project = String(row[projectCol] ?? '').trim();
    const amount = toNumber(row[debitCol]);
    if (!project && amount === 0) continue;
    const key = project || '(Unassigned)';
    grouped.set(key, (grouped.get(key) ?? 0) + amount);
  }

  logger.info('FT_Revenue parsed', { projects: grouped.size });
  return grouped;
}

/**
 * Parse "Project_Costing" worksheet.
 * Header row at index 2 (rows 0+1 are meta/section headers).
 * col 3 = project name, col 9 = "COS - Total".
 * Data rows start at index 3, stop when col 3 is empty.
 * Returns Map<projectName, cosTotal>.
 */
function parseProjectCosting(values: unknown[][]): Map<string, number> {
  if (values.length < 4) {
    logger.warn('Project_Costing: insufficient rows', { rowCount: values.length });
    return new Map();
  }

  const headers = (values[2] ?? []) as unknown[];
  logger.info('Project_Costing headers (row 2)', { headers: headers.slice(0, 15) });

  const cosMap = new Map<string, number>();

  for (let i = 3; i < values.length; i++) {
    const row = values[i] as unknown[];
    const project = String(row[3] ?? '').trim();
    if (!project) break; // stop at first empty project name
    const cos = toNumber(row[9]);
    cosMap.set(project, cos);
  }

  logger.info('Project_Costing parsed', { projects: cosMap.size });
  return cosMap;
}

/**
 * Merge FT_Revenue + Project_Costing into a single CostCentreRevenueItem.
 */
function buildProfitabilityItem(
  revenueMap: Map<string, number>,
  cosMap: Map<string, number>
): CostCentreRevenueItem {
  const children: ProjectProfitabilityRow[] = Array.from(revenueMap.entries())
    .map(([project, revenue]) => {
      const cos = cosMap.get(project) ?? 0;
      const grossProfit = revenue - cos;
      const margin = revenue !== 0 ? grossProfit / revenue : 0;
      return { project, revenue, cos, grossProfit, margin };
    })
    .sort((a, b) => b.revenue - a.revenue);

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

// 🟢 WORKING: Cost Centre Profitability GET handler — FT_Revenue + Project_Costing
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
    // Fetch both sheets in parallel — Project_Costing failure is non-fatal
    const [ftResult, costingResult] = await Promise.allSettled([
      getWorksheetRange('FT_Revenue'),
      getWorksheetRange('Project_Costing'),
    ]);

    // FT_Revenue is required
    if (ftResult.status === 'rejected') {
      throw new Error(`FT_Revenue fetch failed: ${String(ftResult.reason)}`);
    }

    const ftValues = ftResult.value.values ?? [];
    if (ftValues.length < 2) {
      throw new Error('FT_Revenue sheet returned no data rows');
    }

    const revenueMap = parseFTRevenue(ftValues);

    // Project_Costing is optional — degrade gracefully to COS = 0
    let cosMap = new Map<string, number>();
    const sources = ['FT_Revenue'];

    if (costingResult.status === 'fulfilled') {
      const costingValues = costingResult.value.values ?? [];
      cosMap = parseProjectCosting(costingValues);
      sources.push('Project_Costing');
    } else {
      logger.warn('Project_Costing fetch failed — COS will be 0 for all projects', {
        error: String(costingResult.reason),
      });
    }

    const ft = buildProfitabilityItem(revenueMap, cosMap);

    const response: ApiResponse = {
      success: true,
      data: [ft],
      meta: {
        generatedAt: new Date().toISOString(),
        itemCount: 1,
        sources,
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
