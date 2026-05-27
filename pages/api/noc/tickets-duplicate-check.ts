/**
 * Duplicate Ticket Check
 * GET /api/noc/tickets-duplicate-check?dr_number=&ont_serial=&pole_number=
 *
 * Returns open maintenance tickets that already cover the given DR, ONT
 * serial, or pole. Callers (non-invoiceables UI, weekly-billing helpers,
 * create-ticket endpoints) use this to avoid creating duplicate work.
 *
 * Flat filename (hyphen, not a nested `tickets/` dir) to stay consistent
 * with the existing pages/api/noc layout.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { findDuplicateTickets } from '@/modules/noc/services/duplicateTicketService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  }

  const dr = typeof req.query.dr_number === 'string' ? req.query.dr_number : undefined;
  const serial = typeof req.query.ont_serial === 'string' ? req.query.ont_serial : undefined;
  const pole = typeof req.query.pole_number === 'string' ? req.query.pole_number : undefined;

  if (!dr && !serial && !pole) {
    return apiResponse.badRequest(
      res,
      'At least one of dr_number, ont_serial, pole_number is required',
    );
  }

  try {
    const duplicates = await findDuplicateTickets({
      drNumber: dr,
      ontSerial: serial,
      poleNumber: pole,
    });

    return apiResponse.success(res, {
      duplicates,
      has_duplicates: duplicates.length > 0,
    });
  } catch (error) {
    log.error('Duplicate ticket check failed', {
      data: { error: error instanceof Error ? error.message : String(error), dr, serial, pole },
    });
    return apiResponse.internalError(res, 'Failed to check for duplicate tickets');
  }
}

export default withAuth(handler);
