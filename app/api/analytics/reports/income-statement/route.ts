/**
 * GET /api/analytics/reports/income-statement
 *
 * Returns a structured P&L from the "Fin Summary" worksheet.
 *
 * Sheet structure (confirmed 2026-03-22):
 *   Row 2  (idx):  Header row — FY26, FY27, FY28 labels + date serials from col 4
 *   Row 14: "Income Statememt" (section marker — typo in sheet)
 *   Row 15: Revenue
 *   Row 16: Cost Of Sales          ← summary (not sub-lines)
 *   Row 17: Gross Profit/(Loss)
 *   Row 19: Operational Expenses
 *   Row 20: Net Profit/(Loss)
 *   Row 24: "Cost of Sales"        ← sub-lines section
 *   Rows 25-32: COS - Ad Hoc … COS - Wayleaves
 *   Row 33: Total (COS total)
 *
 * We build the P&L in order:
 *   Revenue → [COS header] → [COS sub-lines] → [COS Total] → Gross Profit → Operational Expenses → Net Profit
 *
 * Access restricted via RBAC (analytics.reports / view) or user allowlist.
 */

// 🟢 WORKING: Income Statement GET handler — fixed row-based parser
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

/** Row indices in the Fin Summary sheet (0-based) — confirmed from live workbook */
const ROW = {
  HEADER: 2,          // FY labels + date serials
  REVENUE: 15,
  COS_SUMMARY: 16,    // "Cost Of Sales" — FY summary line
  GROSS_PROFIT: 17,
  OP_EXPENSES: 19,
  NET_PROFIT: 20,
  COS_HEADER: 24,     // "Cost of Sales" sub-section header
  COS_FIRST: 25,      // First COS sub-line
  COS_TOTAL: 33,      // "Total" COS line
} as const;

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

function buildRow(
  values: unknown[][],
  rowIdx: number,
  monthColumns: { col: number; label: string }[],
  opts: Partial<IncomeStatementRow> = {}
): IncomeStatementRow {
  const row = (values[rowIdx] ?? []) as unknown[];
  const label = toStr(row[0]) || opts.label || '';
  const monthly: Record<string, number> = {};
  for (const { col, label: mLabel } of monthColumns) {
    monthly[mLabel] = toNumber(row[col]);
  }
  return {
    label,
    fy26: toNumber(row[1]),
    fy27: toNumber(row[2]),
    fy28: toNumber(row[3]),
    monthly,
    ...opts,
  };
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get('ff_auth_token')?.value;
  if (!token) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, { status: 401 });
  }
  const payload = await verifyToken(token);
  if (!payload?.sub) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }, { status: 401 });
  }
  const userId = payload.sub;
  const hasAccess = await userHasPermission(userId, 'analytics.reports', 'view');
  if (!hasAccess && !ALLOWED_USERS.has(userId)) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'Access restricted' } }, { status: 403 });
  }

  logger.info('Income statement requested', { userId });

  try {
    const { values } = await getWorksheetRange('Fin Summary');
    if (!values || values.length < ROW.COS_TOTAL + 1) {
      throw new Error('Fin Summary sheet returned insufficient data');
    }

    // Extract month columns from header row (col 4+ numeric serials)
    const headerRow = (values[ROW.HEADER] ?? []) as unknown[];
    const monthColumns: { col: number; label: string }[] = [];
    for (let col = 4; col < headerRow.length; col++) {
      const cell = headerRow[col];
      if (typeof cell === 'number' && cell > 40_000) {
        monthColumns.push({ col, label: excelSerialToLabel(cell) });
      }
    }
    const months = monthColumns.map((m) => m.label);

    // Build rows in P&L order
    const rows: IncomeStatementRow[] = [
      // 1. Revenue
      buildRow(values, ROW.REVENUE, monthColumns, { isBold: true }),

      // 2. Cost of Sales — section header
      buildRow(values, ROW.COS_HEADER, monthColumns, { isHeader: true, label: 'Cost of Sales' }),

      // 3. COS sub-lines (rows 25–32)
      ...Array.from({ length: ROW.COS_TOTAL - ROW.COS_FIRST }, (_, i) =>
        buildRow(values, ROW.COS_FIRST + i, monthColumns, { isIndented: true })
      ),

      // 4. COS Total
      buildRow(values, ROW.COS_TOTAL, monthColumns, { isTotal: true, label: 'Total COS' }),

      // 5. Gross Profit/(Loss)
      buildRow(values, ROW.GROSS_PROFIT, monthColumns, { isTotal: true }),

      // 6. Operational Expenses
      buildRow(values, ROW.OP_EXPENSES, monthColumns, { isBold: true }),

      // 7. Net Profit/(Loss)
      buildRow(values, ROW.NET_PROFIT, monthColumns, { isTotal: true }),
    ];

    logger.info('Income statement built', { rowCount: rows.length, monthCount: months.length });

    const result: IncomeStatementData = { rows, months };
    return NextResponse.json({ success: true, data: result, meta: { generatedAt: new Date().toISOString(), sources: ['Fin Summary'] } });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Income statement fetch failed', { error: message });
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, { status: 500 });
  }
}
