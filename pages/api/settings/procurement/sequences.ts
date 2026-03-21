/**
 * Procurement Number Sequences Settings API
 *
 * GET: Returns all number sequence configurations
 * PUT: Updates sequence settings
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleGet(res);
  }

  if (req.method === 'PUT') {
    return handlePut(req, res);
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PUT']);
}

async function handleGet(res: NextApiResponse) {
  try {
    const sequences = await sql`
      SELECT
        id, entity_type, prefix, next_number, padding, reset_period, last_reset_at
      FROM procurement_sequences
      ORDER BY entity_type
    `;

    const result = sequences.map((s: Record<string, unknown>) => {
      const next = s.next_number as number;
      const pad = s.padding as number;
      const yearPrefix = new Date().getFullYear().toString().slice(-2);
      const preview = `${s.prefix}${yearPrefix}-${String(next).padStart(pad, '0')}`;

      return {
        id: s.id,
        entityType: s.entity_type,
        prefix: s.prefix,
        nextNumber: next,
        padding: pad,
        resetPeriod: s.reset_period,
        lastResetAt: s.last_reset_at,
        preview,
      };
    });

    return apiResponse.success(res, { sequences: result });
  } catch (error) {
    log.error('Failed to fetch procurement sequences', { error });
    return apiResponse.databaseError(res, error, 'Failed to fetch sequences');
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { sequences } = req.body;

    if (!sequences || !Array.isArray(sequences)) {
      return apiResponse.badRequest(res, 'sequences array is required');
    }

    for (const seq of sequences) {
      if (!seq.id) continue;

      await sql`
        UPDATE procurement_sequences
        SET
          prefix = COALESCE(${seq.prefix ?? null}, prefix),
          padding = COALESCE(${seq.padding ?? null}, padding),
          reset_period = COALESCE(${seq.resetPeriod ?? null}, reset_period),
          updated_at = NOW()
        WHERE id = ${seq.id}
      `;
    }

    log.info('Procurement sequences updated', { count: sequences.length });
    return apiResponse.success(res, { message: 'Sequences updated successfully' });
  } catch (error) {
    log.error('Failed to update procurement sequences', { error });
    return apiResponse.databaseError(res, error, 'Failed to update sequences');
  }
}

export default withAuth(handler);
