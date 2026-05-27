/**
 * GET /api/staff/receipts-image?id=<UUID> — finance/HR streams a receipt image.
 *
 * Mirrors /api/my/receipts/[id]/download but for reviewers — gated by
 * receipts.review (admin session, not staff portal) and not staff_id-
 * scoped, since the whole point of the review queue is reading other
 * staff's receipts.
 *
 * Flat route (CLAUDE.md: avoid nested dynamic routes); the receipt UUID
 * comes in as a query param to keep the file at the same level as the
 * other staff-side receipts endpoints.
 *
 * Disposition is `inline` so the browser opens the image in a new tab
 * for visual verification, instead of forcing a download (the reviewer
 * just wants to see the slip).
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { withPermission } from '@/lib/auth/middleware';
import { findReceiptById } from '@/modules/receipts/queries';
import { resolveReceiptFetchUrl } from '@/modules/receipts/storage';

export const config = {
  api: { bodyParser: false },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extFromMime(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

async function streamUpstream(
  res: NextApiResponse,
  url: string,
  filename: string,
  fallbackMime: string
): Promise<void> {
  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    throw new Error(`Storage upstream ${upstream.status}`);
  }

  res.setHeader('Content-Type', upstream.headers.get('content-type') || fallbackMime);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const len = upstream.headers.get('content-length');
  if (len) res.setHeader('Content-Length', len);

  const reader = upstream.body.getReader();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) res.write(Buffer.from(value));
  }
  res.end();
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const idRaw = req.query.id;
  const id = typeof idRaw === 'string' ? idRaw : Array.isArray(idRaw) ? idRaw[0] : '';
  if (!id || !UUID_RE.test(id)) {
    return apiResponse.badRequest(res, 'id must be a UUID');
  }

  try {
    const row = await findReceiptById(id, null);
    if (!row || !row.image_url) {
      return apiResponse.notFound(res, 'Receipt', id);
    }

    const fetchUrl = resolveReceiptFetchUrl(row.image_url);
    const ext = extFromMime(row.image_mime);
    const filename = `receipt-${row.receipt_date}-${row.id}.${ext}`;

    await streamUpstream(res, fetchUrl, filename, row.image_mime || 'image/jpeg');
  } catch (err) {
    if (res.headersSent) {
      log.error('[staff/receipts-image] stream failed mid-response', {
        err,
        receiptId: id,
      });
      try {
        res.end();
      } catch (closeErr) {
        log.error('[staff/receipts-image] res.end failed', { closeErr });
      }
      return;
    }
    log.error('[staff/receipts-image] failed', { err, receiptId: id });
    return apiResponse.internalError(res, 'Failed to load receipt image');
  }
}

export default withAuth(withPermission('receipts.review', 'view')(handler));
