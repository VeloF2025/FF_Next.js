/**
 * GET /api/analytics/reports/activations
 *
 * OES activations grouped into Year → Month → Week hierarchy.
 * Revenue estimate: R 3,105 per activation.
 *
 * Access restricted via RBAC (analytics.reports / view) or user allowlist.
 */

// 🟢 WORKING: Activations GET handler — OES activations year/month/week hierarchy
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';
import { verifyToken } from '@/lib/auth/jwt';
import { userHasPermission } from '@/lib/permissions';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

const logger = createLogger('analytics:api:activations');

const REVENUE_PER_ACTIVATION = 3105;

const ALLOWED_USERS = new Set([
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', // Hein
  '7d84184b-2a2b-4fbb-a52e-9815d0e92237', // Lew
]);

export interface ActivationWeek {
  weekStart: string;
  weekLabel: string;
  activations: number;
  revenue: number;
}

export interface ActivationMonth {
  monthKey: string;
  monthLabel: string;
  activations: number;
  revenue: number;
  weeks: ActivationWeek[];
}

export interface ActivationYear {
  year: number;
  activations: number;
  revenue: number;
  months: ActivationMonth[];
}

export interface ActivationsData {
  years: ActivationYear[];
  totals: { activations: number; revenue: number };
}

interface DbRow {
  week_start: string;
  project_id: string;
  project_name: string;
  count: string;
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function buildWeekLabel(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00Z');
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const dayMon: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', timeZone: 'UTC' };
  const yearOpt: Intl.DateTimeFormatOptions = { year: 'numeric', timeZone: 'UTC' };
  return `${start.toLocaleDateString('en-GB', dayMon)} – ${end.toLocaleDateString('en-GB', dayMon)} ${end.toLocaleDateString('en-GB', yearOpt)}`;
}

function monthKeyFromWeekStart(weekStart: string): string {
  // Use Monday's date for month assignment
  const d = new Date(weekStart + 'T00:00:00Z');
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function monthLabelFromKey(monthKey: string): string {
  const [yearStr, monStr] = monthKey.split('-');
  const month = parseInt(monStr, 10) - 1;
  return `${MONTH_NAMES[month]} ${yearStr}`;
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
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
  const hasAccess = await userHasPermission(userId, 'analytics.reports', 'view');
  if (!hasAccess && !ALLOWED_USERS.has(userId)) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Access restricted' } },
      { status: 403 }
    );
  }

  logger.info('Activations report requested', { userId });

  const client = await pool.connect();
  try {
    const result = await client.query<DbRow>(`
      SELECT
        DATE_TRUNC('week', oes.activation_date)::date::text AS week_start,
        p.id::text AS project_id,
        p.project_name,
        COUNT(DISTINCT oes.drop_number) AS count
      FROM oes_activations oes
      JOIN drops d ON d.drop_number = oes.drop_number
      JOIN projects p ON p.id = d.project_id
      WHERE p.status = 'active'
        AND oes.activation_date IS NOT NULL
      GROUP BY DATE_TRUNC('week', oes.activation_date), p.id, p.project_name
      ORDER BY DATE_TRUNC('week', oes.activation_date) DESC, p.project_name ASC
    `);

    // Aggregate week totals
    const weekTotals = new Map<string, number>();
    for (const row of result.rows) {
      const prev = weekTotals.get(row.week_start) ?? 0;
      weekTotals.set(row.week_start, prev + Number(row.count));
    }

    // Build Year → Month → Week hierarchy
    const yearMap = new Map<number, ActivationYear>();

    for (const [weekStart, total] of weekTotals) {
      const d = new Date(weekStart + 'T00:00:00Z');
      const year = d.getUTCFullYear();
      const monthKey = monthKeyFromWeekStart(weekStart);

      if (!yearMap.has(year)) {
        yearMap.set(year, { year, activations: 0, revenue: 0, months: [] });
      }
      const yearEntry = yearMap.get(year)!;

      let monthEntry = yearEntry.months.find((m) => m.monthKey === monthKey);
      if (!monthEntry) {
        monthEntry = {
          monthKey,
          monthLabel: monthLabelFromKey(monthKey),
          activations: 0,
          revenue: 0,
          weeks: [],
        };
        yearEntry.months.push(monthEntry);
      }

      const week: ActivationWeek = {
        weekStart,
        weekLabel: buildWeekLabel(weekStart),
        activations: total,
        revenue: total * REVENUE_PER_ACTIVATION,
      };
      monthEntry.weeks.push(week);
      monthEntry.activations += total;
      monthEntry.revenue += total * REVENUE_PER_ACTIVATION;
      yearEntry.activations += total;
      yearEntry.revenue += total * REVENUE_PER_ACTIVATION;
    }

    // Sort: years DESC, months DESC, weeks DESC (already DESC from SQL)
    const years = Array.from(yearMap.values()).sort((a, b) => b.year - a.year);
    for (const yr of years) {
      yr.months.sort((a, b) => b.monthKey.localeCompare(a.monthKey));
      for (const mo of yr.months) {
        mo.weeks.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
      }
    }

    const totalActivations = years.reduce((s, y) => s + y.activations, 0);
    const data: ActivationsData = {
      years,
      totals: { activations: totalActivations, revenue: totalActivations * REVENUE_PER_ACTIVATION },
    };

    logger.info('Activations report built', { years: years.length, totalActivations });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    logger.error('Failed to build activations report', { error });
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load activations data' } },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
