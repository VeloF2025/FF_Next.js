/**
 * POST /api/conduit/actuals/sync
 *
 * Pulls FT_Revenue sheet from the Shareholder Model Excel (via Graph API),
 * aggregates actual COS + activations by project + month,
 * and upserts into conduit_actuals.
 *
 * Logic:
 * - Source: FT_Revenue worksheet, Type='invoice' rows only
 * - project: col 8 (Project)
 * - month: col 2 (Date_M) — bucketed to first of month
 * - cos_actual: sum of col 10 (Debit Excl VAT) per project+month
 * - activations: sum of col 14 (Activations) per project+month
 * - cos_breakdown: grouped by col 9 (Type) — Activations, Backhaul, Fuel, Plinth, etc.
 * - Period: only months BEFORE current month (end of previous month rule)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { getWorksheetRange } from '@/lib/graph/sharepoint-excel';

const sql = neon(process.env.DATABASE_URL!);

interface MonthlyActual {
  cos_actual: number;
  activations: number;
  cos_breakdown: Record<string, number>;
}

export async function POST(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch FT_Revenue sheet
    const { values } = await getWorksheetRange('FT_Revenue');

    if (!values || values.length < 2) {
      return NextResponse.json({ error: 'FT_Revenue sheet is empty' }, { status: 500 });
    }

    // Cutoff: exclude current month and future
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth(), 1); // first of current month

    // Aggregate: project+month → totals
    const agg = new Map<string, MonthlyActual>();

    for (let i = 1; i < values.length; i++) {
      const row = values[i] as unknown[];
      const invoiceType = String(row[3] ?? '').trim();
      if (invoiceType !== 'invoice') continue;

      const project  = String(row[7] ?? '').trim();
      const dateM    = row[1];   // Date_M — date object or ISO string
      const costType = String(row[8] ?? '').trim();
      const debit    = parseFloat(String(row[9] ?? '0').replace(/[^0-9.]/g, '')) || 0;
      const acts     = parseFloat(String(row[13] ?? '0')) || 0;

      if (!project || !dateM) continue;

      // Parse month — Graph API returns Excel serial numbers (days since 1899-12-30)
      let monthDate: Date;
      if (typeof dateM === 'number') {
        // Excel serial date: days since Dec 30 1899
        monthDate = new Date(Date.UTC(1899, 11, 30) + dateM * 86400000);
      } else if (dateM instanceof Date) {
        monthDate = dateM;
      } else {
        monthDate = new Date(String(dateM));
      }
      if (isNaN(monthDate.getTime())) continue;

      // Enforce cutoff — skip current month and future
      const monthFirst = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
      if (monthFirst >= cutoff) continue;

      const monthKey = `${project}||${monthFirst.toISOString().slice(0, 10)}`;

      if (!agg.has(monthKey)) {
        agg.set(monthKey, { cos_actual: 0, activations: 0, cos_breakdown: {} });
      }
      const entry = agg.get(monthKey)!;
      entry.cos_actual += debit;
      entry.activations += acts;
      entry.cos_breakdown[costType] = (entry.cos_breakdown[costType] ?? 0) + debit;
    }

    // Upsert into conduit_actuals
    let upserted = 0;
    for (const [key, data] of agg) {
      const [project, month] = key.split('||');
      await sql`
        INSERT INTO conduit_actuals (project_name, month, cos_actual, activations, cos_breakdown, synced_at)
        VALUES (
          ${project},
          ${month}::date,
          ${data.cos_actual},
          ${Math.round(data.activations)},
          ${JSON.stringify(data.cos_breakdown)}::jsonb,
          now()
        )
        ON CONFLICT (project_name, month) DO UPDATE SET
          cos_actual    = EXCLUDED.cos_actual,
          activations   = EXCLUDED.activations,
          cos_breakdown = EXCLUDED.cos_breakdown,
          synced_at     = now()
      `;
      upserted++;
    }

    return NextResponse.json({
      success: true,
      upserted,
      cutoff: cutoff.toISOString().slice(0, 7),
      projects: [...new Set([...agg.keys()].map(k => k.split('||')[0]))],
    });
  } catch (error) {
    console.error('[conduit/actuals/sync]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    );
  }
}
