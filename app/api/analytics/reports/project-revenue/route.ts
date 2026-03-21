/**
 * GET /api/analytics/reports/project-revenue
 *
 * Returns contract revenue grouped by Cost Centre T1 + Cost Centre
 * from the Shareholder Model "Data" worksheet, plus a Fibertime total
 * from the "Fibertime Revenue" worksheet.
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

// 🟢 WORKING: Cost Centre Revenue response types
export interface CostCentreRevenueItem {
  tier1: string;
  tier2: string;
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

function findCol(headers: unknown[], ...terms: string[]): number {
  const lower = terms.map((t) => t.toLowerCase());
  const idx = (headers as unknown[]).findIndex((h) => {
    const s = String(h ?? '').toLowerCase();
    return lower.some((t) => s.includes(t));
  });
  return idx;
}

/** Parse the "Data" worksheet and return Contract Revenue rows grouped by cost centres */
function parseDataSheet(values: unknown[][]): CostCentreRevenueItem[] {
  if (values.length < 2) return [];

  const headers = values[0] as unknown[];

  // Dynamic column detection with fallbacks
  let categoryCol = findCol(headers, 'category');
  if (categoryCol < 0) categoryCol = 8;

  let amountCol = findCol(headers, 'amount excl', 'amount excl. vat', 'excl. vat');
  if (amountCol < 0) amountCol = 5;

  let tier1Col = findCol(headers, 'cost centre t1');
  if (tier1Col < 0) tier1Col = 11;

  // Cost Centre (not T1) — must not include "T1" to distinguish from tier1
  let tier2Col = -1;
  const ccIdx = (headers as unknown[]).findIndex((h) => {
    const s = String(h ?? '').toLowerCase();
    return s.includes('cost centre') && !s.includes('t1');
  });
  tier2Col = ccIdx >= 0 ? ccIdx : 12;

  const grouped = new Map<string, number>();

  for (let i = 1; i < values.length; i++) {
    const row = values[i] as unknown[];
    const category = String(row[categoryCol] ?? '').trim();
    if (category !== 'Contract Revenue') continue;

    const t1 = String(row[tier1Col] ?? '').trim();
    const t2 = String(row[tier2Col] ?? '').trim();
    if (!t1 && !t2) continue;

    const key = `${t1}||${t2}`;
    grouped.set(key, (grouped.get(key) ?? 0) + toNumber(row[amountCol]));
  }

  return Array.from(grouped.entries()).map(([key, revenue]) => {
    const [tier1, tier2] = key.split('||');
    return { tier1: tier1 ?? '', tier2: tier2 ?? '', revenue };
  });
}

/** Parse the "Fibertime Revenue" worksheet and return a single total */
function parseFibertimeSheet(values: unknown[][]): CostCentreRevenueItem | null {
  if (values.length < 2) return null;

  const headers = values[0] as unknown[];

  // Find any column with Revenue / Amount / Total in header
  let revenueCol = findCol(headers, 'revenue', 'amount', 'total');

  if (revenueCol >= 0) {
    let total = 0;
    for (let i = 1; i < values.length; i++) {
      const v = toNumber((values[i] as unknown[])[revenueCol]);
      if (v !== 0) total += v;
    }
    return { tier1: 'Fibertime', tier2: 'Fibertime', revenue: total };
  }

  // Fallback: sum ALL numeric values across all data rows
  let total = 0;
  for (let i = 1; i < values.length; i++) {
    const row = values[i] as unknown[];
    for (const cell of row) {
      const v = toNumber(cell);
      if (v !== 0) total += v;
    }
  }
  return { tier1: 'Fibertime', tier2: 'Fibertime', revenue: total };
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
    // Fetch both sheets in parallel; Fibertime failure is non-fatal
    const [dataResult, fibertimeResult] = await Promise.allSettled([
      getWorksheetRange('Data'),
      getWorksheetRange('Fibertime Revenue'),
    ]);

    if (dataResult.status === 'rejected') {
      throw new Error(`Data sheet fetch failed: ${String(dataResult.reason)}`);
    }

    const { values: dataValues } = dataResult.value;
    if (!dataValues || dataValues.length < 2) {
      throw new Error('Data sheet returned insufficient rows');
    }

    const items: CostCentreRevenueItem[] = parseDataSheet(dataValues);
    const sources = ['Data'];

    if (fibertimeResult.status === 'fulfilled') {
      const ft = parseFibertimeSheet(fibertimeResult.value.values);
      if (ft) {
        items.push(ft);
        sources.push('Fibertime Revenue');
      }
    } else {
      logger.warn('Fibertime Revenue sheet unavailable — continuing without it', {
        error: String(fibertimeResult.reason),
      });
    }

    // Sort: tier1 asc, then tier2 asc
    items.sort((a, b) => {
      const t1 = a.tier1.localeCompare(b.tier1);
      return t1 !== 0 ? t1 : a.tier2.localeCompare(b.tier2);
    });

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
