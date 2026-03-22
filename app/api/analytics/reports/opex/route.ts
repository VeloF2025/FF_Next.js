/**
 * GET /api/analytics/reports/opex
 *
 * Returns Operational Expenses pivot from the "OPEX" worksheet only.
 * No type toggle — OPEX tab contains only operational expense categories.
 *
 * Sheet structure:
 *   Row 0 (header): "Operations Expenses" | "FY 26" | "FY 27" | "FY28" | <date serials col 4+>
 *   Rows 1+: category name | FY26 | FY27 | FY28 | monthly values...
 *   Last row: "Total"
 *
 * Access restricted via RBAC (analytics.reports / view) or user allowlist.
 */

// 🟢 WORKING: OPEX GET handler — reads live SharePoint OPEX worksheet
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';
import { verifyToken } from '@/lib/auth/jwt';
import { userHasPermission } from '@/lib/permissions';
import { getWorksheetRange } from '@/lib/graph/sharepoint-excel';

const logger = createLogger('analytics:api:opex');

const ALLOWED_USERS = new Set([
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', // Hein
  '7d84184b-2a2b-4fbb-a52e-9815d0e92237', // Lew
]);

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function excelSerialToMonthKey(serial: number): string {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return `${date.getUTCFullYear()}-${MONTH_NAMES[date.getUTCMonth()]}`;
}

function monthKeySortValue(key: string): number {
  const [yearStr, monStr] = key.split('-');
  return parseInt(yearStr, 10) * 12 + MONTH_NAMES.indexOf(monStr);
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

export interface OPEXRow {
  category: string;
  fy26: number;
  fy27: number;
  monthly: Record<string, number>;
  grandTotal: number;
  isTotal?: boolean;
}

export interface OPEXData {
  rows: OPEXRow[];
  months: string[];
  grandTotals: { fy26: number; fy27: number; monthly: Record<string, number>; total: number };
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get('ff_auth_token')?.value;
  if (!token) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload?.sub) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }, { status: 401 });

  const userId = payload.sub;
  const hasAccess = await userHasPermission(userId, 'analytics.reports', 'view');
  if (!hasAccess && !ALLOWED_USERS.has(userId)) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'Access restricted' } }, { status: 403 });
  }

  logger.info('OPEX report requested', { userId });

  try {
    const { values } = await getWorksheetRange('OPEX');
    if (!values || values.length < 2) throw new Error('OPEX sheet returned insufficient data');

    // Header row (index 0): col 0 = title, col 1 = FY26, col 2 = FY27, col 3 = FY28, col 4+ = date serials
    const headerRow = values[0] as unknown[];
    const monthColumns: { col: number; key: string }[] = [];
    for (let col = 4; col < headerRow.length; col++) {
      const cell = headerRow[col];
      if (typeof cell === 'number' && cell > 40_000) {
        monthColumns.push({ col, key: excelSerialToMonthKey(cell) });
      }
    }

    const monthKeySet = new Set(monthColumns.map((m) => m.key));
    const months = Array.from(monthKeySet).sort((a, b) => monthKeySortValue(a) - monthKeySortValue(b));

    const rows: OPEXRow[] = [];
    const gtMonthly: Record<string, number> = {};
    months.forEach((m) => (gtMonthly[m] = 0));
    let gtFY26 = 0, gtFY27 = 0, gtTotal = 0;

    for (let i = 1; i < values.length; i++) {
      const row = values[i] as unknown[];
      const category = toStr(row[0]);
      if (!category) continue;

      const fy26 = toNumber(row[1]);
      const fy27 = toNumber(row[2]);
      const monthly: Record<string, number> = {};
      let rowTotal = 0;

      for (const { col, key } of monthColumns) {
        const val = toNumber(row[col]);
        monthly[key] = (monthly[key] ?? 0) + val;
        rowTotal += val;
      }

      const isTotal = category.toLowerCase() === 'total';
      rows.push({ category: isTotal ? 'Total' : category, fy26, fy27, monthly, grandTotal: rowTotal, isTotal });

      if (!isTotal) {
        gtFY26 += fy26;
        gtFY27 += fy27;
        gtTotal += rowTotal;
        for (const m of months) gtMonthly[m] = (gtMonthly[m] ?? 0) + (monthly[m] ?? 0);
      }
    }

    const data: OPEXData = {
      rows,
      months,
      grandTotals: { fy26: gtFY26, fy27: gtFY27, monthly: gtMonthly, total: gtTotal },
    };

    return NextResponse.json({ success: true, data, meta: { generatedAt: new Date().toISOString(), sources: ['OPEX'] } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('OPEX fetch failed', { error: message });
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, { status: 500 });
  }
}
