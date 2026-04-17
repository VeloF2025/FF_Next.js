/**
 * GET /api/noc/tickets/[id]/report — streams a PDF of the ticket's
 * resolution report with VLM-generated photo captions.
 *
 * First run for a given ticket hits the VLM once per photo to generate the
 * caption; subsequent runs reuse the cached caption on the attachment row
 * (see migration 307). Typical ticket with ~5 photos takes 15–30s on first
 * run, <1s after.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { buildTicketReportData } from '@/modules/noc/services/ticketReportService';
import { generateTicketReportPdf } from '@/modules/noc/utils/ticketReportPdf';

const logger = createLogger('noc:api:ticket-report');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const runtime = 'nodejs';
// The VLM loop plus image download is well under 90s in practice but we
// give ourselves headroom for first-run large tickets.
export const maxDuration = 180;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ticketId = params.id;

  if (!UUID_REGEX.test(ticketId)) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid ticket ID format' },
      },
      { status: 422 }
    );
  }

  // Allow callers to bust the VLM caption cache — used after prompt tweaks.
  const regenerateCaptions = new URL(req.url).searchParams.get('regenerate') === 'true';

  try {
    logger.info('Generating ticket report', { ticketId, regenerateCaptions });

    const data = await buildTicketReportData(ticketId, { regenerateCaptions });
    const pdfBuffer = await generateTicketReportPdf(data);

    const filename = `ticket-report-${data.ticket.ticketUid}.pdf`;
    // Wrap the buffer in a Blob — satisfies BodyInit cleanly across Next.js
    // TS shims and avoids the Uint8Array/ArrayBufferView unions that keep
    // drifting between Node and Web runtime typings.
    const blob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' });

    return new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length': String(pdfBuffer.byteLength),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Ticket report generation failed', { ticketId, error: message });

    if (message.includes('not found')) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'NOT_FOUND', message: `Ticket ${ticketId} not found` },
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'REPORT_GENERATION_FAILED',
          message: 'Failed to generate report',
          detail: message,
        },
      },
      { status: 500 }
    );
  }
}
