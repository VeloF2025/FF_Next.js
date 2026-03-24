/**
 * POST /api/conduit/actuals/sync
 *
 * Pulls two worksheets from the Shareholder Model Excel (via Graph API) and
 * upserts aggregated actuals into conduit_actuals by project + month.
 *
 * Sources:
 *  - Data tab       → cos_actual + cos_breakdown (Type=Expense, Category T2 starts with "COS")
 *  - FT_Revenue tab → revenue_actual + activations (Type=invoice)
 *
 * Cutoff rule: only months whose first day is strictly before the first day of
 * the current UTC month are included (i.e. current month is excluded).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { getWorksheetRange } from '@/lib/graph/sharepoint-excel';
import { createLogger } from '@/lib/logger';

const logger = createLogger('conduit:actuals:sync');
const sql = neon(process.env.DATABASE_URL!);

/** Projects to exclude from the Data tab Cost Centre T2 column. */
const EXCLUDED_COST_CENTRES = new Set([
  'OPEX', 'Revenue', 'Loan', 'Tools', 'Fixed Assets', 'None', 'Liabilities', '',
]);

/** Aggregated actuals per project+month key (`"project||YYYY-MM-01"`). */
interface MonthlyActual {
  cos_actual: number;
  cos_breakdown: Record<string, number>;
  revenue_actual: number;
  activations: number;
}

/**
 * Parses a Date_M cell value into a YYYY-MM-01 string.
 *
 * Graph API may return:
 *  - A number (Excel serial: days since 1899-12-30)
 *  - An ISO string ("YYYY-MM-..." or "DD/MM/YYYY" or "MM/YYYY")
 *
 * Returns null if the value cannot be parsed.
 */
