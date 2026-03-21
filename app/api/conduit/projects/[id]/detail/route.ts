/**
 * GET /api/conduit/projects/[id]/detail
 *
 * Returns month-by-month forecast for a project, computed from its inputs_json.
 * No hardcoded data — all rows derived from the project record.
 *
 * Revenue model: recurring subscription.
 *   Each month N:  monthly_revenue = cumulative_activations_to_date × rate
 *
 * COS spread:
 *   Civil costs      → evenly over build duration (front-loaded option in v3)
 *   Activation costs → proportional to new activations that month
 *   Monthly opex     → constant each month
 *   Sub-contractor   → evenly over build duration
 *   Ad Hoc           → month 1 only (lump, variable by nature)
 *
 * Activations spread linearly; last month absorbs any rounding remainder.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import type { ConduitProject } from '@/modules/conduit/types';

const sql = neon(process.env.DATABASE_URL!);

// ─── Types ───────────────────────────────────────────────────────────────────

interface ForecastRow {
  label: string;
  values: (number | null)[];
  isTotal?: boolean;
}

// ─── Month label ─────────────────────────────────────────────────────────────

function monthLabel(base: Date, offset: number): string {
  const d = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  return d.toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' });
}

// ─── Forecast builder ─────────────────────────────────────────────────────────

function buildForecast(project: ConduitProject) {
  const {
    po_count,
    build_duration_months: dur,
    start_date,
    inputs_json: inp,
  } = project;

  const { rate, uptake, scope, service_rates: sr, material_rates: mr, monthly_opex: mo, lump_costs: lc } = inp;

  const fc_total = po_count * uptake; // unrounded
  const start = start_date ? new Date(start_date) : new Date();

  // ── Month labels ──────────────────────────────────────────────────────────
  const months: string[] = Array.from({ length: dur }, (_, i) => monthLabel(start, i));

  // ── Civil cost — spread evenly over build duration ────────────────────────
  const total_per_pole = sr.pole_plant_each + sr.permissions_per_pole + sr.wayleave_incentive + mr.pole;
  const wayleave_lump_pm = dur > 0 ? lc.wayleave_cost / dur : 0;
  const total_per_m    = sr.stringing_per_m + mr.cable_per_m;
  const total_per_pon  = sr.optical_per_pon + mr.optical;
  const civil_total =
    scope.poles * total_per_pole +
    scope.stringing_m * total_per_m +
    scope.pon * total_per_pon;
  const civil_pm = dur > 0 ? civil_total / dur : 0;

  // ── Per-activation cost ───────────────────────────────────────────────────
  const per_activation_cost = sr.activation_each + mr.activation;



  // ── Monthly opex ──────────────────────────────────────────────────────────
  const monthly_opex = mo.casuals + mo.fuel + mo.overheads + mo.sales;

  // ── Per-month arrays ──────────────────────────────────────────────────────
  const newActs: number[]     = [];
  const cumActs: number[]     = [];
  const revMonthly: number[]  = [];
  const cosAdHoc: number[]    = [];
  const cosCasuals: number[]  = [];
  const cosFuel: number[]     = [];
  const cosOverheads: number[]= [];
  const cosSales: number[]    = [];
  const cosStock: number[]    = [];   // civil per month
  const cosActivation: number[]= [];
  const cosTotal: number[]    = [];
  const grossMonthly: number[]= [];
  const runningNet: number[]  = [];

  let cumAct = 0;
  let cumulativeNet = 0;
  const baseNewAct = fc_total / dur;

  for (let m = 0; m < dur; m++) {
    // Activations: linear spread, last month absorbs remainder
    const isLast = m === dur - 1;
    const newAct = isLast ? fc_total - cumAct : baseNewAct;
    cumAct += newAct;

    // Revenue: all cumulative subscribers pay monthly subscription
    const monthRev = cumAct * rate;

    // COS this month
    const adhoc    = mo.ad_hoc;   // monthly (× build duration like all opex)
    const casuals  = mo.casuals;
    const fuel     = mo.fuel;
    const overhead = mo.overheads;
    const sales    = mo.sales;
    const stock    = civil_pm;               // civil materials/labour
    const act_cost = newAct * per_activation_cost;

    const monthCos = adhoc + casuals + fuel + overhead + sales + stock + act_cost + wayleave_lump_pm;

    const gross = monthRev - monthCos;
    cumulativeNet += gross;

    newActs.push(newAct);
    cumActs.push(cumAct);
    revMonthly.push(monthRev);
    cosAdHoc.push(adhoc);
    cosCasuals.push(casuals);
    cosFuel.push(fuel);
    cosOverheads.push(overhead);
    cosSales.push(sales);
    cosStock.push(stock);
    cosActivation.push(act_cost);
    cosTotal.push(monthCos);
    grossMonthly.push(gross);
    runningNet.push(cumulativeNet);
  }

  // ── Helper: null out zero values for cleaner display ──────────────────────
  const sparse = (arr: number[]): (number | null)[] =>
    arr.map(v => (Math.abs(v) < 0.005 ? null : Math.round(v * 100) / 100));

  const round = (arr: number[]): number[] => arr.map(v => Math.round(v));

  // ── Rollout plan ─────────────────────────────────────────────────────────
  const rolloutPlan: ForecastRow[] = [
    {
      label: 'Poles',
      values: sparse(Array.from({ length: dur }, () => scope.poles > 0 ? scope.poles / dur : 0)),
    },
    {
      label: 'Stringing (m)',
      values: sparse(Array.from({ length: dur }, () => scope.stringing_m > 0 ? scope.stringing_m / dur : 0)),
    },
    {
      label: "Optical — PON's",
      values: sparse(Array.from({ length: dur }, () => scope.pon > 0 ? scope.pon / dur : 0)),
    },
    {
      label: 'Activations (new)',
      values: round(newActs),
    },
    {
      label: 'Activations (cumulative)',
      values: round(cumActs),
    },
  ];

  // ── COS categories ────────────────────────────────────────────────────────
  const cosTotals = cosTotal.map((_, i) =>
    (cosAdHoc[i] ?? 0) + cosCasuals[i] + cosFuel[i] + cosOverheads[i] +
    cosSales[i] + cosStock[i] + cosActivation[i]
  );

  const cosCategories: ForecastRow[] = [
    { label: 'COS — Ad Hoc',          values: sparse(cosAdHoc) },
    { label: 'COS — Casuals',          values: sparse(cosCasuals) },
    { label: 'COS — Fuel',             values: sparse(cosFuel) },
    { label: 'COS — Overheads',        values: sparse(cosOverheads) },
    { label: 'COS — Sales',            values: sparse(cosSales) },
    { label: 'COS — Stock / Civil',    values: sparse(cosStock) },
    { label: 'COS — Activation',       values: sparse(cosActivation) },

    {
      label: 'Total',
      values: sparse(cosTotals),
      isTotal: true,
    },
  ];

  // ── Revenue forecast ──────────────────────────────────────────────────────
  const revenueForecast: ForecastRow[] = [
    { label: 'Subscription Revenue',  values: sparse(revMonthly) },
    { label: 'Monthly Gross (Rev−COS)', values: sparse(grossMonthly) },
    { label: 'Running Net (Cumulative)', values: sparse(runningNet), isTotal: true },
  ];

  return { months, rolloutPlan, cosCategories, revenueForecast };
}

// ─── Route context ────────────────────────────────────────────────────────────

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: RouteContext) {
  const auth = getAuth(req);
  if (!auth?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Missing project id' }, { status: 400 });
  }

  try {
    const rows = await sql`
      SELECT id, name, po_count, start_date, build_duration_months,
             inputs_json, is_baseline_locked, created_at, updated_at
      FROM conduit_projects
      WHERE id = ${id}::uuid
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const project = rows[0] as ConduitProject;
    const forecast = buildForecast(project);

    return NextResponse.json({
      success: true,
      data: {
        projectId: id,
        projectName: project.name,
        ...forecast,
      },
    });
  } catch (err) {
    console.error('[conduit/detail GET]', err);
    return NextResponse.json({ error: 'Failed to build forecast' }, { status: 500 });
  }
}
