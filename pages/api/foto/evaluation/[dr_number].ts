/**
 * GET /api/foto/evaluation/[dr_number]
 * Fetch cached evaluation for a specific DR from database
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { getEvaluationByDR } from '@/modules/photo-review/services/fotoDbService';
import { validateDrNumber } from '@/modules/photo-review/utils/drValidator';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { dr_number } = req.query;

    // Validate DR number format and check for SQL injection
    const validation = validateDrNumber(
      typeof dr_number === 'string' ? dr_number : undefined
    );

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid DR number',
        message: validation.error,
      });
    }

    // Use sanitized DR number (trimmed and uppercase)
    const sanitizedDr = validation.sanitized!;

    // Fetch from database
    const evaluation = await getEvaluationByDR(sanitizedDr);

    if (!evaluation) {
      return res.status(404).json({
        error: 'No evaluation found',
        message: `No evaluation found for DR ${sanitizedDr}`,
      });
    }

    return res.status(200).json({
      success: true,
      data: evaluation,
    });
  } catch (error) {
    console.error('Error fetching evaluation:', error);
    return res.status(500).json({
      error: 'Failed to fetch evaluation',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default withAuth(handler);
