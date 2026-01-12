/**
 * OCR Preview API - Synchronous OCR WITHOUT database save
 * PRD-033: OCR-First Document Upload Flow
 *
 * Purpose: Process OCR and return results for user review BEFORE saving to DB
 *
 * Flow:
 * 1. Accept single file upload (FormData)
 * 2. Upload to temp location and stream to OCR service
 * 3. Call OCR service synchronously (wait for response)
 * 4. Build classification + extraction results
 * 5. Return preview data (no DB save)
 *
 * Driver's License: Upload FRONT only - extracts ID, License No, Valid Period, Codes
 *
 * Timeout: 30 seconds max
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import { ocrService } from '@/services/ocrService';
import { log } from '@/lib/logger';
import { uploadStaffDocument, deleteStaffDocument, isVFStorageAvailable } from '@/services/vfStorageAdapter';
import { OcrEntityType, type OcrFieldExtractionResponse } from '@/types/ocr.types';

// Disable body parser for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

interface OcrPreviewResponse {
  success: boolean;
  classification: {
    documentType: string;
    confidence: number;
    displayName: string;
    topGuesses: Array<{
      documentType: string;
      confidence: number;
      displayName: string;
    }>;
  };
  extractedFields: Record<string, {
    value: any;
    confidence: number;
    validated: boolean;
  }>;
  rawText: string;
  tierUsed: 'tesseract' | 'paddleocr' | 'ocrspace' | 'gemini';
  processingTimeMs: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OcrPreviewResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();
  const tempFilePaths: string[] = [];
  const storagePaths: string[] = [];

  try {
    // Parse multipart form data
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB max per file
      keepExtensions: true,
    });

    const [fields, files] = await form.parse(req);

    // Get fields
    const staffId = Array.isArray(fields.staffId) ? fields.staffId[0] : fields.staffId;
    const entityType = Array.isArray(fields.entityType) ? fields.entityType[0] : fields.entityType || 'staff';
    const documentType = Array.isArray(fields.documentType) ? fields.documentType[0] : fields.documentType;

    if (!staffId) {
      return res.status(400).json({ error: 'staffId is required' });
    }

    // Get uploaded file (single file for all document types)
    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;

    // Validate file presence
    if (!uploadedFile) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    log.info('OCR Preview request', {
      documentType,
      staffId,
      entityType,
      filename: uploadedFile.originalFilename,
    });

    // Check VF Storage availability
    const storageAvailable = await isVFStorageAvailable();
    if (!storageAvailable) {
      log.error('VF Storage not available for OCR preview');
      return res.status(503).json({ error: 'Storage service unavailable for OCR processing' });
    }

    const VF_STORAGE_INTERNAL_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';

    // Helper to upload file and get internal URL
    const uploadAndGetUrl = async (file: formidable.File, suffix: string): Promise<string> => {
      const fileBuffer = fs.readFileSync(file.filepath);
      tempFilePaths.push(file.filepath);

      const uploadResult = await uploadStaffDocument(
        staffId,
        fileBuffer,
        `ocr-preview-${suffix}-${file.originalFilename || 'temp'}`,
        'temp_ocr'
      );

      storagePaths.push(uploadResult.path);

      // Convert to internal URL for OCR service
      let fileUrl = uploadResult.url;
      if (fileUrl.includes('vf.fibreflow.app')) {
        const urlPath = new URL(fileUrl).pathname;
        fileUrl = `${VF_STORAGE_INTERNAL_URL}${urlPath}`;
        log.info('Converted public URL to internal for OCR', { original: uploadResult.url, internal: fileUrl });
      }

      return fileUrl;
    };

    // Process OCR with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      // Upload file and process OCR
      const fileUrl = await uploadAndGetUrl(uploadedFile, 'single');

      const ocrResult = await ocrService.extractFields({
        fileUrl,
        documentType: documentType || undefined,
        entityType: entityType === 'contractor' ? OcrEntityType.CONTRACTOR : OcrEntityType.STAFF,
      });

      log.info('OCR completed', {
        documentType: ocrResult.classification?.documentType || documentType,
        fieldsExtracted: Object.keys(ocrResult.extractedFields).length,
        tierUsed: ocrResult.tierUsed,
      });

      clearTimeout(timeout);

      // Clean up temp files
      for (const tempPath of tempFilePaths) {
        try { fs.unlinkSync(tempPath); } catch {}
      }

      // Clean up storage files (fire and forget)
      for (const storagePath of storagePaths) {
        const filename = storagePath.split('/').pop();
        if (filename) {
          deleteStaffDocument(staffId, filename).catch(err => {
            log.warn('Failed to cleanup temp OCR file', { error: String(err), storagePath });
          });
        }
      }

      const processingTimeMs = Date.now() - startTime;

      // Build response with defensive null checks
      const detectedType = ocrResult.classification?.documentType || documentType || 'unknown';
      const confidence = ocrResult.classification?.confidence || 0;

      const response: OcrPreviewResponse = {
        success: true,
        classification: {
          documentType: detectedType,
          confidence,
          displayName: getDocumentTypeName(detectedType),
          topGuesses: buildTopGuesses({ documentType: detectedType, confidence }),
        },
        extractedFields: ocrResult.extractedFields as Record<string, { value: any; confidence: number; validated: boolean }>,
        rawText: ocrResult.rawText || '',
        tierUsed: ocrResult.tierUsed,
        processingTimeMs,
      };

      log.info('OCR Preview completed', {
        documentType: response.classification.documentType,
        confidence: response.classification.confidence,
        fieldCount: Object.keys(response.extractedFields).length,
        processingTimeMs,
      }, 'OcrPreviewAPI');

      return res.status(200).json(response);

    } catch (ocrError: any) {
      clearTimeout(timeout);

      // Clean up temp files
      for (const tempPath of tempFilePaths) {
        try { fs.unlinkSync(tempPath); } catch {}
      }

      // Clean up storage files
      for (const storagePath of storagePaths) {
        const filename = storagePath.split('/').pop();
        if (filename) {
          deleteStaffDocument(staffId, filename).catch(() => {});
        }
      }

      if (ocrError.name === 'AbortError') {
        log.error('OCR timeout after 30 seconds', ocrError, 'OcrPreviewAPI');
        return res.status(504).json({ error: 'OCR processing timed out after 30 seconds. Please try manual entry.' });
      }

      throw ocrError;
    }

  } catch (error: any) {
    log.error('OCR Preview failed', error, 'OcrPreviewAPI');
    return res.status(500).json({ error: error.message || 'OCR preview failed' });
  }
}

function getDocumentTypeName(type: string): string {
  // Handle null/undefined
  if (!type) return 'Unknown Document';

  const names: Record<string, string> = {
    'id_document': 'SA ID Document',
    'drivers_license': "Driver's License",
    'passport': 'Passport',
    'bank_statement': 'Bank Statement',
    'proof_of_residence': 'Proof of Residence',
    'employment_contract': 'Employment Contract',
    'tax_document': 'Tax Document',
    'medical_certificate': 'Medical Certificate',
    'police_clearance': 'Police Clearance',
    'qualification': 'Qualification Certificate',
    'certification': 'Professional Certification',
    'unknown': 'Unknown Document',
  };

  return names[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function buildTopGuesses(classification: { documentType: string; confidence: number }): Array<{ documentType: string; confidence: number; displayName: string }> {
  // For now, return single guess (can enhance later with multi-classification)
  const topGuess = {
    documentType: classification.documentType,
    confidence: classification.confidence,
    displayName: getDocumentTypeName(classification.documentType),
  };

  // TODO: Enhance OCR service to return top-3 classification guesses
  return [topGuess];
}
