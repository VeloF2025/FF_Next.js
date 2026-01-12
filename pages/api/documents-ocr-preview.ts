/**
 * OCR Preview API - Synchronous OCR WITHOUT database save
 * PRD-033: OCR-First Document Upload Flow
 * 
 * Purpose: Process OCR and return results for user review BEFORE saving to DB
 * 
 * Flow:
 * 1. Accept file upload (FormData)
 * 2. Upload to temp location or stream to OCR service
 * 3. Call OCR service synchronously (wait for response)
 * 4. Build classification + extraction results
 * 5. Return preview data (no DB save)
 * 
 * Timeout: 30 seconds max
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import { ocrService } from '@/services/ocrService';
import { log } from '@/lib/logger';
import { uploadStaffDocument, deleteStaffDocument, isVFStorageAvailable } from '@/services/vfStorageAdapter';
import { OcrEntityType } from '@/types/ocr.types';

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

  try {
    // Parse multipart form data
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB max
      keepExtensions: true,
    });

    const [fields, files] = await form.parse(req);

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    const staffId = Array.isArray(fields.staffId) ? fields.staffId[0] : fields.staffId;
    const entityType = Array.isArray(fields.entityType) ? fields.entityType[0] : fields.entityType || 'staff';

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!staffId) {
      return res.status(400).json({ error: 'staffId is required' });
    }

    log.info('OCR Preview request', {
      fileName: file.originalFilename,
      fileSize: file.size,
      mimeType: file.mimetype,
      staffId,
      entityType,
    }, 'OcrPreviewAPI');

    // Check VF Storage availability
    const storageAvailable = await isVFStorageAvailable();
    if (!storageAvailable) {
      log.error('VF Storage not available for OCR preview');
      return res.status(503).json({ error: 'Storage service unavailable for OCR processing' });
    }

    // Read file buffer
    const fileBuffer = fs.readFileSync(file.filepath);

    // Upload to VF Storage temporarily to get a URL for OCR service
    const uploadResult = await uploadStaffDocument(
      staffId,
      fileBuffer,
      file.originalFilename || 'ocr-preview-temp',
      'temp_ocr'  // Use a temp document type
    );

    const storagePath = uploadResult.path;

    // Convert public HTTPS URL to internal HTTP URL for OCR service
    // The OCR service runs on the same server and can't access via public domain (gets 404)
    // Public: https://vf.fibreflow.app/path → Internal: http://100.96.203.105:8091/path
    const VF_STORAGE_INTERNAL_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';
    let fileUrl = uploadResult.url;
    if (fileUrl.includes('vf.fibreflow.app')) {
      const urlPath = new URL(fileUrl).pathname;
      fileUrl = `${VF_STORAGE_INTERNAL_URL}${urlPath}`;
      log.info('Converted public URL to internal for OCR', { original: uploadResult.url, internal: fileUrl });
    }

    // Call OCR service synchronously (with 30s timeout)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      // Note: extractFields doesn't support AbortSignal yet, 30s is enforced by Next.js API timeout
      const ocrResult = await ocrService.extractFields({
        fileUrl,
        documentType: undefined,  // Let OCR detect it
        entityType: entityType === 'contractor' ? OcrEntityType.CONTRACTOR : OcrEntityType.STAFF,
      });

      clearTimeout(timeout);

      // Clean up local temp file
      fs.unlinkSync(file.filepath);

      // Clean up VF Storage temp file (fire and forget - don't block response)
      const filename = storagePath.split('/').pop();
      if (filename) {
        deleteStaffDocument(staffId, filename).catch(err => {
          log.warn('Failed to cleanup temp OCR file from storage', { error: String(err), storagePath });
        });
      }

      const processingTimeMs = Date.now() - startTime;

      // Build response with defensive null checks
      const documentType = ocrResult.classification?.documentType || 'unknown';
      const confidence = ocrResult.classification?.confidence || 0;

      const response: OcrPreviewResponse = {
        success: true,
        classification: {
          documentType,
          confidence,
          displayName: getDocumentTypeName(documentType),
          topGuesses: buildTopGuesses({ documentType, confidence }),
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

      // Clean up local temp file
      try {
        fs.unlinkSync(file.filepath);
      } catch {}

      // Clean up VF Storage temp file
      const filename = storagePath.split('/').pop();
      if (filename) {
        deleteStaffDocument(staffId, filename).catch(err => {
          log.warn('Failed to cleanup temp OCR file after error', { error: String(err), storagePath });
        });
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
