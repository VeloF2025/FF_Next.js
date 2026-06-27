/**
 * POST /api/noc/tickets/[id]/analyze-screenshot
 * Uploads 1map screenshot(s), runs the VLM, and auto-posts a note with the
 * screenshots attached. On any failure NO note is posted.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth/jwt';
import { createLogger } from '@/lib/logger';
import pool from '@/lib/db';
import { vfStorage } from '@/services/vfStorageAdapter';
import { analyzeInstallScreenshots } from '@/modules/noc/services/screenshotNoteVlmClient';
import { composeNoteBody, type TicketCrossRef } from '@/modules/noc/services/screenshotNoteAnalysis';
import { createTicketNote } from '@/modules/noc/services/ticketNotesService';

const logger = createLogger('noc:analyze-screenshot');
const MAX_IMAGES = 4;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: ticketId } = await params;
  try {
    if (!ticketId) {
      return NextResponse.json({ success: false, error: { message: 'Ticket ID is required' } }, { status: 400 });
    }

    const body = await request.json();
    const visibility: 'private' | 'public' = body.visibility === 'public' ? 'public' : 'private';
    const rawImages: unknown = body.images;
    if (!Array.isArray(rawImages) || rawImages.length === 0) {
      return NextResponse.json({ success: false, error: { message: 'At least one image is required' } }, { status: 400 });
    }
    if (rawImages.length > MAX_IMAGES) {
      return NextResponse.json({ success: false, error: { message: `Maximum ${MAX_IMAGES} images per analysis` } }, { status: 400 });
    }
    const dataUrls = rawImages.filter(
      (x): x is string => typeof x === 'string' && x.startsWith('data:image/'),
    );
    if (dataUrls.length === 0) {
      return NextResponse.json({ success: false, error: { message: 'Images must be base64 image data URLs' } }, { status: 400 });
    }

    // Best-effort acting user (created_by is nullable).
    let createdBy: string | null = null;
    try {
      const token = (await cookies()).get('ff_auth_token')?.value;
      if (token) {
        const jwt = await verifyToken(token);
        if (jwt) createdBy = jwt.sub;
      }
    } catch {
      /* unauthenticated context — leave createdBy null */
    }

    // Ticket cross-reference context for the prompt.
    const ctxRows = await pool.query(
      'SELECT dr_number, pole_id, pon, ont_serial FROM maintenance_tickets WHERE id = $1',
      [ticketId],
    );
    if (ctxRows.rows.length === 0) {
      return NextResponse.json({ success: false, error: { message: 'Ticket not found' } }, { status: 404 });
    }
    const r = ctxRows.rows[0];
    const ctx: TicketCrossRef = {
      dr_number: r.dr_number ?? null,
      pole_number: r.pole_id ?? null,
      pon_number: r.pon ?? null,
      ont_serial: r.ont_serial ?? null,
    };

    // Upload screenshots first; abort (no note) if any upload fails.
    const storageUrls: string[] = [];
    for (let i = 0; i < dataUrls.length; i++) {
      const base64 = dataUrls[i]!.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const uploaded = await vfStorage.uploadFile(
        buffer, 'maintenance', 'ticket-screenshots', `${ticketId}_${Date.now()}_${i}.jpg`,
      );
      storageUrls.push(uploaded.url);
    }

    // VLM analysis over all images at once, then compose the note body.
    const analysis = await analyzeInstallScreenshots(dataUrls, ctx);
    const content = composeNoteBody(analysis, ctx);

    const result = await createTicketNote({
      ticketId,
      content,
      visibility,
      noteType: 'system',
      attachments: storageUrls,
      createdBy,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: { message: result.message } }, { status: result.status });
    }

    logger.info('Posted AI screenshot note', {
      ticketId, noteId: result.note.id, images: storageUrls.length,
      is1map: analysis.is_1map_screenshot, confidence: analysis.confidence,
    });
    return NextResponse.json({ success: true, data: result.note });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const detail = err instanceof Error ? err.message : 'Unknown error';
    logger.error('AI screenshot note failed', { ticketId, error: detail });
    return NextResponse.json(
      {
        success: false,
        error: {
          message: isTimeout
            ? 'VLM analysis timed out — no note was posted.'
            : 'Screenshot analysis failed — no note was posted.',
          details: detail,
        },
      },
      { status: isTimeout ? 504 : 500 },
    );
  }
}
