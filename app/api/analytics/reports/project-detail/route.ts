/**
 * GET /api/analytics/reports/project-detail
 *
 * Returns per-project COS sub-category breakdown and financial summary
 * sourced directly from the live Data tab and FT_Invoice tab.
 *
 * Data tab column map (row 0 = headers):
 *   Col 0:  Date serial (Excel)
 *   Col 2:  Type ("Income" / "Expense")
 *   Col 5:  Amount Excl. VAT
 *   Col 10: Category T2 (COS sub-category)
 *   Col 13: Split ("Included" or other)
 *   Col 15: Cost Centre T2 = project name ← slicer key
 *
 * FT_Invoice tab column map:
 *   Col 1:  Date_M serial (month grouping)
 *   Col 3:  Type filter — only "invoice" rows
 *   Col 6:  Project Name
 *   Col 9:  Debit (invoice amount)
 *
 * Query params:
 *   ?project=Mohadin  (defaults to "Mohadin")
 *
 * Access restricted to authorised users (Hein / Lew) or analytics.reports RBAC.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';
import { verifyToken } from '@/lib/auth/jwt';
import { userHasPermission } from '@/lib/permissions';
import { getWorksheetRange } from '@/lib/graph/sharepoint-excel';

const logger = createLogger('analytics:api:project-detail');

/** Allowlist — fallback guard independent of RBAC table */
const ALLOWED_USERS = new Set([
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', // Hein
  '7d84184b-2a2b-4fbb-a52e-9815d0e92237', // Lew
]);

/**
 * Projects that appear in Cost Centre T2 of the Data tab.
 * Non-project entries (BICT-US, OPEX, etc.) are excluded.
 */
const KNOWN_PROJECTS = [
  'Etwatwa POP 2',
  'Grabouw',
  'Ivory Park',
  'Kuruman',
  'Lawley',
  'Malmesbury',
  'Mamelodi POP 1',
  'Mohadin',
  'Steenvilla',
  'TBC',
  'Tembisa 3',
  'Themb\'elihle',
  'Thembisa POP 1 (P1/2)',
  'Thembisa POP 2 (P1/2)',
  'Thembisa POP 3 (P1/2)',
  'Tonga',
].sort();

/** All 8 standard COS sub-categories — shown even when zero for selected project */
const COS_CATEGORIES = [
  'COS - Ad Hoc',
  'COS - Casuals',
  'COS - Fuel',
  'COS - Overheads',
  'COS - Sales',
  'COS - Stock',
  'COS - Sub-Contractor',
  'COS - Wayleaves',
];

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Converts an Excel date serial to "MMM-YY" label.
 * Excel epoch: serial 1 = 1900-01-01, with Lotus-1-2-3 leap-year bug
 * handled by the UTC(1899, 11, 30) base.
 */
function serialToMonthLabel(serial: number): string {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  const mon = MONTH_NAMES[date.getUTCMonth()];
  const yr = String(date.getUTCFullYear()).slice(-2);
  return `${mon}-${yr}`;
}

/** Sort comparator value for "MMM-YY" month labels */
function monthLabelSortValue(label: string): number {
  const [monStr, yrStr] = label.split('-');
  const year = 2000 + parseInt(yrStr ?? '0', 10);
  const monIdx = MONTH_NAMES.indexOf(monStr ?? '');
  return year * 12 + monIdx;
}

