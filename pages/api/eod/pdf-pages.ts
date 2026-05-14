/**
 * EOD PDF-to-Images API
 * POST: Convert a PDF (base64) into per-page JPEG images (base64).
 *       Uses Ghostscript directly — avoids pdf2pic's GraphicsMagick/ImageMagick
 *       %p page-numbering incompatibility. gs is installed on Velocity.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, readdir, mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const MAX_PAGES = 50;

const execFileAsync = promisify(execFile);

async function pdfToJpegPages(
  pdfBase64: string,
): Promise<Array<{ pageNumber: number; base64: string }>> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'eod-pdf-'));
  const pdfPath = join(tmpDir, 'input.pdf');

  try {
    await writeFile(pdfPath, Buffer.from(pdfBase64, 'base64'));

    // 600 DPI gives ~4px per bar on Code-128 stickers — comfortable headroom
    // for zxing on the full-res image and for VLM OCR on handwritten DR /
    // Gizzu serial digits. The downstream optimizeForVlm step still
    // downsamples to 1280x960 for the main pass, so the cost is contained to
    // PDF rasterisation + barcode-variant generation.
    await execFileAsync(
      'gs',
      [
        '-sDEVICE=jpeg',
        '-r600',
        '-dBATCH',
        '-dNOPAUSE',
        '-q',
        `-dLastPage=${MAX_PAGES}`,
        `-sOutputFile=${join(tmpDir, 'page-%d.jpg')}`,
        pdfPath,
      ],
      { timeout: 180000 },
    );

    const files: string[] = await readdir(tmpDir);
    const pageFiles = files
      .filter((f: string) => /^page-\d+\.jpg$/.test(f))
      .sort((a: string, b: string) => {
        const na = parseInt(/(\d+)/.exec(a)?.[1] ?? '0', 10);
        const nb = parseInt(/(\d+)/.exec(b)?.[1] ?? '0', 10);
        return na - nb;
      });

    return Promise.all(
      pageFiles.map(async (f, idx) => {
        const data = await readFile(join(tmpDir, f));
        return { pageNumber: idx + 1, base64: data.toString('base64') };
      }),
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch((e: unknown) =>
      log.warn('[EOD-PDF] Failed to clean up tmpDir', { tmpDir, err: e }),
    );
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const { pdf } = req.body as { pdf?: string };
  if (!pdf || typeof pdf !== 'string') {
    return apiResponse.badRequest(res, 'Missing pdf (base64 string)');
  }

  const rawBase64 = pdf.includes(',') ? pdf.split(',')[1]! : pdf;

  try {
    const pages = await pdfToJpegPages(rawBase64);

    if (pages.length === 0) {
      return apiResponse.internalError(
        res,
        new Error('PDF rendered 0 pages'),
        'PDF conversion failed',
      );
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
