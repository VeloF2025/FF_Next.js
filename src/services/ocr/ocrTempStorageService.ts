/**
 * OCR Temp Storage Service
 * PRD-033: OCR-First Document Upload Flow
 *
 * Manages the temporary VF Storage files used during the OCR preview pipeline.
 * Files are uploaded so the VLLM service can access them via HTTP URL, then
 * deleted after OCR completes (or on error).
 */

import fs from 'fs';
import { log } from '@/lib/logger';
import { uploadStaffDocument, deleteStaffDocument } from '@/services/vfStorageAdapter';

/** Internal VF Storage URL (accessible from server-side without nginx proxy) */
const VF_STORAGE_INTERNAL_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';

/**
 * Upload an image file to VF Storage and return its internal URL for VLM access.
 *
 * Public VF Storage URLs route through nginx (`vf.fibreflow.app/storage/...`).
 * The VLLM service is on the same network and needs direct internal access, so
 * this function rewrites public URLs to the internal endpoint.
 *
 * @param filePath        Local path of the image to upload.
 * @param staffId         Staff ID — used as the storage folder.
 * @param originalFilename  Original filename from the upload (for naming).
 * @param suffix          Short label appended to the upload filename (e.g. 'orient-check').
 * @param storagePaths    Mutable array to track uploaded paths for later cleanup.
 * @returns Internal URL accessible by the VLLM service.
 */
export async function uploadForOcr(
  filePath: string,
  staffId: string,
  originalFilename: string,
  suffix: string,
  storagePaths: string[]
): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);

  const uploadFilename = filePath.endsWith('.png')
    ? `ocr-preview-${suffix}-${originalFilename.replace(/\.pdf$/i, '')}.png`
    : `ocr-preview-${suffix}-${originalFilename}`;

  const uploadResult = await uploadStaffDocument(staffId, fileBuffer, uploadFilename, 'temp_ocr');
  storagePaths.push(uploadResult.path);

  // Rewrite URL to internal VF Storage URL so the VLM can reach it
  let fileUrl = uploadResult.url;
  if (fileUrl.startsWith('/storage/')) {
    // Relative path from VFStorageService — strip /storage/ prefix and use internal URL
    const urlPath = fileUrl.replace(/^\/storage/, '');
    fileUrl = `${VF_STORAGE_INTERNAL_URL}${urlPath}`;
    log.info('Converted relative storage URL to internal for OCR', { original: uploadResult.url, internal: fileUrl });
  } else if (fileUrl.includes('vf.fibreflow.app')) {
    const urlPath = new URL(fileUrl).pathname.replace(/^\/storage/, '');
    fileUrl = `${VF_STORAGE_INTERNAL_URL}${urlPath}`;
    log.info('Converted public URL to internal for OCR', { original: uploadResult.url, internal: fileUrl });
  }

  return fileUrl;
}

/**
 * Delete all temporary local files and remote VF Storage placeholders created
 * during the OCR pipeline.  Errors are logged but never thrown (cleanup is best-effort).
 *
 * @param tempFilePaths   Local file paths to unlink.
 * @param storagePaths    VF Storage paths to delete.
 * @param staffId         Staff ID owning the storage files.
 */
export function cleanupOcrTempFiles(
  tempFilePaths: string[],
  storagePaths: string[],
  staffId: string
): void {
  for (const tmpPath of tempFilePaths) {
    try {
      fs.unlinkSync(tmpPath);
    } catch (e) {
      log.debug('Temp file cleanup failed', { error: e instanceof Error ? e.message : 'unknown' }, 'ocr-preview');
    }
  }

  for (const storagePath of storagePaths) {
    const filename = storagePath.split('/').pop();
    if (filename) {
      deleteStaffDocument(staffId, filename).catch((e) =>
        log.warn('Failed to cleanup temp OCR file', { error: String(e), storagePath })
      );
    }
  }
}
