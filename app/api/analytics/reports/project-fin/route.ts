/**
 * GET /api/analytics/reports/project-fin
 *
 * Returns Project COS, Revenue, and Net data from the Shareholder Model
 * "Project_Fin" worksheet via SharePoint Graph API.
 *
 * Sheet structure:
 *   Row 1: Title row
 *   Row 2: "Project COS" section header with date serials in cols 3+
 *   Rows 3-N: Project COS data rows [name, scope, actual, ...monthly]
 *   Then: "Project Revenue" section header row
 *   Then: Project Revenue data rows
 *   Then: "Project Net" section header row
 *   Then: Project Net data rows
 *
 * Access restricted to authorised users via RBAC or direct allowlist.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';
import { verifyToken } from '@/lib/auth/jwt';
import { userHasPermission } from '@/lib/permissions';
import { getWorksheetRange } from '@/lib/graph/sharepoint-excel';

const logger = createLogger('analytics:api:project-fin');

/** Allowlist — fallback guard independent of RBAC table */
const ALLOWED_USERS = new Set([
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', // Hein
  '7d84184b-2a2b-4fbb-a52e-9815d0e92237', // Lew
]);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Converts an Excel date serial to "MMM-YY" label (e.g. 45717 → "Mar-25").
 * Excel epoch: serial 1 = 1900-01-01, adjusted for Lotus 1900 bug.
 */
function serialToMonthLabel(serial: number): string {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  const mon = MONTH_NAMES[date.getUTCMonth()];
  const yr = String(date.getUTCFullYear()).slice(-2);
  return `${mon}-${yr}`;
}

