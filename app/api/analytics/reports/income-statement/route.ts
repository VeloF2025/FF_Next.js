/**
 * GET /api/analytics/reports/income-statement
 *
 * Reads the "Income Statememt" section from the Fin Summary worksheet
 * and returns a structured P&L with Revenue, COS sub-lines, Gross Profit,
 * Operational Expenses, and Net Profit by FY and month.
 *
 * Access restricted via RBAC (analytics.reports / view) or user allowlist.
 */

// 🟢 WORKING: Income Statement GET handler — reads live SharePoint data
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';
import { verifyToken } from '@/lib/auth/jwt';
import { userHasPermission } from '@/lib/permissions';
import { getWorksheetRange } from '@/lib/graph/sharepoint-excel';
import type { IncomeStatementRow, IncomeStatementData } from '@/modules/analytics/reports/income-statement/useIncomeStatementData';

const logger = createLogger('analytics:api:income-statement');

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

/** Parse FY columns (cols 1, 2, 3) from a data row */
function parseFY(row: unknown[]): { fy26: number; fy27: number; fy28: number } {
  return {
    fy26: toNumber(row[1]),
    fy27: toNumber(row[2]),
    fy28: toNumber(row[3]),
  };
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

  logger.info('Income statement requested', { userId });

  try {
    const { values } = await getWorksheetRange('Fin Summary');

    if (!values || values.length < 2) {
      throw new Error('Fin Summary sheet returned insufficient data');
    }

    // Header row (index 1): labels + FY cols + date serials from col 4
    const headerRow = values[1] as unknown[];
    const monthColumns: { col: number; label: string }[] = [];
    for (let col = 4; col < headerRow.length; col++) {
      const cell = headerRow[col];
      if (typeof cell === 'number' && cell > 40_000) {
        monthColumns.push({ col, label: excelSerialToLabel(cell) });
      }
    }
    const months = monthColumns.map((m) => m.label);

    // Scan all rows to locate "Income Statememt" section (note typo in sheet)
    // and "Cost of Sales" sub-section
    const IS_LABELS = new Set([
      'Revenue',
      'Cost Of Sales',
      'Gross Profit/(Loss)',
      'Operational Expenses',
      'Net Profit/(Loss)',
      'Net Profit/(Loss) - Running',
    ]);

    // Phase 1: find section start indices
    let incomeStatementStart = -1;
    let cosStart = -1;

    for (let i = 0; i < values.length; i++) {
      const row = values[i] as unknown[];
      const label = toStr(row[0]);
      if (label === 'Income Statememt' || label === 'Income Statement') {
        incomeStatementStart = i;
      }
      if (label === 'Cost of Sales' && incomeStatementStart > 0 && cosStart < 0) {
        cosStart = i;
      }
    }

    if (incomeStatementStart < 0) {
      throw new Error('Could not locate "Income Statememt" section in Fin Summary');
    }

    // Phase 2: collect Income Statement rows
    const incomeStatRows: IncomeStatementRow[] = [];
    // COS sub-lines between cosStart and next non-COS section
    const cosSubRows: IncomeStatementRow[] = [];
    let inCosSection = false;

    for (let i = incomeStatementStart + 1; i < values.length; i++) {
      const row = values[i] as unknown[];
      const label = toStr(row[0]);

      if (!label) continue; // skip blank rows within section

      // Detect end of income statement section (next major section header)
      if (label === 'Cash In/Out' || label === 'Cash In' || label === 'Cash Out') break;

      const { fy26, fy27, fy28 } = parseFY(row);
      const monthly: Record<string, number> = {};
      for (const { col, label: mLabel } of monthColumns) {
        monthly[mLabel] = toNumber(row[col]);
      }

      if (IS_LABELS.has(label)) {
        if (label === 'Cost Of Sales') {
          // Section header for COS — we'll inject COS sub-lines after this
          incomeStatRows.push({
            label: 'Cost of Sales',
            fy26, fy27, fy28, monthly,
            isHeader: true,
          });
          inCosSection = true;
          continue;
        }
        if (label === 'Gross Profit/(Loss)' || label === 'Operational Expenses' || label === 'Net Profit/(Loss)') {
          inCosSection = false;
        }
        incomeStatRows.push({
          label,
          fy26, fy27, fy28, monthly,
          isTotal: label === 'Gross Profit/(Loss)' || label === 'Net Profit/(Loss)',
          isBold: label === 'Revenue' || label === 'Operational Expenses',
        });
      }
    }

    // Phase 3: collect COS sub-lines
    if (cosStart > 0) {
      for (let i = cosStart + 1; i < values.length; i++) {
        const row = values[i] as unknown[];
        const label = toStr(row[0]);
        if (!label) continue;
        // Stop at next section or known totals
        if (IS_LABELS.has(label) || label === 'Cash In' || label === 'Cash Out') break;

        const { fy26, fy27, fy28 } = parseFY(row);
        const monthly: Record<string, number> = {};
        for (const { col, label: mLabel } of monthColumns) {
          monthly[mLabel] = toNumber(row[col]);
        }
        const isTotal = label.toLowerCase().startsWith('total');
        cosSubRows.push({
          label,
          fy26, fy27, fy28, monthly,
          isTotal,
          isIndented: !isTotal,
        });
      }
    }

    // Phase 4: splice COS sub-lines into result after the COS header
    const finalRows: IncomeStatementRow[] = [];
    for (const r of incomeStatRows) {
      finalRows.push(r);
      if (r.isHeader && r.label === 'Cost of Sales') {
        finalRows.push(...cosSubRows);
      }
    }

    const result: IncomeStatementData = { rows: finalRows, months };

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
    logger.error('Income statement fetch failed', { error: message });
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}
