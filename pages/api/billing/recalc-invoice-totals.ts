/**
 * POST /api/billing/recalc-invoice-totals
 *
 * Backfill `price_per_drop`, `invoice_subtotal`, and `invoice_total` on any
 * `ft_weekly_billing` row that was imported before a project had an active
 * Client PO. Matches each row to the most recent active CPO for its project
 * (by name) and recomputes the invoice using the stored
 * `ft_total_claimable` + 15% tax.
 *
 * Rows that still have no active CPO are left alone and listed under
 * `skipped` in the response.
 *
 * Body (optional): { project?: string, weekEnding?: string } to scope the
 * backfill. Omit both to process every null-price row in the table.
 *
 * Super-admin only.
 */

import type { NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';

const logger = createLogger('api/billing/recalc-invoice-totals');

interface RecalcResult {
  billingWeekId: string;
  project: string;
  weekEnding: string;
  pricePerDrop: number;
  invoiceSubtotal: number;
  invoiceTotal: number;
}

interface SkippedRow {
  billingWeekId: string;
  project: string;
  weekEnding: string;
  reason: string;
}

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  try {
    const body = (req.body ?? {}) as { project?: string; weekEnding?: string };
    const projectFilter = body.project?.trim();
    const weekEndingFilter = body.weekEnding?.trim();

    // Find every row that needs a recalc. "Needs" = invoice_total is NULL
    // OR price_per_drop is NULL. Scope by project/weekEnding if provided.
    const rows = await pool.query<{
      id: string;
      project: string;
      week_ending: string;
      ft_total_claimable: string;
      tax_rate: string;
    }>(
      `SELECT id, project, week_ending::text, ft_total_claimable, tax_rate
         FROM ft_weekly_billing
        WHERE (invoice_total IS NULL OR price_per_drop IS NULL)
          AND ($1::text IS NULL OR project ILIKE $1)
          AND ($2::date IS NULL OR week_ending = $2::date)
        ORDER BY week_ending DESC, project ASC`,
      [projectFilter ?? null, weekEndingFilter ?? null],
    );

    const updated: RecalcResult[] = [];
    const skipped: SkippedRow[] = [];

    for (const row of rows.rows) {
      // Look up the most recent active CPO for this project by name.
      const cpo = await pool.query<{ price_per_drop: string }>(
        `SELECT cpo.price_per_drop
           FROM client_purchase_orders cpo
           JOIN projects p ON p.id = cpo.project_id
          WHERE p.project_name = $1
            AND cpo.status = 'active'
          ORDER BY cpo.created_at DESC
          LIMIT 1`,
        [row.project],
      );

      const price = cpo.rows[0]?.price_per_drop
        ? parseFloat(cpo.rows[0].price_per_drop)
        : null;
      if (price === null) {
        skipped.push({
          billingWeekId: row.id,
          project: row.project,
          weekEnding: row.week_ending,
          reason: `No active CPO for project "${row.project}"`,
        });
        continue;
      }

      const claimable = parseFloat(row.ft_total_claimable);
      const taxRate = parseFloat(row.tax_rate ?? '15');
      const invoiceSubtotal = claimable * price;
      const invoiceTotal = invoiceSubtotal * (1 + taxRate / 100);

      await pool.query(
        `UPDATE ft_weekly_billing
            SET price_per_drop   = $1,
                invoice_subtotal = $2,
                invoice_total    = $3,
                updated_at       = NOW()
          WHERE id = $4`,
        [price, invoiceSubtotal, invoiceTotal, row.id],
      );

      updated.push({
        billingWeekId: row.id,
        project: row.project,
        weekEnding: row.week_ending,
        pricePerDrop: price,
        invoiceSubtotal,
        invoiceTotal,
      });
    }

    logger.info('Invoice total recalc complete', {
      scannedRows: rows.rows.length,
      updatedCount: updated.length,
      skippedCount: skipped.length,
      projectFilter: projectFilter ?? null,
      weekEndingFilter: weekEndingFilter ?? null,
    });

    return apiResponse.success(res, {
      scannedRows: rows.rows.length,
      updated,
      skipped,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Recalc failed';
    logger.error('recalc-invoice-totals failed', { error: message });
    return res.status(500).json({ success: false, error: message });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default withAuth(withRole('super_admin')(handler as any));
