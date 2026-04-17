/**
 * GET /api/activate/dr/[dropNumber]/pdf-context
 *
 * Returns the enrichment block the DR Timeline PDF header needs:
 * project, team, latest OES serial + activation, last 1Map fix attempt,
 * latest FT billing flag for this DR.
 *
 * Best-effort — every field can be null; the PDF generator handles
 * missing values with em dashes.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';

const logger = createLogger('api/activate/dr/pdf-context');

interface PdfContext {
  drNumber: string;
  project: string | null;
  team: string | null;
  oesSerial: string | null;
  oesActivatedAt: string | null;
  lastFixSerial: string | null;
  lastFixAt: string | null;
  latestBillingNote: string | null;
  latestBillingWeek: string | null;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const drNumber = String(req.query.dropNumber ?? '');
  if (!drNumber) return apiResponse.badRequest(res, 'dropNumber is required');

  try {
    const { rows } = await pool.query<{
      project: string | null;
      oes_team: string | null;
      oes_serial: string | null;
      oes_activated_at: string | null;
      last_fix_serial: string | null;
      last_fix_at: string | null;
      latest_billing_note: string | null;
      latest_billing_week: string | null;
    }>(
      `
      SELECT
        (SELECT p.project_name FROM drops d
           LEFT JOIN projects p ON p.id = d.project_id
          WHERE d.drop_number = $1 LIMIT 1)                                  AS project,
        (SELECT team FROM oes_activations
          WHERE drop_number = $1
          ORDER BY COALESCE(activation_datetime, created_at) DESC LIMIT 1)   AS oes_team,
        (SELECT serial_number FROM oes_activations
          WHERE drop_number = $1
          ORDER BY COALESCE(activation_datetime, created_at) DESC LIMIT 1)   AS oes_serial,
        (SELECT activation_date::text FROM oes_activations
          WHERE drop_number = $1
          ORDER BY COALESCE(activation_datetime, created_at) DESC LIMIT 1)   AS oes_activated_at,
        (SELECT new_value FROM serial_change_history
          WHERE drop_number = $1 AND change_source = 'olt_report_fix'
                                 AND change_type   = 'ont_serial'
          ORDER BY created_at DESC LIMIT 1)                                  AS last_fix_serial,
        (SELECT created_at::text FROM serial_change_history
          WHERE drop_number = $1 AND change_source = 'olt_report_fix'
                                 AND change_type   = 'ont_serial'
          ORDER BY created_at DESC LIMIT 1)                                  AS last_fix_at,
        (SELECT deduction_note FROM ft_billing_deductions
          WHERE dr_number = $1
          ORDER BY week_ending DESC LIMIT 1)                                 AS latest_billing_note,
        (SELECT week_ending::text FROM ft_billing_deductions
          WHERE dr_number = $1
          ORDER BY week_ending DESC LIMIT 1)                                 AS latest_billing_week
      `,
      [drNumber],
    );

    const r = rows[0];
    const payload: PdfContext = {
      drNumber,
      project: r?.project ?? null,
      team: r?.oes_team ?? null,
      oesSerial: r?.oes_serial ?? null,
      oesActivatedAt: r?.oes_activated_at ?? null,
      lastFixSerial: r?.last_fix_serial ?? null,
      lastFixAt: r?.last_fix_at ?? null,
      latestBillingNote: r?.latest_billing_note ?? null,
      latestBillingWeek: r?.latest_billing_week ?? null,
    };

    return apiResponse.success(res, payload);
  } catch (err) {
    logger.error('pdf-context failed', { error: err instanceof Error ? err.message : String(err), drNumber });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
