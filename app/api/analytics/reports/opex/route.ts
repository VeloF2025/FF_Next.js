/**
 * GET /api/analytics/reports/opex
 *
 * Returns Operational Expenses pivot from the "Data" worksheet.
 * Filter: Column D (OPEX/CAPEX, col index 3) == "OPEX"
 * Group by: Category (col 10)
 * Value: Amount Excl. VAT (col 6)
 * Month: Date-M serial (col 1)
 *
 * Access restricted via RBAC (analytics.reports / view) or user allowlist.
 */

// 🟢 WORKING: OPEX GET handler — reads Data tab, filters col 3 == "OPEX"
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
  monthly: Record<string, number>;
  grandTotal: number;
  isTotal?: boolean;
}

export interface OPEXData {
  rows: OPEXRow[];
  months: string[];
  grandTotals: { monthly: Record<string, number>; total: number };
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
    const { values } = await getWorksheetRange('Data');
    if (!values || values.length < 2) throw new Error('Data sheet returned insufficient data');

    // Data tab columns (confirmed from live workbook):
    // col 1  = Date-M (Excel serial)
    // col 3  = OPEX/CAPEX — filter == "OPEX"
    // col 6  = Amount Excl. VAT
    // col 10 = Category

    const accumulator = new Map<string, Map<string, number>>(); // category → monthKey → sum
    const monthKeySet = new Set<string>();

    for (let i = 1; i < values.length; i++) {
      const row = values[i] as unknown[];

      // Filter: OPEX/CAPEX column must equal "OPEX"
      if (toStr(row[3]) !== 'OPEX') continue;

      const dateMSerial = toNumber(row[1]);
      if (dateMSerial <= 0) continue;
      const monthKey = excelSerialToMonthKey(dateMSerial);

      const category = toStr(row[10]) || '(Uncategorised)';
      const amount = toNumber(row[6]);

      monthKeySet.add(monthKey);
      if (!accumulator.has(category)) accumulator.set(category, new Map());
      const catMap = accumulator.get(category)!;
      catMap.set(monthKey, (catMap.get(monthKey) ?? 0) + amount);
    }

    const months = Array.from(monthKeySet).sort((a, b) => monthKeySortValue(a) - monthKeySortValue(b));

    const rows: OPEXRow[] = [];
    const gtMonthly: Record<string, number> = {};
    months.forEach((m) => (gtMonthly[m] = 0));
    let gtTotal = 0;

    for (const [category, catMap] of accumulator) {
      const monthly: Record<string, number> = {};
      let rowTotal = 0;
      for (const m of months) {
        const val = catMap.get(m) ?? 0;
        monthly[m] = val;
        rowTotal += val;
        gtMonthly[m] = (gtMonthly[m] ?? 0) + val;
      }
      gtTotal += rowTotal;
      rows.push({ category, monthly, grandTotal: rowTotal });
    }

    // Sort by category name
    rows.sort((a, b) => a.category.localeCompare(b.category));

    logger.info('OPEX data parsed', { categories: rows.length, months: months.length });

    const data: OPEXData = { rows, months, grandTotals: { monthly: gtMonthly, total: gtTotal } };
    return NextResponse.json({ success: true, data, meta: { generatedAt: new Date().toISOString(), sources: ['Data'] } });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('OPEX fetch failed', { error: message });
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, { status: 500 });
  }
}
