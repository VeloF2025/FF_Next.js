/**
 * GET /api/analytics/reports/revenue-overview
 *
 * Returns monthly cashflow data (Cash In, Cash Out, Net) from the
 * Shareholder Model Excel file via Microsoft Graph / SharePoint.
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

const logger = createLogger('analytics:api:revenue-overview');

/** Allowlist — fallback guard independent of RBAC table */
const ALLOWED_USERS = new Set([
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', // Hein
  '7d84184b-2a2b-4fbb-a52e-9815d0e92237', // Lew
]);

/** A single monthly cashflow data point */
export interface CashflowDataPoint {
  label: string;
  cashIn: number;
  cashOut: number;
  net: number;
}

/**
 * Converts an Excel date serial to a short month label.
 * Excel epoch: 1900-01-00 (i.e. serial 1 = 1900-01-01).
 * We use the standard: new Date(Date.UTC(1899,11,30) + serial * 86400000).
 */
function excelSerialToLabel(serial: number): string {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function toNumber(cell: unknown): number {
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'string') return parseFloat(cell) || 0;
  return 0;
}

// 🟢 WORKING: Revenue overview GET handler — reads live SharePoint data
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

  // --- Authorisation: RBAC check + allowlist fallback ---
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

  logger.info('Revenue overview requested', { userId });

  try {
    const { values } = await getWorksheetRange('Financial Summary');

    if (!values || values.length < 2) {
      throw new Error('Financial Summary sheet returned insufficient data');
    }

    // Header row (index 1): ["Cashflow","FY 26","FY27","FY28", <date serials>...]
    const headerRow = values[1] as unknown[];

    // Collect monthly columns (index 4+) where header cell is a numeric date serial
    const monthColumns: { col: number; label: string }[] = [];
    for (let col = 4; col < headerRow.length; col++) {
      const cell = headerRow[col];
      if (typeof cell === 'number' && cell > 40_000) {
        monthColumns.push({ col, label: excelSerialToLabel(cell) });
      }
    }

    // Locate Cash In / Cash Out / Cash Movement rows by scanning column 0
    let cashInRow: unknown[] | null = null;
    let cashOutRow: unknown[] | null = null;
    let cashMovementRow: unknown[] | null = null;

    for (const row of values) {
      const typedRow = row as unknown[];
      const rowLabel = String(typedRow[0] ?? '').trim();
      if (rowLabel === 'Cash In') cashInRow = typedRow;
      else if (rowLabel === 'Cash Out') cashOutRow = typedRow;
      else if (rowLabel === 'Cash Movement') cashMovementRow = typedRow;
    }

    if (!cashInRow && !cashOutRow) {
      throw new Error('Could not locate Cash In / Cash Out rows in Financial Summary');
    }

    // cashOut: normalise to positive magnitude regardless of sign in Excel.
    // Some cells are stored negative (correct), some positive (data inconsistency).
    // Math.abs ensures the total always reflects true outflow — not a net of mixed signs.
    const data: CashflowDataPoint[] = monthColumns.map(({ col, label }) => ({
      label,
      cashIn: toNumber(cashInRow?.[col]),
      cashOut: Math.abs(toNumber(cashOutRow?.[col])),
      net: toNumber(cashMovementRow?.[col]),
    }));

    return NextResponse.json({
      success: true,
      data,
      meta: {
        currency: 'ZAR',
        generatedAt: new Date().toISOString(),
        monthCount: data.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Revenue overview fetch failed', { error: message });

    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}
