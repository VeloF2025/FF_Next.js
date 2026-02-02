/**
 * Client PO PDF Extraction API
 * POST /api/projects/[projectId]/client-pos/extract-from-pdf
 *
 * Accepts PDF upload, converts to image, extracts data via VLM
 * Returns extracted data and document URL for pre-populating the create form
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { VFStorageService } from '@/services/vfStorageAdapter';
import { extractPOFromImage, extractPOFromMultipleImages } from '@/modules/projects/services/poExtractionService';
import type { POExtractionAPIResponse } from '@/modules/projects/types/po-extraction.types';

const execAsync = promisify(exec);

// Disable body parsing - we handle multipart form data
export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_TYPES = ['application/pdf'];

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const userId = (req as AuthenticatedNextApiRequest).user.id;
  const projectId = req.query.projectId as string;

  if (!projectId) {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  const startTime = Date.now();

  try {
    // Parse multipart form data
    const form = formidable({
      maxFileSize: MAX_FILE_SIZE,
      keepExtensions: true,
    });

    const [, files] = await form.parse(req);
    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;

    if (!uploadedFile) {
      return apiResponse.badRequest(res, 'No file uploaded');
    }

    // Validate file type
    const mimeType = uploadedFile.mimetype || '';
    if (!ALLOWED_TYPES.includes(mimeType)) {
      return apiResponse.badRequest(res, `Invalid file type: ${mimeType}. Only PDF files are allowed.`);
    }

    const originalName = uploadedFile.originalFilename || 'document.pdf';
    log.info('[POExtraction] Processing PDF upload', {
      projectId,
      filename: originalName,
      size: uploadedFile.size,
    });

    // Convert PDF to images using pdftoppm
    const images = await convertPdfToImages(uploadedFile.filepath);

    if (images.length === 0) {
      return apiResponse.internalError(res, new Error('Failed to convert PDF to images'));
    }

    log.info('[POExtraction] PDF converted to images', {
      pageCount: images.length,
      filename: originalName,
    });

    // Extract data from images via VLM
    const firstImage = images[0];
    if (!firstImage) {
      return apiResponse.internalError(res, new Error('No images available for extraction'));
    }

    const extraction = images.length === 1
      ? await extractPOFromImage(firstImage, originalName)
      : await extractPOFromMultipleImages(images, originalName);

    // Upload original PDF to VF Storage regardless of extraction success
    const vfStorage = new VFStorageService();
    const timestamp = Date.now();
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `${projectId}_${timestamp}_${sanitizedName}`;

    const pdfBuffer = await fs.readFile(uploadedFile.filepath);
    const uploadResult = await vfStorage.uploadFile(
      pdfBuffer,
      'procurement',
      'client-pos',
      storagePath
    );

    // Clean up temp files
    await cleanupTempFiles(uploadedFile.filepath);

    const response: POExtractionAPIResponse = {
      success: extraction.success,
      extraction: extraction.success ? {
        poNumber: extraction.poNumber,
        reference: extraction.reference,
        poDate: extraction.poDate,
        quantity: extraction.quantity,
        unitPrice: extraction.unitPrice,
        vatRate: extraction.vatRate,
        subtotal: extraction.subtotal,
        vatAmount: extraction.vatAmount,
        total: extraction.total,
        description: extraction.description,
        confidence: extraction.confidence,
      } : null,
      documentUrl: uploadResult.url,
      documentName: originalName,
      error: extraction.error,
      processingTimeMs: Date.now() - startTime,
    };

    log.info('[POExtraction] Extraction complete', {
      projectId,
      filename: originalName,
      success: extraction.success,
      confidence: extraction.confidence,
      processingTimeMs: response.processingTimeMs,
    });

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('[POExtraction] Failed to process PDF', { projectId, error });
    return apiResponse.internalError(res, error instanceof Error ? error : new Error('Failed to process PDF'));
  }
}));

/**
 * Convert PDF to images using pdftoppm
 * Returns array of base64-encoded images
 */
async function convertPdfToImages(pdfPath: string): Promise<string[]> {
  const outputDir = path.dirname(pdfPath);
  const outputPrefix = path.join(outputDir, 'page');

  try {
    // Use pdftoppm to convert PDF to JPEG images
    // -jpeg: output JPEG format
    // -r 150: 150 DPI (good balance of quality and size)
    // -scale-to 1024: max dimension 1024px (VLM limit)
    await execAsync(`pdftoppm -jpeg -r 150 -scale-to 1024 "${pdfPath}" "${outputPrefix}"`);

    // Find all generated images
    const files = await fs.readdir(outputDir);
    const imageFiles = files
      .filter(f => f.startsWith('page') && f.endsWith('.jpg'))
      .sort((a, b) => {
        // Sort by page number
        const numA = parseInt(a.match(/page-?(\d+)/)?.[1] || '0');
        const numB = parseInt(b.match(/page-?(\d+)/)?.[1] || '0');
        return numA - numB;
      });

    if (imageFiles.length === 0) {
      log.warn('[POExtraction] No images generated from PDF');
      return [];
    }

    // Read images and convert to base64
    const images: string[] = [];
    for (const imageFile of imageFiles) {
      const imagePath = path.join(outputDir, imageFile);
      const imageBuffer = await fs.readFile(imagePath);
      const base64 = imageBuffer.toString('base64');
      images.push(`data:image/jpeg;base64,${base64}`);

      // Clean up image file
      await fs.unlink(imagePath).catch(() => { /* ignore */ });
    }

    return images;
  } catch (error) {
    log.error('[POExtraction] PDF conversion failed', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    return [];
  }
}

/**
 * Clean up temporary files
 */
async function cleanupTempFiles(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore cleanup errors
  }
}
