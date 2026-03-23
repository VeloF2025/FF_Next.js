/**
 * GET /api/analytics/reports/revenue-overview
 *
 * Returns cashflow data (Cash In, Cash Out, Cash Movement, Closing Balance)
 * from the Shareholder Model Excel file via Microsoft Graph / SharePoint.
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

export interface CashflowRow {
  label: string;
  fy26: number;
  fy27: number;
  fy28: number;
  monthly: Record<string, number>;
  isBold?: boolean;
}

export interface CashflowData {
  rows: CashflowRow[];
  months: string[];
  meta: { generatedAt: string; sources: string[] };
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

const ROW_LABELS: { label: string; isBold: boolean }[] = [
  { label: 'Cash In', isBold: false },
  { label: 'Cash Out', isBold: false },
  { label: 'Cash Movement', isBold: true },
  { label: 'Closing Balance', isBold: true },
];

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
    const { values } = await getWorksheetRange('Fin Summary');

    if (!values || values.length < 4) {
      throw new Error('Financial Summary sheet returned insufficient data');
    }

    // Header row is index 2: ["Cash In/Out","FY 26","FY 27","FY28", <date serials col 4+>]
    const headerRow = values[2] as unknown[];

    // Collect monthly columns (index 4+) where header cell is a numeric date serial > 40000
    const monthColumns: { col: number; label: string }[] = [];
    for (let col = 4; col < headerRow.length; col++) {
      const cell = headerRow[col];
      if (typeof cell === 'number' && cell > 40_000) {
        monthColumns.push({ col, label: excelSerialToLabel(cell) });
      }
    }

    const months = monthColumns.map((m) => m.label);

    // Build a map from label → row data by scanning col 0
    const rowMap = new Map<string, unknown[]>();
    for (const row of values) {
      const typedRow = row as unknown[];
      const rowLabel = String(typedRow[0] ?? '').trim();
      if (ROW_LABELS.some((r) => r.label === rowLabel)) {
        rowMap.set(rowLabel, typedRow);
      }
    }

    const rows: CashflowRow[] = ROW_LABELS.map(({ label, isBold }) => {
      const rowData = rowMap.get(label);
      const monthly: Record<string, number> = {};
      for (const { col, label: monthLabel } of monthColumns) {
        monthly[monthLabel] = toNumber(rowData?.[col]);
      }
      return {
        label,
        fy26: toNumber(rowData?.[1]),
        fy27: toNumber(rowData?.[2]),
        fy28: toNumber(rowData?.[3]),
        monthly,
        isBold,
      };
    });

    const result: CashflowData = {
      rows,
      months,
      meta: {
        generatedAt: new Date().toISOString(),
        sources: ['Fin Summary'],
      },
    };

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Revenue overview fetch failed', { error: message });

    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}
