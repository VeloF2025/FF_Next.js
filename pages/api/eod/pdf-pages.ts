/**
 * EOD PDF-to-Images API
 * POST: Convert a PDF (base64) into per-page JPEG images (base64).
 *       Ghostscript must be available on the server (it is on Velocity).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { fromBase64 } from 'pdf2pic';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const { pdf } = req.body as { pdf?: string };
  if (!pdf || typeof pdf !== 'string') {
    return apiResponse.badRequest(res, 'Missing pdf (base64 string)');
  }

  try {
    const convert = fromBase64(pdf, {
      density: 150,
      format: 'jpeg',
      width: 1280,
      preserveAspectRatio: true,
    });

    // -1 converts all pages
    const results = await convert.bulk(-1, { responseType: 'base64' });

    const pages = results
      .filter((r) => r.base64)
      .map((r) => ({ pageNumber: r.page ?? 1, base64: r.base64! }));

    if (pages.length === 0) {
      return apiResponse.internalError(res, new Error('PDF rendered 0 pages'), 'PDF conversion failed');
    }

    log.info('[EOD-PDF] Converted PDF to images', { pages: pages.length });
    return apiResponse.success(res, { pages });
  } catch (err) {
    log.error('[EOD-PDF] Conversion failed', { error: err });
    return apiResponse.internalError(res, err, 'PDF conversion failed');
  }
}

export default withAuth(handler);

export const config = {
  api: { bodyParser: { sizeLimit: '25mb' } },
};
