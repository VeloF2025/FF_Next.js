/**
 * GET /api/noc/tickets/[id]/historical-photos
 *
 * Aggregates photos tied to the ticket's DR and/or pole from every known
 * source: Activate QA (OneMap/BOSS), WhatsApp QA, Construction QA, SOW
 * pole photos, and raw QField validations. Each source runs in parallel
 * and failures are surfaced as per-group errors instead of failing the
 * whole request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getTicketById } from '@/modules/noc/services/ticketService';
import { gatherHistoricalPhotos } from '@/modules/noc/services/historicalPhotos';

const logger = createLogger('noc:api:tickets:historical-photos');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    {
      success: false,
      error: { code, message },
      meta: { timestamp: new Date().toISOString() },
    },
    { status }
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ticketId } = await params;

  if (!UUID_REGEX.test(ticketId)) {
    return errorResponse('VALIDATION_ERROR', 'Invalid ticket ID format. Must be a valid UUID.', 422);
  }

  try {
    const ticket = await getTicketById(ticketId);
    if (!ticket) {
      return errorResponse('NOT_FOUND', `Ticket '${ticketId}' not found`, 404);
    }

    const payload = await gatherHistoricalPhotos(ticket);

    logger.debug('Fetched historical photos', {
      ticketId,
      drNumber: payload.drNumber,
      poleNumber: payload.poleNumber,
      groupCounts: payload.groups.map((g) => ({ key: g.key, count: g.count, error: !!g.error })),
    });

    return NextResponse.json({
      success: true,
      data: payload,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    logger.error('Error gathering historical photos', { ticketId, error });
    return errorResponse(
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Failed to gather historical photos',
      500
    );
  }
}
