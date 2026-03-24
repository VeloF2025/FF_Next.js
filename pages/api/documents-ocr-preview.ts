/**
 * OCR Preview API — Synchronous OCR WITHOUT database save
 * PRD-033: OCR-First Document Upload Flow
 *
 * Accepts a single file upload, runs Qwen3-VL OCR via VLLM, and returns the
 * extracted fields for user review.  Nothing is saved to the database.
 * Timeout: 120 seconds (PDF conversion + orientation detection + VLM inference).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { isVFStorageAvailable } from '@/services/vfStorageAdapter';
import { validateDocument } from '@/services/staff/documentValidationService';
import {
  isPdfFile,
  convertPdfToImage,
  resizeImageForVlm,
  detectImageOrientation,
} from '@/services/ocr/imageProcessingService';
import {
  isVllmAvailable,
  callVlmForExtraction,
  parseVlmResponse,
  mapExtractedFields,
  applyIdValidationPostProcessing,
} from '@/services/ocr/vlmExtractionService';
import { getDocumentTypeName, buildTopGuesses } from '@/services/ocr/documentClassificationService';
import { uploadForOcr, cleanupOcrTempFiles } from '@/services/ocr/ocrTempStorageService';
import type { OcrPreviewResponse } from '@/services/ocr/types';
import { apiResponse } from '@/lib/apiResponse';

// Disable body parser for file uploads
export const config = { api: { bodyParser: false } };

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OcrPreviewResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const startTime = Date.now();
  const tempFilePaths: string[] = [];
  const storagePaths: string[] = [];

  try {
    const form = formidable({ maxFileSize: 10 * 1024 * 1024, keepExtensions: true });
    const [fields, files] = await form.parse(req);

    const staffId = Array.isArray(fields.staffId) ? fields.staffId[0] : fields.staffId;
    const entityType = (Array.isArray(fields.entityType) ? fields.entityType[0] : fields.entityType) ?? 'staff';
    const documentType = Array.isArray(fields.documentType) ? fields.documentType[0] : fields.documentType;

    if (!staffId) return apiResponse.badRequest(res, 'staffId is required');

    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!uploadedFile) return apiResponse.badRequest(res, 'No file uploaded');

    const isPdf = isPdfFile(uploadedFile);
    log.info('OCR Preview request', {
      documentType, staffId, entityType,
      filename: uploadedFile.originalFilename, isPdf,
    });

    if (!(await isVFStorageAvailable())) {
      log.error('VF Storage not available for OCR preview');
      return res.status(503).json({ error: 'Storage service unavailable for OCR processing' });
    }

    const cleanup = () => cleanupOcrTempFiles(tempFilePaths, storagePaths, staffId);

    // 120-second overall guard
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
      // 1. Convert PDF → PNG when necessary
      let filePathForOcr = uploadedFile.filepath;
      if (isPdf) {
        log.info('Converting PDF to image for OCR', { filename: uploadedFile.originalFilename, documentType });
        filePathForOcr = await convertPdfToImage(uploadedFile.filepath, documentType);
        tempFilePaths.push(uploadedFile.filepath);
      }

      // 2. Resize (no rotation) → upload → detect orientation
      const originalPath = filePathForOcr;
      const tempResizedPath = await resizeImageForVlm(filePathForOcr, 0);
      if (tempResizedPath !== originalPath) tempFilePaths.push(tempResizedPath);

      const originalName = uploadedFile.originalFilename ?? 'document';
      let fileUrl = await uploadForOcr(tempResizedPath, staffId, originalName, 'orient-check', storagePaths);

      const detectedRotation = await detectImageOrientation(fileUrl);
      if (detectedRotation !== 0) {
        log.info('Image rotation detected, applying correction', { rotation: detectedRotation });
        const rotatedPath = await resizeImageForVlm(originalPath, detectedRotation);
        if (rotatedPath !== originalPath && rotatedPath !== tempResizedPath) tempFilePaths.push(rotatedPath);
        fileUrl = await uploadForOcr(rotatedPath, staffId, originalName, 'rotated', storagePaths);
      }

      // 3. VLM availability gate
      if (!(await isVllmAvailable())) {
        clearTimeout(timeout);
        cleanup();
        return res.status(503).json({
          error: 'OCR service unavailable. Please try again later or use manual entry.',
        });
      }

      // 4. OCR extraction + field mapping + ID validation
      const rawContent = await callVlmForExtraction(fileUrl, documentType);
      const extractedData = parseVlmResponse(rawContent);
      const mappedFields = mapExtractedFields(extractedData as Record<string, unknown>, documentType);
      const extractedFields = applyIdValidationPostProcessing(mappedFields, documentType);

      clearTimeout(timeout);
      cleanup();

      // 5. Non-critical staff record validation
      let validation: Awaited<ReturnType<typeof validateDocument>> | undefined;
      try {
        validation = await validateDocument(staffId, documentType ?? 'unknown', extractedData as Record<string, unknown>);
        log.info('Document validation completed', {
          staffId, documentType,
          isValid: validation.isValid, matchScore: validation.matchScore,
          mismatches: validation.mismatches.length, matches: validation.matches.length,
        });
      } catch (validationError) {
        log.warn('Document validation failed (non-critical)', { staffId, documentType, error: validationError });
      }

      const processingTimeMs = Date.now() - startTime;
      const detectedType = documentType ?? 'unknown';
      const fieldCount = Object.keys(extractedFields).length;
      const confidence = fieldCount > 0 ? 0.95 : 0.5;

      const response: OcrPreviewResponse = {
        success: true,
        classification: {
          documentType: detectedType,
          confidence,
          displayName: getDocumentTypeName(detectedType),
          topGuesses: buildTopGuesses({ documentType: detectedType, confidence }),
        },
        extractedFields,
        rawText: rawContent,
        tierUsed: 'qwen3-vl',
        processingTimeMs,
        validation,
      };

      log.info('OCR Preview completed', {
        documentType: response.classification.documentType,
        confidence, fieldCount, processingTimeMs, tierUsed: 'qwen3-vl',
      }, 'OcrPreviewAPI');

      return res.status(200).json(response);

    } catch (ocrError: unknown) {
      clearTimeout(timeout);
      cleanup();
      const err = ocrError instanceof Error ? ocrError : new Error(String(ocrError));
      if (err.name === 'AbortError' || err.message.includes('timeout')) {
        log.error('OCR timeout after 120 seconds', err, 'OcrPreviewAPI');
        return res.status(504).json({ error: 'OCR processing timed out after 120 seconds. Please try manual entry.' });
      }
      throw ocrError;
    }

  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('OCR Preview failed', err, 'OcrPreviewAPI');
    return res.status(500).json({ error: err.message || 'OCR preview failed' });
  }
}

export default withAuth(handler);