function toNumber(cell: unknown): number {
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'string') {
    const parsed = parseFloat(cell.replace(/,/g, ''));
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function toStr(cell: unknown): string {
  if (typeof cell === 'string') return cell.trim();
  if (cell == null) return '';
  return String(cell).trim();
}

/** Monthly values with a total field */
interface MonthlyValues {
  total: number;
  monthly: Record<string, number>;
}

/** Full response payload for the Project Detail report */
interface ProjectDetailData {
  project: string;
  availableProjects: string[];
  months: string[];
  cosActual: Record<string, MonthlyValues>;
  cosTotal: MonthlyValues;
  summary: {
    activations: MonthlyValues;
    revenue: MonthlyValues;
    gross: MonthlyValues;
    net: MonthlyValues;
  };
}

/** Initialises a MonthlyValues with zero for all known months */
function emptyMonthly(months: string[]): MonthlyValues {
  return {
    total: 0,
    monthly: Object.fromEntries(months.map(m => [m, 0])),
  };
}

/** Accumulates a value into a MonthlyValues record (mutates in place) */
function accumulate(target: MonthlyValues, month: string, amount: number): void {
  target.monthly[month] = (target.monthly[month] ?? 0) + amount;
  target.total += amount;
}

// 🟢 WORKING: Project Detail GET handler — reads live SharePoint Data + FT_Invoice tabs
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
      { success: false, error: { code: 'FORBIDDEN', message: 'Access restricted to authorised users' } },
      { status: 403 }
    );
  }

  const projectName = req.nextUrl.searchParams.get('project') ?? 'Mohadin';

  if (!KNOWN_PROJECTS.includes(projectName)) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: `Unknown project: ${projectName}` } },
      { status: 404 }
    );
  }

  logger.info('Project Detail report requested', { userId, projectName });

  try {
    // Fetch both worksheets in parallel
    const [{ values: dataRows }, { values: invoiceRows }] = await Promise.all([
      getWorksheetRange('Data'),
      getWorksheetRange('FT_Invoice'),
    ]);

    if (!dataRows || dataRows.length < 2) {
      throw new Error('Data sheet returned insufficient data');
    }

    // -----------------------------------------------------------------------
    // Pass 1: Determine the full month span from Data tab for this project
    // -----------------------------------------------------------------------
    const monthSet = new Set<string>();

    for (let i = 1; i < dataRows.length; i++) {
      const row = dataRows[i] as unknown[];
      if (toStr(row[15]) !== projectName) continue;
      if (toStr(row[14]) !== 'Included') continue;
      if (toStr(row[2]) !== 'Expense') continue;
      const cat = toStr(row[10]);
      if (!cat.startsWith('COS')) continue;

      const serial = toNumber(row[0]);
      if (serial > 0) monthSet.add(serialToMonthLabel(serial));
    }

    // Also collect months from FT_Invoice for this project
    if (invoiceRows && invoiceRows.length > 1) {
      for (let i = 1; i < invoiceRows.length; i++) {
        const row = invoiceRows[i] as unknown[];
        if (toStr(row[6]) !== projectName) continue;
        if (toStr(row[3]) !== 'invoice') continue;
        const serial = toNumber(row[1]);
        if (serial > 0) monthSet.add(serialToMonthLabel(serial));
      }
    }

    const months = Array.from(monthSet).sort(
      (a, b) => monthLabelSortValue(a) - monthLabelSortValue(b)
    );

    if (months.length === 0) {
      // Return empty-but-valid payload rather than an error
      const emptyData: ProjectDetailData = {
        project: projectName,
        availableProjects: KNOWN_PROJECTS,
        months: [],
        cosActual: Object.fromEntries(COS_CATEGORIES.map(c => [c, emptyMonthly([])])),
        cosTotal: emptyMonthly([]),
        summary: {
          activations: emptyMonthly([]),
          revenue: emptyMonthly([]),
          gross: emptyMonthly([]),
          net: emptyMonthly([]),
        },
      };
      return NextResponse.json({ success: true, data: emptyData });
    }

    // -----------------------------------------------------------------------
    // Pass 2: Accumulate COS actuals from Data tab
    // -----------------------------------------------------------------------
    const cosActual: Record<string, MonthlyValues> = Object.fromEntries(
      COS_CATEGORIES.map(c => [c, emptyMonthly(months)])
    );
    const cosTotal = emptyMonthly(months);

    for (let i = 1; i < dataRows.length; i++) {
      const row = dataRows[i] as unknown[];
      if (toStr(row[15]) !== projectName) continue;
      if (toStr(row[14]) !== 'Included') continue;
      if (toStr(row[2]) !== 'Expense') continue;
      const cat = toStr(row[10]);
      if (!cat.startsWith('COS')) continue;

      const serial = toNumber(row[0]);
      if (serial <= 0) continue;
      const month = serialToMonthLabel(serial);

      const amount = toNumber(row[6]);

      // Use known category bucket or catch-all
      const bucket = COS_CATEGORIES.includes(cat) ? cat : (COS_CATEGORIES[0] ?? 'other');
      accumulate(cosActual[bucket], month, amount);
      accumulate(cosTotal, month, amount);
    }

    // -----------------------------------------------------------------------
    // Pass 3: Revenue + activation count from FT_Invoice tab
    // -----------------------------------------------------------------------
    const revenue = emptyMonthly(months);
    const activations = emptyMonthly(months);

    if (invoiceRows && invoiceRows.length > 1) {
      for (let i = 1; i < invoiceRows.length; i++) {
        const row = invoiceRows[i] as unknown[];
        if (toStr(row[6]) !== projectName) continue;
        if (toStr(row[3]) !== 'invoice') continue;

        const serial = toNumber(row[1]);
        if (serial <= 0) continue;
        const month = serialToMonthLabel(serial);

        const amount = toNumber(row[9]);
        accumulate(revenue, month, amount);
        // Count rows (activations) — increment by 1 not by amount
        accumulate(activations, month, 1);
      }
    }

    // -----------------------------------------------------------------------
    // Pass 4: Compute Gross = Revenue - COS per month
    // -----------------------------------------------------------------------
    const gross = emptyMonthly(months);
    for (const month of months) {
      const val = (revenue.monthly[month] ?? 0) - (cosTotal.monthly[month] ?? 0);
      gross.monthly[month] = val;
      gross.total += val;
    }

    // Net = Gross (no further deductions at this data level)
    const net: MonthlyValues = {
      total: gross.total,
      monthly: { ...gross.monthly },
    };

    const data: ProjectDetailData = {
      project: projectName,
      availableProjects: KNOWN_PROJECTS,
      months,
      cosActual,
      cosTotal,
      summary: { activations, revenue, gross, net },
    };

    logger.info('Project Detail data assembled', {
      projectName,
      months: months.length,
      cosTotal: cosTotal.total,
      revenueTotal: revenue.total,
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Project Detail fetch failed', { error: message });

    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}