/** Returns the numeric sort key for a "MMM-YY" label for chronological ordering. */
function monthLabelSortKey(label: string): number {
  const parts = label.split('-');
  const mon = parts[0] ?? '';
  const yrStr = parts[1] ?? '0';
  const year = parseInt(yrStr, 10) + (parseInt(yrStr, 10) < 50 ? 2000 : 1900);
  const monIdx = MONTH_NAMES.indexOf(mon);
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

function toString(cell: unknown): string {
  if (typeof cell === 'string') return cell.trim();
  if (cell == null) return '';
  return String(cell).trim();
}

/** Per-project financial data keyed by month label */
interface ProjectMonthlyData {
  actual: number;
  [monthLabel: string]: number;
}

/** Full section data: projectName → monthly values */
type SectionData = Record<string, ProjectMonthlyData>;

/** Totals row for a section */
interface SectionTotals {
  actual: number;
  [monthLabel: string]: number;
}

/** Complete response payload */
interface ProjectFinData {
  months: string[];
  projects: string[];
  cos: SectionData;
  revenue: SectionData;
  net: SectionData;
  totals: {
    cos: SectionTotals;
    revenue: SectionTotals;
    net: SectionTotals;
  };
}

/** Section keys we scan for in column 0 of the sheet */
const SECTION_HEADERS = ['Project COS', 'Project Revenue', 'Project Net'] as const;
type SectionKey = (typeof SECTION_HEADERS)[number];

/**
 * Parses a section of data rows from the sheet.
 * Starts at `startIndex` (first data row after the section header).
 * Stops when it hits another section header or end of rows.
 * Returns the project entries and the index of the next section header.
 */
function parseSection(
  rows: unknown[][],
  startIndex: number,
  monthSerials: number[],
  currentMonthSerial: number
): { entries: Map<string, ProjectMonthlyData>; nextSectionIndex: number } {
  const entries = new Map<string, ProjectMonthlyData>();
  let i = startIndex;

  while (i < rows.length) {
    const row = rows[i] as unknown[];
    const col0 = toString(row[0]);

    // Stop if we hit another section header
    if (SECTION_HEADERS.some(h => col0 === h)) break;

    // Skip blank or separator rows
    if (col0) {
      const projectName = col0;
      const actual = toNumber(row[2]);
      const monthly: ProjectMonthlyData = { actual };

      for (let c = 0; c < monthSerials.length; c++) {
        if (monthSerials[c]! <= currentMonthSerial) {
          const label = serialToMonthLabel(monthSerials[c] ?? 0);
          // cols 3+ correspond to month index c
          monthly[label] = toNumber(row[3 + c]);
        }
      }

      entries.set(projectName, monthly);
    }

    i++;
  }

  return { entries, nextSectionIndex: i };
}

/**
 * Computes totals across all projects for a section.
 */
function computeSectionTotals(
  entries: Map<string, ProjectMonthlyData>,
  months: string[]
): SectionTotals {
  const totals: SectionTotals = { actual: 0 };
  for (const mon of months) totals[mon] = 0;

  for (const data of entries.values()) {
    totals.actual += data.actual;
    for (const mon of months) {
      totals[mon] = (totals[mon] ?? 0) + (data[mon] ?? 0);
    }
  }

  return totals;
}

// 🟢 WORKING: Project Fin GET handler — reads live SharePoint Project_Fin worksheet
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

  // --- Authorisation ---
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

  logger.info('Project Fin report requested', { userId });

  try {
    const { values } = await getWorksheetRange('Project_Fin');

    if (!values || values.length < 3) {
      throw new Error('Project_Fin sheet returned insufficient data');
    }

    // Row 0 (index 0): title row — skip
    // Row 1 (index 1): first section header "Project COS" with date serials in cols 3+
    const headerRow = values[1] as unknown[];

    // Extract date serials from cols 3+ (stop at empty/non-numeric)
    const monthSerials: number[] = [];
    for (let c = 3; c < headerRow.length; c++) {
      const serial = toNumber(headerRow[c]);
      if (serial > 40000) {
        // Valid Excel date serial (reasonable range for 2010–2040)
        monthSerials.push(serial);
      }
    }

    if (monthSerials.length === 0) {
      throw new Error('No date serials found in Project_Fin header row');
    }

    // Determine current month serial — cut off future forecast columns
    const now = new Date();
    // End-of-current-month serial: first day of next month minus 1 day
    const currentMonthEndSerial =
      (new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getTime() -
        new Date(Date.UTC(1899, 11, 30)).getTime()) /
      86400000;

    // Build label list for months up to current (sorted)
    const validMonthSerials = monthSerials.filter(s => s <= currentMonthEndSerial);
    const months = validMonthSerials
      .map(s => serialToMonthLabel(s))
      // Deduplicate (two serials could map to the same label in edge cases)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => monthLabelSortKey(a) - monthLabelSortKey(b));

    // --- Parse 3 sections ---
    // Find section header rows by scanning col 0
    let cosStartIndex = -1;
    let revStartIndex = -1;
    let netStartIndex = -1;

    for (let i = 0; i < values.length; i++) {
      const row = values[i] as unknown[];
      const col0 = toString(row[0]);
      if (col0 === 'Project COS' && cosStartIndex === -1) cosStartIndex = i + 1;
      else if (col0 === 'Project Revenue' && revStartIndex === -1) revStartIndex = i + 1;
      else if (col0 === 'Project Net' && netStartIndex === -1) netStartIndex = i + 1;
    }

    if (cosStartIndex === -1 || revStartIndex === -1 || netStartIndex === -1) {
      throw new Error(
        'Could not locate one or more section headers in Project_Fin (COS/Revenue/Net)'
      );
    }

    const { entries: cosEntries } = parseSection(
      values as unknown[][],
      cosStartIndex,
      monthSerials,
      currentMonthEndSerial
    );
    const { entries: revEntries } = parseSection(
      values as unknown[][],
      revStartIndex,
      monthSerials,
      currentMonthEndSerial
    );
    const { entries: netEntries } = parseSection(
      values as unknown[][],
      netStartIndex,
      monthSerials,
      currentMonthEndSerial
    );

    // Collect unique project names (preserve order from COS section as primary)
    const projectSet = new Set<string>([
      ...cosEntries.keys(),
      ...revEntries.keys(),
      ...netEntries.keys(),
    ]);
    const projects = Array.from(projectSet);

    const cos: SectionData = Object.fromEntries(cosEntries);
    const revenue: SectionData = Object.fromEntries(revEntries);
    const net: SectionData = Object.fromEntries(netEntries);

    const data: ProjectFinData = {
      months,
      projects,
      cos,
      revenue,
      net,
      totals: {
        cos: computeSectionTotals(cosEntries, months),
        revenue: computeSectionTotals(revEntries, months),
        net: computeSectionTotals(netEntries, months),
      },
    };

    logger.info('Project Fin data parsed', {
      projects: projects.length,
      months: months.length,
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Project Fin fetch failed', { error: message });

    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}
