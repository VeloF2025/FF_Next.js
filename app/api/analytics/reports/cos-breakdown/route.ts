/**
 * GET /api/analytics/reports/cos-breakdown
 *
 * COS Breakdown — pivot of Expenses by Category from the Data tab.
 * Source: Data worksheet, Type=Expense
 * Groups by Category (col 10), pivots by Date-M serial (col 1).
 * FY26 = Apr 2025 – Mar 2026 | FY27 = Apr 2026 – Mar 2027
 *
 * 🟢 WORKING
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';
import { verifyToken } from '@/lib/auth/jwt';
import { userHasPermission } from '@/lib/permissions';
import { getWorksheetRange } from '@/lib/graph/sharepoint-excel';

const logger = createLogger('analytics:api:cos-breakdown');

const ALLOWED_USERS = new Set([
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', // Hein
  '7d84184b-2a2b-4fbb-a52e-9815d0e92237', // Lew
]);

export interface CosBreakdownRow {
  category: string;
  fy26: number;
  fy27: number;
  monthly: Record<string, number>; // key: "Jul '25"
  isTotal?: boolean;
}

export interface CosBreakdownData {
  rows: CosBreakdownRow[];
  months: string[];
  totals: { fy26: number; fy27: number; monthly: Record<string, number> };
}

// Excel date serial → "Mon 'YY" label
function serialToMonthLabel(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  const mon = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const yr = String(d.getUTCFullYear()).slice(2);
  return `${mon} '${yr}`;
}

// Apr–Mar fiscal year
function fyLabel(serial: number): 'FY26' | 'FY27' | 'FY28' | null {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  const yr = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1; // 1=Jan
  const fy = mo >= 4 ? yr + 1 : yr; // Apr onwards → next year
  if (fy === 2026) return 'FY26';
  if (fy === 2027) return 'FY27';
  if (fy === 2028) return 'FY28';
  return null;
}

// Month key for sort: YYYYMM
function monthSortKey(label: string): number {
  const MONTHS: Record<string, string> = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  const m = label.match(/^(\w{3}) '(\d{2})$/);
  if (!m) return 0;
  return parseInt(`20${m[2]}${MONTHS[m[1]] ?? '00'}`);
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v.replace(/[^0-9.\-]/g, '')) || 0;
  return 0;
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get('ff_auth_token')?.value;
  if (!token) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload?.sub) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }, { status: 401 });
  const hasAccess = await userHasPermission(payload.sub, 'analytics.reports', 'view');
  if (!hasAccess && !ALLOWED_USERS.has(payload.sub)) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'Access restricted' } }, { status: 403 });
  }

  logger.info('COS breakdown (Data tab) requested', { userId: payload.sub });

  try {
    const { values } = await getWorksheetRange('Data');
    if (!values || values.length < 2) throw new Error('Data sheet returned insufficient data');

    // Col indices (confirmed 2026-03-26):
    // 0=Date, 1=Date-M, 2=Type, 6=Amount Excl VAT, 10=Category
    const catMap = new Map<string, { fy26: number; fy27: number; monthly: Map<string, number> }>();
    const monthSet = new Set<string>();

    for (let i = 1; i < values.length; i++) {
      const row = values[i] as unknown[];
      const type = String(row[2] ?? '').trim();
      if (type !== 'Expense') continue;

      const serial = toNum(row[1]);
      if (serial <= 0) continue;

      const category = String(row[10] ?? '').trim() || '(Uncategorised)';
      const amount = toNum(row[6]);
      const monthLabel = serialToMonthLabel(serial);
      const fy = fyLabel(serial);

      monthSet.add(monthLabel);

      if (!catMap.has(category)) {
        catMap.set(category, { fy26: 0, fy27: 0, monthly: new Map() });
      }
      const entry = catMap.get(category)!;

      if (fy === 'FY26') entry.fy26 += amount;
      else if (fy === 'FY27') entry.fy27 += amount;

      entry.monthly.set(monthLabel, (entry.monthly.get(monthLabel) ?? 0) + amount);
    }

    // Sort months chronologically
    const months = Array.from(monthSet).sort((a, b) => monthSortKey(a) - monthSortKey(b));

    // Build rows sorted by FY26 total desc
    const rows: CosBreakdownRow[] = Array.from(catMap.entries())
      .map(([category, data]) => ({
        category,
        fy26: data.fy26,
        fy27: data.fy27,
        monthly: Object.fromEntries(months.map(m => [m, data.monthly.get(m) ?? 0])),
      }))
      .filter(r => r.fy26 > 0 || r.fy27 > 0 || Object.values(r.monthly).some(v => v > 0))
      .sort((a, b) => (b.fy26 + b.fy27) - (a.fy26 + a.fy27));

    // Totals row
    const totals: CosBreakdownData['totals'] = {
      fy26: rows.reduce((s, r) => s + r.fy26, 0),
      fy27: rows.reduce((s, r) => s + r.fy27, 0),
      monthly: Object.fromEntries(months.map(m => [m, rows.reduce((s, r) => s + (r.monthly[m] ?? 0), 0)])),
    };

    logger.info('COS breakdown fetched', { userId: payload.sub, categories: rows.length });

    return NextResponse.json({ success: true, data: { rows, months, totals } satisfies CosBreakdownData });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('COS breakdown fetch failed', { error: message });
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, { status: 500 });
  }
}
