/**
 * GET /api/analytics/reports/opex
 *
 * Returns Operational Expenses pivot from the "Data" worksheet.
 * Filter: Column D (OPEX/CAPEX, col index 3) == "OPEX"
 * Group by: Category (col 10)
 * Value: Amount Excl. VAT (col 6)
 * Month: Date-M serial (col 1)
 *
 * FY definitions:
 *   FY26 = Apr-2025 → Mar-2026 (actuals)
 *   FY27 = Apr-2026 → Mar-2027 (actuals when available)
 *   FY28 = Apr-2027 → Mar-2028 (actuals when available)
 *
 * Access restricted via RBAC (analytics.reports / view) or user allowlist.
 */

// 🟢 WORKING: OPEX GET handler — Data tab, col D == OPEX, FY26/27/28 + monthly actuals
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

function excelSerialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
}

function excelSerialToMonthKey(serial: number): string {
  const d = excelSerialToDate(serial);
  return `${d.getUTCFullYear()}-${MONTH_NAMES[d.getUTCMonth()]}`;
}

function monthKeySortValue(key: string): number {
  const [yearStr, monStr] = key.split('-');
  return parseInt(yearStr, 10) * 12 + MONTH_NAMES.indexOf(monStr);
}

/** Returns FY label for a date: FY26 = Apr-2025→Mar-2026, FY27 = Apr-2026→Mar-2027, etc. */
function getFY(serial: number): 'FY26' | 'FY27' | 'FY28' | null {
  const d = excelSerialToDate(serial);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0=Jan … 11=Dec
  // Financial year starts April (month 3)
  const fyYear = month >= 3 ? year + 1 : year; // Apr-2025→Mar-2026 = FY2026
  if (fyYear === 2026) return 'FY26';
  if (fyYear === 2027) return 'FY27';
  if (fyYear === 2028) return 'FY28';
  return null;
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
  fy28: number;
  monthly: Record<string, number>;
  grandTotal: number;
}

export interface OPEXData {
  rows: OPEXRow[];
  months: string[];
  grandTotals: { fy26: number; fy27: number; fy28: number; monthly: Record<string, number>; total: number };
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

    // category → { fy26, fy27, fy28, monthly: { monthKey → sum } }
    const accumulator = new Map<string, { fy26: number; fy27: number; fy28: number; monthly: Map<string, number> }>();
    const monthKeySet = new Set<string>();

    for (let i = 1; i < values.length; i++) {
      const row = values[i] as unknown[];
      if (toStr(row[3]) !== 'OPEX') continue;

      const dateMSerial = toNumber(row[1]);
      if (dateMSerial <= 0) continue;

      const monthKey = excelSerialToMonthKey(dateMSerial);
      const fy = getFY(dateMSerial);
      const category = toStr(row[10]) || '(Uncategorised)';
      const amount = toNumber(row[6]);

      monthKeySet.add(monthKey);

      if (!accumulator.has(category)) {
        accumulator.set(category, { fy26: 0, fy27: 0, fy28: 0, monthly: new Map() });
      }
      const entry = accumulator.get(category)!;
      if (fy === 'FY26') entry.fy26 += amount;
      else if (fy === 'FY27') entry.fy27 += amount;
      else if (fy === 'FY28') entry.fy28 += amount;
      entry.monthly.set(monthKey, (entry.monthly.get(monthKey) ?? 0) + amount);
    }

    const months = Array.from(monthKeySet).sort((a, b) => monthKeySortValue(a) - monthKeySortValue(b));

    const rows: OPEXRow[] = [];
    let gtFY26 = 0, gtFY27 = 0, gtFY28 = 0, gtTotal = 0;
    const gtMonthly: Record<string, number> = {};
    months.forEach((m) => (gtMonthly[m] = 0));

    for (const [category, entry] of accumulator) {
      const monthly: Record<string, number> = {};
      let rowTotal = 0;
      for (const m of months) {
        const val = entry.monthly.get(m) ?? 0;
        monthly[m] = val;
        rowTotal += val;
        gtMonthly[m] = (gtMonthly[m] ?? 0) + val;
      }
      gtFY26 += entry.fy26;
      gtFY27 += entry.fy27;
      gtFY28 += entry.fy28;
      gtTotal += rowTotal;
      rows.push({ category, fy26: entry.fy26, fy27: entry.fy27, fy28: entry.fy28, monthly, grandTotal: rowTotal });
    }

    rows.sort((a, b) => a.category.localeCompare(b.category));

    logger.info('OPEX data parsed', { categories: rows.length, months: months.length });

    const data: OPEXData = {
      rows, months,
      grandTotals: { fy26: gtFY26, fy27: gtFY27, fy28: gtFY28, monthly: gtMonthly, total: gtTotal },
    };
    return NextResponse.json({ success: true, data, meta: { generatedAt: new Date().toISOString(), sources: ['Data'] } });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('OPEX fetch failed', { error: message });
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, { status: 500 });
  }
}
