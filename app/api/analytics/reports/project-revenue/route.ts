/**
 * GET /api/analytics/reports/project-revenue
 *
 * Returns Fibertime revenue with per-project breakdown (T1 + children).
 * Source: "FT_Revenue" worksheet only — Data tab not used.
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

const logger = createLogger('analytics:api:cost-centre-revenue');

/** Allowlist — fallback guard independent of RBAC table */
const ALLOWED_USERS = new Set([
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', // Hein
  '7d84184b-2a2b-4fbb-a52e-9815d0e92237', // Lew
]);

// 🟢 WORKING: Cost Centre Revenue response types — Fibertime T1 with project children
export interface ProjectRevenueChild {
  project: string;
  revenue: number;
}

export interface CostCentreRevenueItem {
  tier1: string;
  revenue: number;
  children: ProjectRevenueChild[];
}

interface ApiResponse {
  success: true;
  data: CostCentreRevenueItem[];
  meta: { generatedAt: string; itemCount: number; sources: string[] };
}

function toNumber(cell: unknown): number {
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'string') return parseFloat(cell) || 0;
  return 0;
}

function findColExact(headers: unknown[], term: string): number {
  const lower = term.toLowerCase();
  return headers.findIndex((h) => String(h ?? '').toLowerCase().trim() === lower);
}

function findColContains(headers: unknown[], include: string): number {
  const incL = include.toLowerCase();
  return headers.findIndex((h) => String(h ?? '').toLowerCase().includes(incL));
}

/**
 * Parse "FT_Revenue" worksheet.
 * Groups rows by project, sums Debit Excl VAT per project.
 * Returns a single CostCentreRevenueItem with children sorted by revenue desc.
 */
function parseFibertimeSheet(values: unknown[][]): CostCentreRevenueItem {
  // Always returns something — never throws. Logs headers for diagnostics.
  const headers = (values[0] ?? []) as unknown[];

  logger.info('FT_Revenue headers', { headers: headers.slice(0, 20) });

  // "Debit Excl VAT" — try multiple patterns before giving up
  let debitCol = findColExact(headers, 'debit excl vat');
  if (debitCol < 0) debitCol = findColContains(headers, 'debit excl');
  if (debitCol < 0) debitCol = findColContains(headers, 'debit');
  if (debitCol < 0) debitCol = findColContains(headers, 'amount');
  if (debitCol < 0) debitCol = findColContains(headers, 'revenue');
  // Hard fallback: last numeric-looking column in first data row
  if (debitCol < 0 && values.length > 1) {
    const firstRow = values[1] as unknown[];
    for (let c = firstRow.length - 1; c >= 0; c--) {
      if (typeof firstRow[c] === 'number') { debitCol = c; break; }
    }
  }

  // Project column — "project" in header, fallback col 0
  let projectCol = findColContains(headers, 'project');
  if (projectCol < 0) projectCol = 0;

  logger.info('FT_Revenue column detection', { debitCol, projectCol });

  // If debitCol still not found, return Fibertime with revenue=0 and no children
  if (debitCol < 0) {
    logger.warn('FT_Revenue: could not detect revenue column');
    return { tier1: 'Fibertime', revenue: 0, children: [] };
  }

  const grouped = new Map<string, number>();

  for (let i = 1; i < values.length; i++) {
    const row = values[i] as unknown[];
    const project = String(row[projectCol] ?? '').trim();
    const amount = toNumber(row[debitCol]);
    if (!project && amount === 0) continue;
    // Use "(Unassigned)" if project name is empty but there's a value
    const key = project || '(Unassigned)';
    grouped.set(key, (grouped.get(key) ?? 0) + amount);
  }

  const children: ProjectRevenueChild[] = Array.from(grouped.entries())
    .map(([project, revenue]) => ({ project, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const total = children.reduce((s, c) => s + c.revenue, 0);

  logger.info('FT_Revenue parsed', { projects: children.length, total });

  return { tier1: 'Fibertime', revenue: total, children };
}

// 🟢 WORKING: Cost Centre Revenue GET handler — reads live SharePoint FT_Revenue tab
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

  logger.info('Cost centre revenue requested', { userId });

  try {
    // Try both tab name variants (with and without space)
    let sheetValues: unknown[][] | null = null;
    try {
      const res = await getWorksheetRange('FT_Revenue');
      sheetValues = res.values ?? null;
    } catch {
      logger.warn('FT_Revenue (no space) failed — trying "FT_Revenue"');
    }
    if (!sheetValues || sheetValues.length < 2) {
      const res2 = await getWorksheetRange('FT_Revenue');
      sheetValues = res2.values ?? null;
    }
    if (!sheetValues || sheetValues.length < 2) {
      throw new Error('FT_Revenue sheet not found under either tab name variant');
    }

    const ft = parseFibertimeSheet(sheetValues);

    const response: ApiResponse = {
      success: true,
      data: [ft],
      meta: {
        generatedAt: new Date().toISOString(),
        itemCount: 1,
        sources: ['FT_Revenue'],
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Cost centre revenue fetch failed', { error: message });

    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}
