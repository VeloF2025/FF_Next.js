/**
 * GET /api/my/payslips/[id]/download — stream the PDF for a single payslip.
 *
 * PRD-040 Phase 3 / PR2. The PDF URL stored on the payslip row is a
 * VF Storage public path (anyone-with-the-link). For POPIA we never
 * expose that URL to the client; instead this endpoint:
 *
 *   1. Verifies the signed-in staff owns the payslip (findPayslipById
 *      with staffIdScope = session.staffId returns null on mismatch,
 *      surfaced as 404 — same response as a non-existent payslip so
 *      we don't leak existence to other staff via the ID).
 *   2. Fetches the PDF from VF Storage server-side.
 *   3. Streams it back to the client with Content-Disposition: attachment.
 *
 * Net effect: the staff downloads through their /my session; the storage
 * URL never reaches their browser, can't be forwarded, can't be bookmarked.
 */

import type { NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { findPayslipById } from '@/modules/payslips/queries';
import { resolvePayslipFetchUrl } from '@/modules/payslips/storage';

export const config = {
  api: { bodyParser: false },
};

function periodLabel(start: string, end: string): string {
  // Both dates are 'YYYY-MM-DD'. If they fall in the same month, use
  // "YYYY-MM"; otherwise show the start month for the filename.
  const startMonth = start.slice(0, 7);
  const endMonth = end.slice(0, 7);
  return startMonth === endMonth ? startMonth : `${startMonth}_${endMonth}`;
}

async function streamPdf(
  res: NextApiResponse,
  pdfUrl: string,
  downloadFilename: string
): Promise<void> {
  const upstream = await fetch(pdfUrl);
  if (!upstream.ok || !upstream.body) {
    throw new Error(`Storage upstream ${upstream.status}`);
  }

  const contentType = upstream.headers.get('content-type') || 'application/pdf';
  const contentLength = upstream.headers.get('content-length');

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (contentLength) res.setHeader('Content-Length', contentLength);

  // Convert the WHATWG ReadableStream to a Node Buffer in chunks. The
  // ergonomic alternative (Readable.fromWeb) requires a newer Node API
  // surface than this codebase otherwise relies on; sticking with the
  // explicit reader keeps behaviour predictable across the Node versions
  // we deploy on.
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
    return apiResponse.badRequest(res, 'Missing payslip id');
  }

  try {
    const payslip = await findPayslipById(id, session.staffId);
    if (!payslip) {
      // Not found OR not owned. Don't differentiate — same response.
      return apiResponse.notFound(res, 'Payslip', id);
    }
    if (!payslip.pdf_url) {
      return apiResponse.notFound(res, 'Payslip PDF', id);
    }

    const filename = `payslip-${periodLabel(
      payslip.pay_period_start,
      payslip.pay_period_end
    )}.pdf`;

    const fetchUrl = resolvePayslipFetchUrl(payslip.pdf_url);
    await streamPdf(res, fetchUrl, filename);
  } catch (error) {
    if (res.headersSent) {
      // Stream already started; we can't send a JSON envelope. Just close.
      log.error('[my/payslips/download] stream failed mid-response', {
        error,
        staffId: session.staffId,
        payslipId: id,
      });
      try {
        res.end();
      } catch (closeErr) {
        log.error('[my/payslips/download] res.end failed after stream error', {
          closeErr,
          staffId: session.staffId,
          payslipId: id,
        });
      }
      return;
    }
    log.error('[my/payslips/download] failed', {
      error,
      staffId: session.staffId,
      payslipId: id,
    });
    return apiResponse.internalError(res, 'Failed to download payslip');
  }
});
