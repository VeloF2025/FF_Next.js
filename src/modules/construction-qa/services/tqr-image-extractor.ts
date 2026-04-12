/**
 * TQR Image Extractor
 *
 * Runs pdfimages -j and -list to extract JPEG photos from a TQR PDF,
 * filters to snag-grid photos only (pages 3-7, width > 300),
 * uploads each to VF Storage, and returns ordered URLs.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH (validated against real TQR 0012/2026)
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { log } from '@/lib/logger';

// ============================================================
// Types
// ============================================================

export interface ExtractedImage {
  /** 0-based index within the full pdfimages list */
  imageIndex: number;
  /** PDF page number (1-based) */
  page: number;
  /** Pixel width */
  width: number;
  /** Pixel height */
  height: number;
  /** Absolute path to extracted JPEG on disk */
  filePath: string;
  /** Filename only */
  filename: string;
}

export interface UploadedSnagPhoto {
  /** Ordered position in the snag photo grid (0-based) */
  gridIndex: number;
  /** Public URL in VF Storage */
  url: string;
  /** Original filename */
  filename: string;
}

// ============================================================
// Image List Parser
// ============================================================

interface ImageListEntry {
  page: number;
  index: number;
  type: string;
  width: number;
  height: number;
  enc: string;
}

/**
 * Run `pdfimages -list` and parse the tabular output.
 * Returns one entry per image row (skips header lines).
 */
export function listPdfImages(pdfPath: string): ImageListEntry[] {
  const rawOutput = execSync(`/usr/bin/pdfimages -list "${pdfPath}"`, {
    encoding: 'utf-8',
    timeout: 60_000,
  });

  const entries: ImageListEntry[] = [];
  const lines = rawOutput.split('\n');

  // Skip header (first 2 lines: column names + separator)
  for (const line of lines.slice(2)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 8) continue;

    const page   = parseInt(parts[0] ?? '', 10);
    const index  = parseInt(parts[1] ?? '', 10);
    const type   = parts[2] ?? '';
    const width  = parseInt(parts[3] ?? '', 10);
    const height = parseInt(parts[4] ?? '', 10);
    const enc    = parts[8] ?? '';

    if (isNaN(page) || isNaN(index)) continue;
    entries.push({ page, index, type, width, height, enc });
  }

  return entries;
}

// ============================================================
// Image Extraction Filter
// ============================================================

/**
 * Identify snag-grid photos from the pdfimages list.
 *
 * Criteria (from TQR format analysis):
 * - Page is 3, 4, 5, 6, or 7
 * - Image type is "image" (not "smask")
 * - Encoding is "jpeg"
 * - Width > 300 (snag photos are ~415px wide; compliance photos are ~312px but on page 8)
 */
export function filterSnagPhotos(entries: ImageListEntry[]): ImageListEntry[] {
  return entries.filter(
    (e) =>
      e.page >= 3 &&
      e.page <= 7 &&
      e.type === 'image' &&
      e.enc === 'jpeg' &&
      e.width > 300
  );
}

// ============================================================
// JPEG Extraction
// ============================================================

/**
 * Run `pdfimages -j` to extract all JPEGs, then return paths for the
 * filtered snag entries (matched by sorted order within jpeg files).
 *
 * pdfimages -j names files <prefix>-NNN.jpg where NNN is the image index.
 */
export function extractJpegs(
  pdfPath: string,
  outputDir: string,
  snagEntries: ImageListEntry[]
): ExtractedImage[] {
  // Extract all images as JPEG
  execSync(`/usr/bin/pdfimages -j "${pdfPath}" "${path.join(outputDir, 'img')}"`, {
    timeout: 120_000,
  });

  const results: ExtractedImage[] = [];

  for (const entry of snagEntries) {
    // pdfimages pads the index with 3 digits minimum: img-000.jpg, img-001.jpg, etc.
    const paddedIndex = String(entry.index).padStart(3, '0');
    const candidate = path.join(outputDir, `img-${paddedIndex}.jpg`);

    if (!fs.existsSync(candidate)) {
      log.warn('TqrImageExtractor: expected JPEG not found', {
        candidate,
        index: entry.index,
      });
      continue;
    }

    results.push({
      imageIndex: entry.index,
      page: entry.page,
      width: entry.width,
      height: entry.height,
      filePath: candidate,
      filename: `img-${paddedIndex}.jpg`,
    });
  }

  return results;
}

