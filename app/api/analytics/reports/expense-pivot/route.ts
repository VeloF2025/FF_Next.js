/**
 * GET /api/analytics/reports/expense-pivot
 *
 * Returns pivot data: Category T2 rows × month columns, Amount Excl. VAT sums.
 * Query params: ?type=Expense (default) | Income | All
 * Filter: only rows where Split (col 14) === "Included"
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

const logger = createLogger('analytics:api:expense-pivot');

/** Allowlist — fallback guard independent of RBAC table */
const ALLOWED_USERS = new Set([
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', // Hein
  '7d84184b-2a2b-4fbb-a52e-9815d0e92237', // Lew
]);

/** Valid filter type values */
type PivotType = 'Expense' | 'Income' | 'All';

/** Month names indexed 0-11 */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Converts an Excel date serial (Date-M column) to "YYYY-MMM" key.
 * Excel epoch: serial 1 = 1900-01-01.
 */
function excelSerialToMonthKey(serial: number): string {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  const year = date.getUTCFullYear();
  const mon = MONTH_NAMES[date.getUTCMonth()];
  return `${year}-${mon}`;
}

/**
 * Sorts month keys like "2025-Apr", "2026-Jan" chronologically.
 * Parses year and month index for comparison.
 */
function monthKeySortValue(key: string): number {
  const [yearStr, monStr] = key.split('-');
  const year = parseInt(yearStr, 10);
  const monIdx = MONTH_NAMES.indexOf(monStr);
  return year * 12 + monIdx;
}

function toNumber(cell: unknown): number {
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'string') return parseFloat(cell) || 0;
  return 0;
}

function toString(cell: unknown): string {
  if (typeof cell === 'string') return cell.trim();
  if (cell == null) return '';
  return String(cell).trim();
}

/** Row in the pivot output */
interface PivotRow {
  category: string;
  monthly: Record<string, number>;
  yearTotals: Record<string, number>;
  grandTotal: number;
}

/** Full pivot response data shape */
interface PivotData {
  months: string[];
  yearGroups: Record<string, string[]>;
  rows: PivotRow[];
  grandTotals: {
    monthly: Record<string, number>;
    yearTotals: Record<string, number>;
    grandTotal: number;
  };
}

// 🟢 WORKING: Expense pivot GET handler — reads live SharePoint Data worksheet
export async function GET(req: NextRequest): Promise<NextResponse> {
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

  // --- Parse query param ---
  const rawType = req.nextUrl.searchParams.get('type') ?? 'Expense';
  const typeFilter: PivotType =
    rawType === 'Income' ? 'Income' : rawType === 'All' ? 'All' : 'Expense';

  logger.info('Expense pivot requested', { userId, typeFilter });

  try {
    const { values } = await getWorksheetRange('Data');

    if (!values || values.length < 2) {
      throw new Error('Data sheet returned insufficient data');
    }

    // Accumulator: categoryT2 → monthKey → sum
    const accumulator = new Map<string, Map<string, number>>();
    const monthKeySet = new Set<string>();

    // Skip header row (index 0); iterate from index 1
    for (let i = 1; i < values.length; i++) {
      const row = values[i] as unknown[];

      // Skip if Split (col 14) !== "Included"
      if (toString(row[14]) !== 'Included') continue;

      // Apply type filter
      const rowType = toString(row[2]);
      if (typeFilter === 'Expense' && rowType !== 'Expense') continue;
      if (typeFilter === 'Income' && rowType !== 'Income') continue;
      // typeFilter === 'All' passes everything

      // Get Date-M serial (col 1)
      const dateMSerial = toNumber(row[1]);
      if (dateMSerial <= 0) continue;
      const monthKey = excelSerialToMonthKey(dateMSerial);

      // Get Category T2 (col 10)
      const categoryT2 = toString(row[10]) || '(Uncategorised)';

      // Get Amount Excl. VAT (col 6)
      const amount = toNumber(row[6]);

      // Accumulate
      monthKeySet.add(monthKey);
      if (!accumulator.has(categoryT2)) {
        accumulator.set(categoryT2, new Map());
      }
      const catMap = accumulator.get(categoryT2)!;
      catMap.set(monthKey, (catMap.get(monthKey) ?? 0) + amount);
    }

    // Sort months chronologically
    const months = Array.from(monthKeySet).sort(
      (a, b) => monthKeySortValue(a) - monthKeySortValue(b)
    );

    // Build yearGroups
    const yearGroupsMap = new Map<string, string[]>();
    for (const mk of months) {
      const year = mk.split('-')[0];
      if (!yearGroupsMap.has(year)) yearGroupsMap.set(year, []);
      yearGroupsMap.get(year)!.push(mk);
    }
    const yearGroups: Record<string, string[]> = Object.fromEntries(yearGroupsMap);
    const years = Array.from(yearGroupsMap.keys()).sort();

    // Build rows with full monthly fill-in
    const rows: PivotRow[] = [];
    for (const [category, catMap] of accumulator) {
      const monthly: Record<string, number> = {};
      const yearTotals: Record<string, number> = {};
      let grandTotal = 0;

      for (const mk of months) {
        const val = catMap.get(mk) ?? 0;
        monthly[mk] = val;
        const year = mk.split('-')[0];
        yearTotals[year] = (yearTotals[year] ?? 0) + val;
        grandTotal += val;
      }

      // Ensure all years have an entry even if zero
      for (const yr of years) {
        if (!(yr in yearTotals)) yearTotals[yr] = 0;
      }

      rows.push({ category, monthly, yearTotals, grandTotal });
    }

    // Sort by grandTotal descending
    rows.sort((a, b) => a.category.localeCompare(b.category));

    // Build grand totals row
    const gtMonthly: Record<string, number> = {};
    const gtYearTotals: Record<string, number> = {};
    let gtGrandTotal = 0;

    for (const mk of months) {
      gtMonthly[mk] = rows.reduce((sum, r) => sum + (r.monthly[mk] ?? 0), 0);
      const year = mk.split('-')[0];
      gtYearTotals[year] = (gtYearTotals[year] ?? 0) + gtMonthly[mk];
      gtGrandTotal += gtMonthly[mk];
    }
    for (const yr of years) {
      if (!(yr in gtYearTotals)) gtYearTotals[yr] = 0;
    }

    const data: PivotData = {
      months,
      yearGroups,
      rows,
      grandTotals: { monthly: gtMonthly, yearTotals: gtYearTotals, grandTotal: gtGrandTotal },
    };

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Expense pivot fetch failed', { error: message });

    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}
