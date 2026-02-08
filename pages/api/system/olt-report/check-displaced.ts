/**
 * Check Displaced ONT Activation Status
 *
 * POST: Batch-check wrong serials against oes_activations
 *
 * Request body:
 * - serials: string[] (wrong ONT serials to check)
 *
 * Returns: Record<serial, { activated: boolean, ownerDr?: string, ownerTeam?: string, ownerStatus?: string }>
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';
import { log } from '@/lib/logger';

interface DisplacedResult {
  activated: boolean;
  ownerDr?: string;
  ownerTeam?: string;
  ownerStatus?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const { serials } = req.body as { serials: string[] };

  if (!Array.isArray(serials) || serials.length === 0) {
    return apiResponse.badRequest(res, 'serials array is required');
  }

  // Cap at 100 to prevent abuse
  const toCheck = serials.slice(0, 100).filter(Boolean);

  const client = await pool.connect();
  try {
    const results: Record<string, DisplacedResult> = {};

    // Batch query — look up all serials at once using UPPER for case-insensitive match
    const upperSerials = toCheck.map(s => s.toUpperCase());
    const placeholders = upperSerials.map((_, i) => `$${i + 1}`).join(', ');

    const lookup = await client.query(
      `SELECT DISTINCT ON (UPPER(serial_number))
              serial_number, drop_number, team, status
       FROM oes_activations
       WHERE UPPER(serial_number) IN (${placeholders})
       ORDER BY UPPER(serial_number), created_at DESC`,
      upperSerials
    );

    // Index results by uppercase serial
    const found = new Map<string, { drop_number: string; team: string; status: string }>();
    for (const row of lookup.rows) {
      found.set(row.serial_number.toUpperCase(), row);
    }

    // Build response for each requested serial
    for (const serial of toCheck) {
      const row = found.get(serial.toUpperCase());
      if (row) {
        results[serial] = {
          activated: true,
          ownerDr: row.drop_number,
          ownerTeam: row.team,
          ownerStatus: row.status,
        };
      } else {
        results[serial] = { activated: false };
      }
    }

    log.info('CheckDisplaced', `Checked ${toCheck.length} serials, ${lookup.rows.length} activated`, {
      checked: toCheck.length,
      activated: lookup.rows.length,
    });

    return apiResponse.success(res, results);
  } catch (error) {
    log.error('CheckDisplaced', 'Failed to check displaced serials', { error });
    return apiResponse.internalError(res, error);
  } finally {
    client.release();
  }
}

export default withAuth(withRole('manager')(handler));