function parseDateM(val: unknown): string | null {
  if (!val) return null;

  if (typeof val === 'number') {
    // Excel serial date: days since Dec 30 1899 (UTC)
    const d = new Date(Date.UTC(1899, 11, 30) + val * 86400000);
    if (isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }

  if (typeof val === 'string') {
    // ISO format: YYYY-MM-...
    const isoMatch = val.match(/^(\d{4})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-01`;

    // Slash-delimited: DD/MM/YYYY or MM/YYYY
    const parts = val.split('/');
    if (parts.length === 3 && parts[2] && parts[1]) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-01`;
    }
    if (parts.length === 2 && parts[1] && parts[0]) {
      return `${parts[1]}-${parts[0].padStart(2, '0')}-01`;
    }
  }

  return null;
}

/**
 * Returns the first day of the current UTC month as a Date.
 * Only records whose month is strictly before this cutoff are synced.
 */
function getUtcCutoff(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Ensures the aggregation map has an entry for a given key.
 */
function ensureEntry(
  agg: Map<string, MonthlyActual>,
  key: string,
): MonthlyActual {
  if (!agg.has(key)) {
    agg.set(key, {
      cos_actual: 0,
      cos_breakdown: {},
      revenue_actual: 0,
      activations: 0,
    });
  }
  return agg.get(key)!;
}

/**
 * Processes the Data worksheet and accumulates COS actuals into the map.
 *
 * Column indices (0-based, verified against live Data tab 2026-03-24):
 *   0  = Date
 *   1  = Date_M
 *   2  = Type          (was incorrectly 3)
 *   6  = Amount Excl VAT (was incorrectly 5)
 *   11 = Category T2   (was incorrectly 10)
 *   16 = Cost Centre T2 (was incorrectly 15)
 */
function processDataTab(
  rows: unknown[][],
  agg: Map<string, MonthlyActual>,
  cutoff: Date,
): void {
  // Skip header row (index 0)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    const type = String(row[2] ?? '').trim();
    if (type !== 'Expense') continue;

    const categoryT2 = String(row[11] ?? '').trim();
    if (!categoryT2.startsWith('COS')) continue;

    const costCentreT2 = String(row[16] ?? '').trim();
    if (EXCLUDED_COST_CENTRES.has(costCentreT2)) continue;

    const monthStr = parseDateM(row[1]);
    if (!monthStr) continue;

    // Enforce cutoff
    if (new Date(monthStr) >= cutoff) continue;

    const amount = parseFloat(String(row[6] ?? '0').replace(/[^0-9.-]/g, '')) || 0;

    const key = `${costCentreT2}||${monthStr}`;
    const entry = ensureEntry(agg, key);
    entry.cos_actual += amount;
    entry.cos_breakdown[categoryT2] = (entry.cos_breakdown[categoryT2] ?? 0) + amount;
  }
}

/**
 * Processes the FT_Revenue worksheet and accumulates revenue + activations.
 *
 * Column indices (0-based):
 *   0  = Invoice Date
 *   1  = Date_M
 *   3  = Type
 *   7  = Project
 *   8  = Cost Type
 *   9  = Debit Excl VAT
 *   13 = Activations
 */
function processFtRevenueTab(
  rows: unknown[][],
  agg: Map<string, MonthlyActual>,
  cutoff: Date,
): void {
  // Skip header row (index 0)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    const type = String(row[3] ?? '').trim();
    if (type !== 'invoice') continue;

    const project = String(row[7] ?? '').trim();
    if (!project) continue;

    const monthStr = parseDateM(row[1]);
    if (!monthStr) continue;

    // Enforce cutoff
    if (new Date(monthStr) >= cutoff) continue;

    const debit = parseFloat(String(row[9] ?? '0').replace(/[^0-9.-]/g, '')) || 0;
    const acts = parseFloat(String(row[13] ?? '0')) || 0;

    const key = `${project}||${monthStr}`;
    const entry = ensureEntry(agg, key);
    entry.revenue_actual += debit;
    entry.activations += acts;
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cutoff = getUtcCutoff();
    logger.info('Starting actuals sync', { cutoff: cutoff.toISOString() });

    // Fetch both worksheets in parallel
    const [dataResult, revenueResult] = await Promise.all([
      getWorksheetRange('Data'),
      getWorksheetRange('FT_Revenue'),
    ]);

    if (!dataResult.values || dataResult.values.length < 2) {
      return NextResponse.json({ error: 'Data sheet is empty or missing' }, { status: 500 });
    }
    if (!revenueResult.values || revenueResult.values.length < 2) {
      return NextResponse.json({ error: 'FT_Revenue sheet is empty or missing' }, { status: 500 });
    }

    logger.info('Worksheets fetched', {
      dataRows: dataResult.values.length,
      revenueRows: revenueResult.values.length,
    });

    // Aggregate both tabs into a single map keyed by "project||YYYY-MM-01"
    const agg = new Map<string, MonthlyActual>();
    processDataTab(dataResult.values, agg, cutoff);
    processFtRevenueTab(revenueResult.values, agg, cutoff);

    logger.info('Aggregation complete', { entries: agg.size });

    // Upsert each entry into conduit_actuals
    let synced = 0;
    const uniqueMonths = new Set<string>();
    const uniqueProjects = new Set<string>();

    for (const [key, data] of agg) {
      const separatorIdx = key.indexOf('||');
      const projectName = key.slice(0, separatorIdx);
      const month = key.slice(separatorIdx + 2);

      await sql`
        INSERT INTO conduit_actuals
          (project_name, month, cos_actual, cos_breakdown, revenue_actual, activations, synced_at)
        VALUES (
          ${projectName},
          ${month}::date,
          ${data.cos_actual},
          ${JSON.stringify(data.cos_breakdown)}::jsonb,
          ${data.revenue_actual},
          ${Math.round(data.activations)},
          now()
        )
        ON CONFLICT (project_name, month) DO UPDATE SET
          cos_actual    = EXCLUDED.cos_actual,
          cos_breakdown = EXCLUDED.cos_breakdown,
          revenue_actual = EXCLUDED.revenue_actual,
          activations   = EXCLUDED.activations,
          synced_at     = EXCLUDED.synced_at
      `;

      synced++;
      uniqueMonths.add(month);
      uniqueProjects.add(projectName);
    }

    logger.info('Actuals sync complete', { synced, projects: uniqueProjects.size });

    return NextResponse.json({
      synced,
      months: [...uniqueMonths].sort(),
      projects: [...uniqueProjects].sort(),
    });
  } catch (error) {
    logger.error('Actuals sync failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 },
    );
  }
}
