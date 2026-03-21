/**
 * GET /api/conduit/projects/[id]/detail
 * Returns Rollout Plan, COS Categories, and Revenue Forecast for a project.
 *
 * Currently returns Lawley seed data for all projects (SharePoint integration pending).
 * TODO: fetch per-project Excel data from SharePoint once integration is in place.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ForecastRow {
  label: string;
  values: (number | null)[];
  isTotal?: boolean;
}

// ─── Lawley hardcoded seed data ──────────────────────────────────────────────

const MONTHS: string[] = [
  'Sept-25', 'Oct-25', 'Nov-25', 'Dec-25', 'Jan-26', 'Feb-26',
  'Mar-26', 'Apr-26', 'May-26', 'Jun-26', 'Jul-26', 'Aug-26',
];

const ROLLOUT_PLAN: ForecastRow[] = [
  { label: 'Permissions', values: Array<null>(12).fill(null) },
  { label: 'Poles', values: Array<null>(12).fill(null) },
  { label: 'Stringing', values: Array<null>(12).fill(null) },
  { label: "Optical - PON's", values: [null, null, null, null, null, null, 15, 20, 20, 17, null, null] },
  { label: 'Activations', values: [1026, 113, 785, 648, 982, 979, 800, 1000, 1200, 844, null, null] },
  { label: 'Wayleave Incentive', values: Array<null>(12).fill(null) },
];

const COS_CATEGORIES: ForecastRow[] = [
  { label: 'COS - Ad Hoc', values: [10434.78, 30700.87, 12000, null, null, 600, 10000, 10000, null, 10000, null, null] },
  { label: 'COS - Casuals', values: [19140, 29040, 31380, 25740, 26840, 51040, 30000, 30000, 30000, 30000, 20000, 20000] },
  { label: 'COS - Fuel', values: [1564.39, null, null, 25665.70, 32946.74, 13100.70, 15000, 15000, 15000, 15000, 10000, 10000] },
  { label: 'COS - Overheads', values: [173233.61, 168167.12, 212753.22, 194025.11, 149168.17, 150013.95, 150000, 150000, 150000, 150000, 75000, 75000] },
  { label: 'COS - Sales', values: [null, null, null, null, null, 5217.39, null, null, null, null, null, null] },
  { label: 'COS - Stock', values: [156800.54, 279572.91, 1368667.68, 824581.70, 339799.03, 235476.80, 60000, 60000, 279680.53, 340128.93, 318464.28, 236959.53] },
  { label: 'COS - Sub-Contractor', values: [301339.75, 281639.80, 146288.50, 377646.75, 349644.55, 379634.20, 259000, 335000, 366000, 283820, null, null] },
  { label: 'COS - Wayleaves', values: [null, null, null, null, null, 31232.78, null, null, null, null, null, null] },
  {
    label: 'Total',
    values: [662513.07, 789120.70, 1771089.40, 1447659.26, 898398.49, 866315.81, 524000, 600000, 850680.53, 828948.93, 423464.28, 341959.53],
    isTotal: true,
  },
];

const REVENUE_FORECAST: ForecastRow[] = [
  { label: 'Activations', values: [770200, 305100, 2119500, 1749600, 2651400, 2642298.10, 2160000, 2700000, 3240000, 2278800, null, null] },
  { label: 'Gross', values: [892313.07, -484020.70, 348410.60, 301940.74, 1753001.51, 1775982.29, 1636000, 2100000, 2389319.47, 1449851.07, -423464.28, -341959.53] },
  { label: 'Running Net', values: [-9087409.22, -10571429.93, -10223019.33, -9921078.59, -8168077.08, -6392094.79, -4756094.79, -2656094.79, -266775.32, 1183075.75, 759611.47, 417651.95] },
];

// ─── Route context ────────────────────────────────────────────────────────────

interface RouteContext {
  params: { id: string };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: RouteContext) {
  const auth = getAuth(req);
  if (!auth?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: 'Missing project id' }, { status: 400 });
  }

  const payload = {
    projectId: id,
    months: MONTHS,
    rolloutPlan: ROLLOUT_PLAN,
    cosCategories: COS_CATEGORIES,
    revenueForecast: REVENUE_FORECAST,
  };

  return NextResponse.json({ success: true, data: payload });
}
