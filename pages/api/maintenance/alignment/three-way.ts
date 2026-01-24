/**
 * Three-Way Alignment Report Endpoint
 * 🟢 WORKING: Compares Excel (source of truth), FibreFlow, and QContact tickets
 *
 * @endpoint POST /api/maintenance/alignment/three-way
 *
 * Request body:
 * - rows: any[][] - Parsed Excel rows (excluding header)
 * - headers: string[] (optional) - Column headers for index detection
 *
 * Response:
 * - ThreeWayAlignmentReport with sources, summary, details, and suggested_actions
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import {
  parseExcelTickets,
  generateThreeWayAlignmentReport,
} from '@/modules/maintenance/services/threeWayAlignmentService';
import { withAuth } from '@/lib/auth';

const logger = createLogger('maintenance:three-way-alignment');

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown');
  }

  try {
    const { rows, headers } = req.body;

    if (!rows || !Array.isArray(rows)) {
      return apiResponse.badRequest(res, 'Missing or invalid rows array');
    }

    logger.info('Generating 3-way alignment report', {
      rowCount: rows.length,
      hasHeaders: !!headers,
    });

    // Parse Excel data
    const excelTickets = parseExcelTickets(rows, headers);

    logger.info('Parsed Excel tickets', { count: excelTickets.length });

    if (excelTickets.length === 0) {
      return apiResponse.badRequest(
        res,
        'No valid tickets found in Excel data. Ensure FT Ref column contains FT* references.'
      );
    }

    // Generate alignment report
    const report = await generateThreeWayAlignmentReport(excelTickets);

    logger.info('Alignment report generated', {
      summary: report.summary,
      actionsCount: report.suggested_actions.length,
    });

    return apiResponse.success(res, report);
  } catch (error) {
    logger.error('Failed to generate 3-way alignment report', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
