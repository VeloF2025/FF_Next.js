/**
 * POST /api/conduit/actuals/sync
 *
 * Pulls the "Data" sheet from Shareholder_Model_Master.xlsx (Graph API).
 * Aggregates actual COS by project + month + COS category.
 * Also pulls activations from FT_Revenue sheet.
 * Upserts into conduit_actuals.
 *
 * Data tab logic:
 *   - Category T2 (col 11, index 10): must start with "COS"
 *   - Cost Centre T2 (col 16, index 15): = project name
 *   - Amount: col 6 (index 5) = Debit Excl VAT
 *   - Date_M: col 2 (index 1) — Excel serial date
 *   - Period: months BEFORE current month only
 *
 * Activations logic (FT_Revenue tab):
 *   - Type col 4 (index 3) = 'invoice'
 *   - Cost type col 9 (index 8) = 'Activations'
 *   - Project col 8 (index 7) = project name
 *   - Activations col 14 (index 13)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { getWorksheetRange } from '@/lib/graph/sharepoint-excel';

const sql = neon(process.env.DATABASE_URL!);

function parseExcelDate(val: unknown): Date | null {
  if (typeof val === 'number') {
    return new Date(Date.UTC(1899, 11, 30) + val * 86400000);
  }
  if (val instanceof Date) return val;
  if (typeof val === 'string' && val) {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function firstOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

interface MonthlyActual {
  cos_actual: number;
  activations: number;
  revenue_actual: number;
  cos_breakdown: Record<string, number>;
}

export async function POST(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Cutoff: exclude current month and future
    const now = new Date();
    const cutoff = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));

    const agg = new Map<string, MonthlyActual>();

    // ── Pull COS from Data tab ────────────────────────────────────────────
    const { values: dataRows } = await getWorksheetRange('Data');

    for (let i = 1; i < dataRows.length; i++) {
      const row = dataRows[i] as unknown[];
      const catT2  = String(row[10] ?? '').trim();  // Category T2
      const ccT2   = String(row[15] ?? '').trim();  // Cost Centre T2 = project
      const amount = parseFloat(String(row[5] ?? '0').replace(/[^0-9.\-]/g, '')) || 0;
      const dateM  = row[1];

      const rowType = String(row[2] ?? '').trim();   // Type col (index 2) — 'Expense' or 'Income'
      if (rowType !== 'Expense') continue;            // Only expense rows — exclude Income
      if (!catT2.startsWith('COS')) continue;
      if (!ccT2 || ['None', 'OPEX', 'Revenue', 'Loan', 'Tools', 'Fixed Assets'].includes(ccT2)) continue;
      if (amount === 0) continue;

      const monthDate = parseExcelDate(dateM);
      if (!monthDate) continue;

      const monthFirst = firstOfMonth(monthDate);
      if (monthFirst >= cutoff) continue;

      const monthKey = monthFirst.toISOString().slice(0, 10);
      const key = `${ccT2}||${monthKey}`;

      if (!agg.has(key)) agg.set(key, { cos_actual: 0, activations: 0, revenue_actual: 0, cos_breakdown: {} });
      const entry = agg.get(key)!;
      // Do NOT accumulate cos_actual here — derive it from breakdown sum at upsert time
      entry.cos_breakdown[catT2] = (entry.cos_breakdown[catT2] ?? 0) + amount;
    }

    // ── Pull activations + revenue from FT_Revenue tab ───────────────────
    // Source of truth for both revenue (Debit Excl VAT) and activations
    const { values: ftRows } = await getWorksheetRange('FT_Revenue');

    for (let i = 1; i < ftRows.length; i++) {
      const row = ftRows[i] as unknown[];
      const invoiceType = String(row[3] ?? '').trim();
      const project     = String(row[7] ?? '').trim();
      const dateM       = row[1];
      const debit       = parseFloat(String(row[9] ?? '0').replace(/[^0-9.\-]/g, '')) || 0;
      const acts        = parseFloat(String(row[13] ?? '0')) || 0;

      if (invoiceType !== 'invoice') continue;
      if (!project) continue;

      const monthDate = parseExcelDate(dateM);
      if (!monthDate) continue;

      const monthFirst = firstOfMonth(monthDate);
      if (monthFirst >= cutoff) continue;

      const monthKey = monthFirst.toISOString().slice(0, 10);
      const key = `${project}||${monthKey}`;

      if (!agg.has(key)) agg.set(key, { cos_actual: 0, activations: 0, revenue_actual: 0, cos_breakdown: {} });
      const entry = agg.get(key)!;
      entry.revenue_actual += debit;  // all invoice types sum to total revenue
      entry.activations    += acts;   // activations col (non-zero only on Activations type rows)
    }

    // ── Upsert ────────────────────────────────────────────────────────────
    // cos_actual = sum of breakdown (single source of truth, avoids double-counting)
    let upserted = 0;
    for (const [key, data] of agg) {
      const [project, month] = key.split('||');
      const cosTotal = Object.values(data.cos_breakdown).reduce((s, v) => s + v, 0);
      await sql`
        INSERT INTO conduit_actuals (project_name, month, cos_actual, activations, revenue_actual, cos_breakdown, synced_at)
        VALUES (
          ${project}, ${month}::date, ${cosTotal},
          ${Math.round(data.activations)},
          ${data.revenue_actual},
          ${JSON.stringify(data.cos_breakdown)}::jsonb, now()
        )
        ON CONFLICT (project_name, month) DO UPDATE SET
          cos_actual      = EXCLUDED.cos_actual,
          activations     = EXCLUDED.activations,
          revenue_actual  = EXCLUDED.revenue_actual,
          cos_breakdown   = EXCLUDED.cos_breakdown,
          synced_at       = now()
      `;
      upserted++;
    }

    return NextResponse.json({
      success: true,
      upserted,
      cutoff: cutoff.toISOString().slice(0, 7),
      projects: [...new Set([...agg.keys()].map(k => k.split('||')[0]))].sort(),
    });
  } catch (error) {
    console.error('[conduit/actuals/sync]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    );
  }
}
