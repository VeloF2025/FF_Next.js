/**
 * GET /api/photo-guide/site/:id
 *
 * Look up a DR number or pole number and return display info for the PWA.
 * DR format: DR-XXXXXX or numeric only.
 * Pole format: anything else (checked against the poles table).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);

  const { id } = req.query;
  if (!id || typeof id !== 'string') return apiResponse.badRequest(res, 'Site ID required');

  const normalized = id.trim().toUpperCase();

  // DR lookup — accepts "DR-123456" or bare "123456"
  if (/^(DR-?)?\d+$/.test(normalized)) {
    const drNum = normalized.replace(/^DR-?/, '');
    const { rows } = await pool.query<{
      drop_number: string;
      customer_name: string | null;
      address: string | null;
      project_name: string | null;
    }>(
      `SELECT d.drop_number,
              d.customer_name,
              d.address,
              p.project_name
       FROM drops d
       LEFT JOIN projects p ON p.id = d.project_id
       WHERE d.drop_number = $1
       LIMIT 1`,
      [drNum]
    );
    if (!rows[0]) return apiResponse.notFound(res, 'DR', normalized);
    const r = rows[0];
    return apiResponse.success(res, {
      jobType: 'activations',
      siteId: `DR-${r.drop_number}`,
      customerName: r.customer_name ?? null,
      address: r.address ?? null,
      projectName: r.project_name ?? null,
    });
  }

  // Pole lookup
  const { rows } = await pool.query<{
    pole_number: string;
    project_name: string | null;
  }>(
    `SELECT po.pole_number,
            p.project_name
     FROM poles po
     LEFT JOIN projects p ON p.id = po.project_id
     WHERE po.pole_number = $1
     LIMIT 1`,
    [normalized]
  );
  if (!rows[0]) return apiResponse.notFound(res, 'Pole', normalized);
  const r = rows[0];
  return apiResponse.success(res, {
    jobType: 'civils',
    siteId: r.pole_number,
    customerName: null,
    address: null,
    projectName: r.project_name ?? null,
  });
}

export default withAuth(handler);
