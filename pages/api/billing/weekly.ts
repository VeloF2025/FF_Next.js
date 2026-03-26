/**
 * API Route: /api/billing/weekly
 *
 * Purpose: List ft_weekly_billing rows, optionally filtered by project and/or status.
 *
 * Method: GET
 *
 * Query params:
 *   project  - (optional) Project name (case-insensitive substring match)
 *   status   - (optional) 'pending' | 'reconciled' | 'disputed'
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';

const logger = createLogger('api/billing/weekly');

// ─── Row Type ─────────────────────────────────────────────────────────────────

interface WeeklyBillingRow {
  id: string;
  week_ending: string;
  project: string;
  ft_total_onts: number;
  ft_previously_invoiced: number;
  ft_claimable: number;
  ft_note1_count: number;
  ft_note2_count: number;
  ft_note3_count: number;
  ft_note4_count: number;
  ft_note5_count: number;
  ft_pre_provisions_count: number;
  ft_total_claimable: number;
  price_per_drop: string | null;
  tax_rate: string | null;
  invoice_subtotal: string | null;
  invoice_total: string | null;
  our_total_activations: number | null;
  our_claimable: number | null;
  variance_claimable: number | null;
  variance_total_onts: number | null;
  reconciliation_status: 'pending' | 'reconciled' | 'disputed';
  reconciled_at: string | null;
  reconciled_by: string | null;
  pdf_filename: string | null;
  notes_xlsx_filename: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  created_at: string;
  updated_at: string;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const { project, status } = req.query;

    const projectFilter = typeof project === 'string' ? project.trim() : null;
    const statusFilter =
      typeof status === 'string' &&
      ['pending', 'reconciled', 'disputed'].includes(status)
        ? status
        : null;

    // Build parameterised query with optional filters
    const params: (string | null)[] = [];
    const conditions: string[] = [];

    if (projectFilter) {
      params.push(`%${projectFilter}%`);
      conditions.push(`project ILIKE $${params.length}`);
    }

    if (statusFilter) {
      params.push(statusFilter);
      conditions.push(`reconciliation_status = $${params.length}`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query<WeeklyBillingRow>(
      `SELECT
         id,
         week_ending,
         project,
         ft_total_onts,
         ft_previously_invoiced,
         ft_claimable,
         ft_note1_count,
         ft_note2_count,
         ft_note3_count,
         ft_note4_count,
         ft_note5_count,
         ft_pre_provisions_count,
         ft_total_claimable,
         price_per_drop,
         tax_rate,
         invoice_subtotal,
         invoice_total,
         our_total_activations,
         our_claimable,
         variance_claimable,
         variance_total_onts,
         reconciliation_status,
         reconciled_at,
         reconciled_by,
         pdf_filename,
         notes_xlsx_filename,
         uploaded_by,
         uploaded_at,
         created_at,
         updated_at
       FROM ft_weekly_billing
       ${whereClause}
       ORDER BY week_ending DESC, project ASC`,
      params
    );

    logger.info('Listed weekly billing rows', {
      count: result.rows.length,
      projectFilter,
      statusFilter,
    });

    return apiResponse.success(res, result.rows);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list billing weeks';
    logger.error('weekly list failed', { error: message });
    return res.status(500).json({ success: false, error: message });
  }
}

export default withAuth(handler);
