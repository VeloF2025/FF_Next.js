/**
 * GET /api/analytics/reports/cos-breakdown
 *
 * COS Breakdown — Data tab, col D == "COS"
 * Groups by Category (col 10) → Category T2 (col 11), pivots by month (col 1)
 * Optional filters: businessUnit (Cost Centre T1, col 15), project (Cost Centre T2, col 16)
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
  categoryT2: string;
  fy26: number;
  fy27: number;
  monthly: Record<string, number>;
}

export interface CosBreakdownCategory {
  category: string;
  fy26: number;
  fy27: number;
  monthly: Record<string, number>;
  rows: CosBreakdownRow[];
}

export interface CosBreakdownData {
  categories: CosBreakdownCategory[];
  months: string[];
  totals: { fy26: number; fy27: number; monthly: Record<string, number> };
  businessUnits: string[];
  projects: string[];
}

function serialToMonthLabel(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  const mon = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${mon} '${String(d.getUTCFullYear()).slice(2)}`;
}

function fyLabel(serial: number): 'FY26' | 'FY27' | null {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  const mo = d.getUTCMonth() + 1;
  const fy = mo >= 4 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
  if (fy === 2026) return 'FY26';
  if (fy === 2027) return 'FY27';
  return null;
}

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

function addToMonthly(map: Map<string, number>, month: string, amount: number) {
  map.set(month, (map.get(month) ?? 0) + amount);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get('ff_auth_token')?.value;
  if (!token) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload?.sub) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }, { status: 401 });
  const hasAccess = await userHasPermission(payload.sub, 'analytics.reports', 'view');
  if (!hasAccess && !ALLOWED_USERS.has(payload.sub)) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'Access restricted' } }, { status: 403 });
  }

  const buFilter = req.nextUrl.searchParams.get('businessUnit') ?? '';
  const projFilter = req.nextUrl.searchParams.get('project') ?? '';

  logger.info('COS breakdown requested', { userId: payload.sub, buFilter, projFilter });

  try {
    const { values } = await getWorksheetRange('Data');
    if (!values || values.length < 2) throw new Error('Data sheet returned insufficient data');

    // Col: 0=Date, 1=Date-M, 2=Type, 3=OPEX/CAPEX, 6=Amount, 10=Category, 11=Category T2, 15=T1(BU), 16=T2(Project)
    type T2Key = string;
    type CatKey = string;
    const catMap = new Map<CatKey, Map<T2Key, { fy26: number; fy27: number; monthly: Map<string, number> }>>();
    const monthSet = new Set<string>();
    const buSet = new Set<string>();
    const projSet = new Set<string>();

    for (let i = 1; i < values.length; i++) {
      const row = values[i] as unknown[];
      if (String(row[3] ?? '').trim() !== 'COS') continue;

      const bu = String(row[15] ?? '').trim();
      const proj = String(row[16] ?? '').trim();

      // Collect all BU + project values (before filter)
      if (bu) buSet.add(bu);
      if (proj) projSet.add(proj);

      // Apply filters
      if (buFilter && bu !== buFilter) continue;
      if (projFilter && proj !== projFilter) continue;

      const serial = toNum(row[1]);
      if (serial <= 0) continue;

      const cat = String(row[10] ?? '').trim() || '(Uncategorised)';
      const catT2 = String(row[11] ?? '').trim() || '(Uncategorised)';
      const amount = toNum(row[6]);
      const month = serialToMonthLabel(serial);
      const fy = fyLabel(serial);

      monthSet.add(month);

      if (!catMap.has(cat)) catMap.set(cat, new Map());
      const t2Map = catMap.get(cat)!;
      if (!t2Map.has(catT2)) t2Map.set(catT2, { fy26: 0, fy27: 0, monthly: new Map() });
      const entry = t2Map.get(catT2)!;

      if (fy === 'FY26') entry.fy26 += amount;
      else if (fy === 'FY27') entry.fy27 += amount;
      addToMonthly(entry.monthly, month, amount);
    }

    const months = Array.from(monthSet).sort((a, b) => monthSortKey(a) - monthSortKey(b));

    // Build tiered categories
    const categories: CosBreakdownCategory[] = Array.from(catMap.entries()).map(([cat, t2Map]) => {
      const rows: CosBreakdownRow[] = Array.from(t2Map.entries())
        .map(([catT2, d]) => ({
          category: cat,
          categoryT2: catT2,
          fy26: d.fy26,
          fy27: d.fy27,
          monthly: Object.fromEntries(months.map(m => [m, d.monthly.get(m) ?? 0])),
        }))
        .sort((a, b) => (b.fy26 + b.fy27) - (a.fy26 + a.fy27));

      const fy26 = rows.reduce((s, r) => s + r.fy26, 0);
      const fy27 = rows.reduce((s, r) => s + r.fy27, 0);
      const monthly = Object.fromEntries(months.map(m => [m, rows.reduce((s, r) => s + (r.monthly[m] ?? 0), 0)]));

      return { category: cat, fy26, fy27, monthly, rows };
    }).sort((a, b) => (b.fy26 + b.fy27) - (a.fy26 + a.fy27));

    const totals = {
      fy26: categories.reduce((s, c) => s + c.fy26, 0),
      fy27: categories.reduce((s, c) => s + c.fy27, 0),
      monthly: Object.fromEntries(months.map(m => [m, categories.reduce((s, c) => s + (c.monthly[m] ?? 0), 0)])),
    };

    const data: CosBreakdownData = {
      categories,
      months,
      totals,
      businessUnits: Array.from(buSet).sort(),
      projects: Array.from(projSet).sort(),
    };

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('COS breakdown fetch failed', { error: message });
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, { status: 500 });
  }
}
