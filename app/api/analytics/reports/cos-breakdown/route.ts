/**
 * GET /api/analytics/reports/cos-breakdown
 *
 * Reads the "Cost of Sales" section from the Fin Summary worksheet and
 * returns a monthly pivot of COS sub-categories.
 *
 * Access restricted via RBAC (analytics.reports / view) or user allowlist.
 */

// 🟢 WORKING: COS Breakdown GET handler — reads live SharePoint data
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';
import { verifyToken } from '@/lib/auth/jwt';
import { userHasPermission } from '@/lib/permissions';
import { getWorksheetRange } from '@/lib/graph/sharepoint-excel';
import type { IncomeStatementData, IncomeStatementRow } from '@/modules/analytics/reports/income-statement/useIncomeStatementData';

const logger = createLogger('analytics:api:cos-breakdown');

const ALLOWED_USERS = new Set([
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', // Hein
  '7d84184b-2a2b-4fbb-a52e-9815d0e92237', // Lew
]);

function excelSerialToLabel(serial: number): string {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function toNumber(cell: unknown): number {
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'string') return parseFloat(cell.replace(/,/g, '')) || 0;
  return 0;
}

function toStr(cell: unknown): string {
  if (typeof cell === 'string') return cell.trim();
  if (cell == null) return '';
  return String(cell).trim();
}

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

  const hasAccess = await userHasPermission(userId, 'analytics.reports', 'view');
  if (!hasAccess && !ALLOWED_USERS.has(userId)) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Access restricted to authorised users' } },
      { status: 403 }
    );
  }

  logger.info('COS breakdown requested', { userId });

  try {
    const { values } = await getWorksheetRange('Fin Summary');

    if (!values || values.length < 2) {
      throw new Error('Fin Summary sheet returned insufficient data');
    }

    // Fin Summary layout (confirmed live 2026-03-26):
    // Col A (0) = empty, Col B (1) = label, Col C (2) = FY26, Col D (3) = FY27
    // Monthly date serials from col E (4) onwards in the header row
    // The "Cost of Sales" sub-section header is at row ~26 (0-based index 25)

    // Find the header row that contains month date serials (look for row with many numbers > 40000)
    let monthColumns: { col: number; label: string }[] = [];
    for (let i = 0; i < Math.min(10, values.length); i++) {
      const row = values[i] as unknown[];
      const candidate: { col: number; label: string }[] = [];
      for (let col = 4; col < row.length; col++) {
        const cell = row[col];
        if (typeof cell === 'number' && cell > 40_000) {
          candidate.push({ col, label: excelSerialToLabel(cell) });
        }
      }
      if (candidate.length > 6) { monthColumns = candidate; break; }
    }
    const months = monthColumns.map((m) => m.label);

    // Locate "Cost of Sales" section — labels are in col B (index 1)
    let cosStart = -1;
    for (let i = 0; i < values.length; i++) {
      const row = values[i] as unknown[];
      const label = toStr(row[1]); // col B
      if (label === 'Cost of Sales') {
        cosStart = i;
        break;
      }
    }

    if (cosStart < 0) {
      throw new Error('Could not locate "Cost of Sales" section in Fin Summary');
    }

    // Section header row
    const headerEntry: IncomeStatementRow = {
      label: 'Cost of Sales',
      fy26: 0, fy27: 0, fy28: 0,
      monthly: {},
      isHeader: true,
    };

    // Parse COS sub-rows — stop at blank label OR next major section header
    const STOP_LABELS = new Set([
      'Revenue', 'Cost Of Sales', 'Gross Profit/(Loss)', 'Income',
      'Operational Expenses', 'Operations Expenses', 'Net Profit/(Loss)',
      'Net Profit/(Loss) - Running', 'Cash In', 'Cash Out', 'Cash Movement',
      'Income Statement', 'Income Statememt', 'VAT',
    ]);

    const subRows: IncomeStatementRow[] = [];
    let foundData = false;

    for (let i = cosStart + 1; i < values.length; i++) {
      const row = values[i] as unknown[];
      const label = toStr(row[1]); // col B
      if (!label) {
        if (foundData) break; // blank row after data = end of section
        continue;
      }
      if (STOP_LABELS.has(label)) break;

      foundData = true;
      const fy26 = toNumber(row[2]); // col C
      const fy27 = toNumber(row[3]); // col D
      const fy28 = 0;
      const monthly: Record<string, number> = {};
      for (const { col, label: mLabel } of monthColumns) {
        monthly[mLabel] = toNumber(row[col]);
      }

      const isTotal = label.toLowerCase().startsWith('total');
      subRows.push({ label, fy26, fy27, fy28, monthly, isTotal, isIndented: !isTotal });
    }

    const rows: IncomeStatementRow[] = [headerEntry, ...subRows];
    const result: IncomeStatementData = { rows, months };

    logger.info('COS breakdown fetched', { userId, rowCount: rows.length });

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        generatedAt: new Date().toISOString(),
        sources: ['Fin Summary'],
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('COS breakdown fetch failed', { error: message });
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}
