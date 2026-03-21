/**
 * GET /api/analytics/reports/project-revenue
 *
 * Returns contract revenue grouped by Cost Centre T1 (T1 only — T2 pending Lew spec).
 * Sources:
 *   • "Data" worksheet — Type=Income AND Category=Contract Revenue, Amount column
 *   • "FibertimeRevenue" worksheet — all rows, Debit Excl VAT column
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

// 🟢 WORKING: Cost Centre Revenue response types (T1 only — T2 pending spec)
export interface CostCentreRevenueItem {
  tier1: string;
  revenue: number;
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
  return (headers as unknown[]).findIndex(
    (h) => String(h ?? '').toLowerCase().trim() === lower
  );
}

function findColContains(headers: unknown[], include: string, ...exclude: string[]): number {
  const incL = include.toLowerCase();
  const excL = exclude.map((e) => e.toLowerCase());
  return (headers as unknown[]).findIndex((h) => {
    const s = String(h ?? '').toLowerCase();
    return s.includes(incL) && excL.every((e) => !s.includes(e));
  });
}

/** Parse the "Data" worksheet: Type=Income AND Category=Contract Revenue, grouped by Cost Centre T1 */
function parseDataSheet(values: unknown[][]): Map<string, number> {
  const result = new Map<string, number>();
  if (values.length < 2) return result;

  const headers = values[0] as unknown[];

  // Type column (fallback col 2)
  let typeCol = findColExact(headers, 'type');
  if (typeCol < 0) typeCol = findColContains(headers, 'type');
  if (typeCol < 0) typeCol = 2;

  // Category column — contains "category" but NOT "t1" or "t2" (fallback col 8)
  let categoryCol = findColContains(headers, 'category', 't1', 't2');
  if (categoryCol < 0) categoryCol = 8;

  // Cost Centre T1 column (fallback col 11)
  let tier1Col = findColContains(headers, 'cost centre t1');
  if (tier1Col < 0) tier1Col = 11;

  // Amount column — exact "amount" OR contains "amount excl" (fallback col 5)
  let amountCol = findColExact(headers, 'amount');
  if (amountCol < 0) amountCol = findColContains(headers, 'amount excl');
  if (amountCol < 0) amountCol = 5;

  for (let i = 1; i < values.length; i++) {
    const row = values[i] as unknown[];
    const type = String(row[typeCol] ?? '').trim();
    const category = String(row[categoryCol] ?? '').trim();

    if (type !== 'Income' || category !== 'Contract Revenue') continue;

    const t1 = String(row[tier1Col] ?? '').trim();
    if (!t1) continue;

    result.set(t1, (result.get(t1) ?? 0) + toNumber(row[amountCol]));
  }

  return result;
}

/** Parse the "FibertimeRevenue" worksheet: sum Debit Excl VAT column */
function parseFibertimeSheet(values: unknown[][]): CostCentreRevenueItem | null {
  if (values.length < 2) return null;

  const headers = values[0] as unknown[];

  // Find "Debit Excl VAT" — contains "debit excl" (fallback: scan all columns for best match)
  let debitCol = findColContains(headers, 'debit excl');
  if (debitCol < 0) {
    // Last-resort: any column containing "debit"
    debitCol = findColContains(headers, 'debit');
  }
  if (debitCol < 0) return null;

  let total = 0;
  for (let i = 1; i < values.length; i++) {
    total += toNumber((values[i] as unknown[])[debitCol]);
  }

  return { tier1: 'Fibertime', revenue: total };
}

// 🟢 WORKING: Cost Centre Revenue GET handler — reads live SharePoint data
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
    // Fetch both sheets in parallel; FibertimeRevenue failure is non-fatal
    const [dataResult, fibertimeResult] = await Promise.allSettled([
      getWorksheetRange('Data'),
      getWorksheetRange('FibertimeRevenue'),
    ]);

    if (dataResult.status === 'rejected') {
      throw new Error(`Data sheet fetch failed: ${String(dataResult.reason)}`);
    }

    const { values: dataValues } = dataResult.value;
    if (!dataValues || dataValues.length < 2) {
      throw new Error('Data sheet returned insufficient rows');
    }

    const grouped = parseDataSheet(dataValues);
    const sources = ['Data'];

    const items: CostCentreRevenueItem[] = Array.from(grouped.entries()).map(
      ([tier1, revenue]) => ({ tier1, revenue })
    );

    if (fibertimeResult.status === 'fulfilled') {
      const ft = parseFibertimeSheet(fibertimeResult.value.values);
      if (ft) {
        items.push(ft);
        sources.push('FibertimeRevenue');
      }
    } else {
      logger.warn('FibertimeRevenue sheet unavailable — continuing without it', {
        error: String(fibertimeResult.reason),
      });
    }

    // Sort by tier1 asc
    items.sort((a, b) => a.tier1.localeCompare(b.tier1));

    const response: ApiResponse = {
      success: true,
      data: items,
      meta: {
        generatedAt: new Date().toISOString(),
        itemCount: items.length,
        sources,
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