// ============================================================
// VF Storage Upload
// ============================================================

interface VfUploadResult {
  url: string;
  filename: string;
}

/**
 * Upload a single JPEG buffer to VF Storage.
 * Returns the public URL.
 *
 * VF Storage API: POST http://100.96.203.105:8091/upload/<type>/<category>
 * Returns: { filename, path, size }
 */
async function uploadToVfStorage(
  buffer: Buffer,
  filename: string,
  projectId: string,
  reportNumber: string
): Promise<VfUploadResult> {
  const VF_STORAGE_BASE = process.env.VF_STORAGE_URL ?? 'http://100.96.203.105:8091';

  const formData = new FormData();
  formData.append('file', new Blob([buffer as unknown as BlobPart], { type: 'image/jpeg' }), filename);

  // VF Storage only supports /:type/:category/:filename (2 levels)
  const uploadUrl = `${VF_STORAGE_BASE}/upload/snags/tqr-photos`;

  const response = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `VF Storage upload failed (${response.status}): ${text}`
    );
  }

  const result = (await response.json()) as {
    filename?: string;
    path?: string;
    url?: string;
    size?: number;
  };

  const actualFilename = result.filename ?? filename;
  const storagePath = result.path ?? `snags/tqr-photos/${actualFilename}`;

  return {
    url: `https://app.fibreflow.app/storage/${storagePath}`,
    filename: actualFilename,
  };
}

// ============================================================
// Source PDF Upload
// ============================================================

/**
 * Upload the source PDF file to VF Storage.
 * Non-fatal: returns empty string on failure so import can continue.
 */
export async function uploadSourcePdf(
  buffer: Buffer,
  filename: string,
  _projectId: string,
  _reportNumber: string
): Promise<string> {
  const VF_STORAGE_BASE = process.env.VF_STORAGE_URL ?? 'http://100.96.203.105:8091';

  const formData = new FormData();
  formData.append(
    'file',
    new Blob([buffer as unknown as BlobPart], { type: 'application/pdf' }),
    filename
  );

  const uploadUrl = `${VF_STORAGE_BASE}/upload/snags/tqr-pdfs`;

  try {
    const response = await fetch(uploadUrl, { method: 'POST', body: formData });
    if (!response.ok) {
      log.warn('TqrImageExtractor: source PDF upload non-OK', { status: response.status });
      return '';
    }
    const result = (await response.json()) as { path?: string; filename?: string };
    const storagePath = result.path ?? `snags/tqr-pdfs/${result.filename ?? filename}`;
    return `https://app.fibreflow.app/storage/${storagePath}`;
  } catch (err) {
    log.warn('TqrImageExtractor: source PDF upload failed', { error: err });
    return '';
  }
}

// ============================================================
// Orchestrated Upload
// ============================================================

/**
 * Upload all extracted snag photos to VF Storage in order.
 * Returns UploadedSnagPhoto[] preserving grid order.
 */
export async function uploadSnagPhotos(
  images: ExtractedImage[],
  projectId: string,
  reportNumber: string
): Promise<UploadedSnagPhoto[]> {
  const uploaded: UploadedSnagPhoto[] = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img) continue;
    const buffer = fs.readFileSync(img.filePath);
    const filename = `snag-photo-${String(i + 1).padStart(3, '0')}.jpg`;

    try {
      const result = await uploadToVfStorage(
        buffer,
        filename,
        projectId,
        reportNumber
      );

      uploaded.push({
        gridIndex: i,
        url: result.url,
        filename: result.filename,
      });

      log.info('TqrImageExtractor: photo uploaded', {
        gridIndex: i,
        page: img.page,
        url: result.url,
      });
    } catch (err) {
      log.error('TqrImageExtractor: upload failed for photo', {
        gridIndex: i,
        filename,
        error: err,
      });
      throw err;
    }
  }

  return uploaded;
}
