/**
 * Year-End Export API
 * GET — export fiscal year summaries as CSV
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

function csvCell(v: string): string { return `"${String(v || '').replace(/"/g, '""')}"`; }

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);

  try {
    const rows = await sql`
      SELECT year_label, start_date, end_date, status
      FROM fiscal_years ORDER BY start_date DESC
    `;

    const csvLines = [
      'Year,Start Date,End Date,Status',
      ...rows.map((r: Record<string, unknown>) => [
        csvCell(String(r.year_label)),
        csvCell(String(r.start_date)),
        csvCell(String(r.end_date)),
        csvCell(String(r.status)),
      ].join(',')),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="year-end-${new Date().toISOString().split('T')[0]}.csv"`);
    return res.status(200).send(csvLines.join('\n'));
  } catch (err) {
    log.error('Year-end export failed', { error: err });
    return apiResponse.badRequest(res, 'Failed to export year-end data');
  }
}

export default withAuth(handler);
