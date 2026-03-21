/**
 * GET /api/analytics/reports/project-revenue
 *
 * Returns Fibertime revenue with per-project breakdown (T1 + children).
 * Source: "FibertimeRevenue" worksheet only — Data tab not used.
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
 * Parse "FibertimeRevenue" worksheet.
 * Groups rows by project, sums Debit Excl VAT per project.
 * Returns a single CostCentreRevenueItem with children sorted by revenue desc.
 */
function parseFibertimeSheet(values: unknown[][]): CostCentreRevenueItem | null {
  if (values.length < 2) return null;

  const headers = values[0] as unknown[];

  // "Debit Excl VAT" — exact match first, then contains "debit excl"
  let debitCol = findColExact(headers, 'debit excl vat');
  if (debitCol < 0) debitCol = findColContains(headers, 'debit excl');
  if (debitCol < 0) debitCol = findColContains(headers, 'debit');
  if (debitCol < 0) return null;

  // Project column — contains "project" (case-insensitive), fallback col 0
  let projectCol = findColContains(headers, 'project');
  if (projectCol < 0) projectCol = 0;

  const grouped = new Map<string, number>();

  for (let i = 1; i < values.length; i++) {
    const row = values[i] as unknown[];
    const project = String(row[projectCol] ?? '').trim();
    if (!project) continue;
    grouped.set(project, (grouped.get(project) ?? 0) + toNumber(row[debitCol]));
  }

  if (grouped.size === 0) return null;

  const children: ProjectRevenueChild[] = Array.from(grouped.entries())
    .map(([project, revenue]) => ({ project, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const total = children.reduce((s, c) => s + c.revenue, 0);

  return { tier1: 'Fibertime', revenue: total, children };
}

// 🟢 WORKING: Cost Centre Revenue GET handler — reads live SharePoint FibertimeRevenue tab
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
    const { values } = await getWorksheetRange('FibertimeRevenue');

    if (!values || values.length < 2) {
      throw new Error('FibertimeRevenue sheet returned insufficient rows');
    }

    const ft = parseFibertimeSheet(values);
    if (!ft) {
      throw new Error('FibertimeRevenue sheet: no usable data found');
    }

    const response: ApiResponse = {
      success: true,
      data: [ft],
      meta: {
        generatedAt: new Date().toISOString(),
        itemCount: 1,
        sources: ['FibertimeRevenue'],
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
