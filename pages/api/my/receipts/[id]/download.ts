/**
 * GET /api/my/receipts/[id]/download — stream the receipt image/PDF.
 *
 * Mirrors /api/my/payslips/[id]/download. The VF Storage URL is never
 * exposed to the client — we proxy the bytes after enforcing
 * staff_id ownership (404 on cross-staff access, no enumeration).
 */

import type { NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { findReceiptById } from '@/modules/receipts/queries';
import { resolveReceiptFetchUrl } from '@/modules/receipts/storage';

export const config = {
  api: { bodyParser: false },
};

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
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
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

export default withMySession(async (req, res, session) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const { id } = req.query;
  if (typeof id !== 'string' || id.length === 0) {
    return apiResponse.badRequest(res, 'Missing receipt id');
  }

  try {
    const row = await findReceiptById(id, session.staffId);
    if (!row || !row.image_url) {
      return apiResponse.notFound(res, 'Receipt', id);
    }

    const fetchUrl = resolveReceiptFetchUrl(row.image_url);
    const ext = extFromMime(row.image_mime);
    const filename = `receipt-${row.receipt_date}-${row.id}.${ext}`;

    await streamUpstream(res, fetchUrl, filename, row.image_mime || 'image/jpeg');
  } catch (err) {
    if (res.headersSent) {
      log.error('[my/receipts/download] stream failed mid-response', {
        err,
        staffId: session.staffId,
        receiptId: id,
      });
      try {
        res.end();
      } catch (closeErr) {
        log.error('[my/receipts/download] res.end failed', { closeErr });
      }
      return;
    }
    log.error('[my/receipts/download] failed', { err, staffId: session.staffId, receiptId: id });
    return apiResponse.internalError(res, 'Failed to download receipt');
  }
});
