/**
 * OCR Preview API - Synchronous OCR WITHOUT database save
 * PRD-033: OCR-First Document Upload Flow
 *
 * Purpose: Process OCR and return results for user review BEFORE saving to DB
 *
 * Flow:
 * 1. Accept single file upload (FormData)
 * 2. Upload to temp location
 * 3. Call Qwen3-VL via VLLM for OCR extraction
 * 4. Build classification + extraction results
 * 5. Return preview data (no DB save)
 *
 * Uses Qwen3-VL vision model for high-quality OCR on all document types
 *
 * Timeout: 60 seconds max (VLM inference)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { log } from '@/lib/logger';
import { uploadStaffDocument, deleteStaffDocument, isVFStorageAvailable } from '@/services/vfStorageAdapter';

// VLLM endpoint for Qwen3-VL
const VLLM_ENDPOINT = process.env.VLLM_ENDPOINT || 'http://100.96.203.105:8100';

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
  tierUsed: 'tesseract' | 'paddleocr' | 'ocrspace' | 'gemini' | 'qwen3-vl';
  processingTimeMs: number;
}

// Document type specific prompts for VLM extraction
const VLM_PROMPTS: Record<string, string> = {
  drivers_license: `Extract all fields from this South African driver's license. Return JSON with:
- licenseNumber: The license number (e.g., "6025000170N4")
- idNumber: The 13-digit SA ID number
- fullName: Full name on the license
- dateOfBirth: Date of birth (YYYY-MM-DD format)
- validFrom: License valid from date (YYYY-MM-DD)
- validTo: License valid to/expiry date (YYYY-MM-DD)
- licenseCodes: Vehicle codes (e.g., "EB", "C1")
- firstIssueDate: First issue date (YYYY-MM-DD)
- restrictions: Any restrictions (number or text)
Return ONLY valid JSON, no other text.`,

  id_document: `Extract all fields from this South African ID document (Smart ID card or green ID book). Return JSON with:
- idNumber: The 13-digit SA ID number
- surname: Surname/Last name
- firstName: First names
- dateOfBirth: Date of birth (YYYY-MM-DD format)
- gender: Gender (Male/Female)
- citizenship: Citizenship status
- countryOfBirth: Country of birth
Return ONLY valid JSON, no other text.`,

  passport: `Extract all fields from this passport. Return JSON with:
- passportNumber: The passport number
- surname: Surname/Last name
- firstName: First/Given names
- nationality: Nationality
- dateOfBirth: Date of birth (YYYY-MM-DD format)
- gender: Gender (M/F or Male/Female)
- placeOfBirth: Place of birth
- dateOfIssue: Issue date (YYYY-MM-DD)
- dateOfExpiry: Expiry date (YYYY-MM-DD)
- issuingAuthority: Issuing authority/country
Return ONLY valid JSON, no other text.`,

  bank_statement: `Extract key fields from this bank statement or bank confirmation letter. Return JSON with:
- bankName: Name of the bank
- accountHolder: Account holder name
- accountNumber: Bank account number
- branchCode: Branch code (if visible)
- accountType: Type of account (savings, cheque, etc.)
- statementDate: Statement date (YYYY-MM-DD) if visible
Return ONLY valid JSON, no other text.`,

  // Alias for bank_details document type (used in UI)
  bank_details: `Extract key fields from this bank statement or bank confirmation letter. Return JSON with:
- bankName: Name of the bank
- accountHolder: Account holder name
- accountNumber: Bank account number
- branchCode: Branch code (if visible)
- accountType: Type of account (savings, cheque, etc.)
- statementDate: Statement date (YYYY-MM-DD) if visible
Return ONLY valid JSON, no other text.`,

  proof_of_residence: `Extract address information from this proof of residence document. Return JSON with:
- fullName: Name on the document
- streetAddress: Street address
- suburb: Suburb/Area
- city: City/Town
- province: Province/State
- postalCode: Postal/ZIP code
- documentDate: Date on the document (YYYY-MM-DD)
- documentType: Type of document (utility bill, bank statement, etc.)
Return ONLY valid JSON, no other text.`,

  default: `Extract all visible text and data from this document. Identify the document type and extract relevant fields. Return JSON with:
- documentType: What type of document this appears to be
- extractedText: Key text content from the document
- fields: An object with any identifiable fields and their values
Return ONLY valid JSON, no other text.`,
};

// Field mappings from VLM response to standard field names
const FIELD_MAPPINGS: Record<string, Record<string, string>> = {
  drivers_license: {
    licenseNumber: 'licenseNumber',
    idNumber: 'documentNumber',
    fullName: 'fullName',
    dateOfBirth: 'dateOfBirth',
    validFrom: 'validFrom',
    validTo: 'validTo',
    licenseCodes: 'licenseCodes',
    firstIssueDate: 'issuedDate',
    restrictions: 'restrictions',
  },
  id_document: {
    idNumber: 'documentNumber',
    surname: 'surname',
    firstName: 'firstName',
    dateOfBirth: 'dateOfBirth',
    gender: 'gender',
    citizenship: 'citizenship',
    countryOfBirth: 'countryOfBirth',
  },
  passport: {
    passportNumber: 'documentNumber',
    surname: 'surname',
    firstName: 'firstName',
    nationality: 'nationality',
    dateOfBirth: 'dateOfBirth',
    gender: 'gender',
    placeOfBirth: 'placeOfBirth',
    dateOfIssue: 'issuedDate',
    dateOfExpiry: 'expiryDate',
    issuingAuthority: 'issuingAuthority',
  },
  bank_statement: {
    bankName: 'bankName',
    accountHolder: 'accountHolder',
    accountNumber: 'accountNumber',
    branchCode: 'branchCode',
    accountType: 'accountType',
    statementDate: 'documentDate',
  },
  // Alias for bank_details document type (used in UI)
  bank_details: {
    bankName: 'bankName',
    accountHolder: 'accountHolder',
    accountNumber: 'accountNumber',
    branchCode: 'branchCode',
    accountType: 'accountType',
    statementDate: 'documentDate',
  },
  proof_of_residence: {
    fullName: 'fullName',
    streetAddress: 'streetAddress',
    suburb: 'suburb',
    city: 'city',
    province: 'province',
    postalCode: 'postalCode',
    documentDate: 'documentDate',
    documentType: 'sourceDocumentType',
  },
};

/**
 * Convert PDF to PNG image using pdftoppm (from poppler-utils)
 * Returns the path to the converted image file
 */
async function convertPdfToImage(pdfPath: string): Promise<string> {
  const tempDir = os.tmpdir();
  const outputBase = path.join(tempDir, `pdf-convert-${Date.now()}`);

  try {
    // Use pdftoppm to convert first page of PDF to PNG
    // -png: output PNG format
    // -f 1 -l 1: only first page
    // -r 200: 200 DPI for good quality
    execSync(`pdftoppm -png -f 1 -l 1 -r 200 "${pdfPath}" "${outputBase}"`, {
      timeout: 30000,
      stdio: 'pipe',
    });

    // pdftoppm outputs file as outputBase-1.png for first page
    const outputPath = `${outputBase}-1.png`;

    if (fs.existsSync(outputPath)) {
      log.info('PDF converted to image', { pdfPath, outputPath });
      return outputPath;
    }

    // Sometimes pdftoppm uses different naming, check for alternatives
    const altPath = `${outputBase}-01.png`;
    if (fs.existsSync(altPath)) {
      return altPath;
    }

    throw new Error('PDF conversion output file not found');
  } catch (error: any) {
    log.error('PDF to image conversion failed', { error: error.message, pdfPath });
    throw new Error(`Failed to convert PDF to image: ${error.message}`);
  }
}

/**
 * Check if file is a PDF based on extension or mimetype
 */
function isPdfFile(file: formidable.File): boolean {
  const filename = file.originalFilename?.toLowerCase() || '';
  const mimetype = file.mimetype?.toLowerCase() || '';
  return filename.endsWith('.pdf') || mimetype === 'application/pdf';
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

    const isPdf = isPdfFile(uploadedFile);

    log.info('OCR Preview request', {
      documentType,
      staffId,
      entityType,
      filename: uploadedFile.originalFilename,
      isPdf,
    });

    // Check VF Storage availability
    const storageAvailable = await isVFStorageAvailable();
    if (!storageAvailable) {
      log.error('VF Storage not available for OCR preview');
      return res.status(503).json({ error: 'Storage service unavailable for OCR processing' });
    }

    const VF_STORAGE_INTERNAL_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';

    // Helper to upload file (or converted image) and get internal URL
    const uploadAndGetUrl = async (filePath: string, originalFilename: string, suffix: string): Promise<string> => {
      const fileBuffer = fs.readFileSync(filePath);
      tempFilePaths.push(filePath);

      // Use .png extension for converted PDFs
      const uploadFilename = filePath.endsWith('.png')
        ? `ocr-preview-${suffix}-${originalFilename.replace(/\.pdf$/i, '')}.png`
        : `ocr-preview-${suffix}-${originalFilename}`;

      const uploadResult = await uploadStaffDocument(
        staffId,
        fileBuffer,
        uploadFilename,
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

    // Process OCR with timeout (60s for VLM inference)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      // Convert PDF to image if necessary
      let filePathForOcr = uploadedFile.filepath;
      if (isPdf) {
        log.info('Converting PDF to image for OCR', { filename: uploadedFile.originalFilename });
        filePathForOcr = await convertPdfToImage(uploadedFile.filepath);
        tempFilePaths.push(uploadedFile.filepath); // Add original PDF for cleanup
      }

      // Upload file (or converted image) and get URL for VLM
      const fileUrl = await uploadAndGetUrl(
        filePathForOcr,
        uploadedFile.originalFilename || 'document',
        'single'
      );

      // Check if VLLM is available
      let vllmAvailable = false;
      try {
        const healthCheck = await fetch(`${VLLM_ENDPOINT}/v1/models`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        vllmAvailable = healthCheck.ok;
      } catch {
        log.warn('VLLM endpoint not available for OCR');
      }

      if (!vllmAvailable) {
        clearTimeout(timeout);
        return res.status(503).json({
          error: 'OCR service unavailable. Please try again later or use manual entry.',
        });
      }

      // Get the appropriate prompt for this document type
      const prompt = VLM_PROMPTS[documentType || ''] || VLM_PROMPTS.default;
      const fieldMapping = FIELD_MAPPINGS[documentType || ''] || {};

      log.info('Calling Qwen3-VL for OCR', { documentType, fileUrl });

      // Call Qwen3-VL for extraction
      const vlmResponse = await fetch(`${VLLM_ENDPOINT}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'Qwen/Qwen3-VL-8B-Instruct',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: fileUrl } },
            ],
          }],
          max_tokens: 1000,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(55000),
      });

      if (!vlmResponse.ok) {
        const errorText = await vlmResponse.text();
        throw new Error(`VLM request failed: ${errorText}`);
      }

      const vlmData = await vlmResponse.json();
      const content = vlmData.choices?.[0]?.message?.content || '';

      log.info('VLM response received', { contentLength: content.length });

      // Parse JSON from VLM response
      let extractedData: Record<string, any> = {};
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          extractedData = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        log.warn('Failed to parse VLM JSON response', { content: content.substring(0, 500) });
      }

      // Map extracted fields to standard format with confidence scores
      const extractedFields: Record<string, { value: any; confidence: number; validated: boolean }> = {};

      for (const [vlmField, value] of Object.entries(extractedData)) {
        if (value !== null && value !== undefined && value !== '') {
          const mappedField = fieldMapping[vlmField] || vlmField;
          extractedFields[mappedField] = {
            value,
            confidence: 0.95, // VLM typically has high confidence
            validated: true,
          };
        }
      }

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
      const detectedType = documentType || 'unknown';
      const fieldCount = Object.keys(extractedFields).length;

      const response: OcrPreviewResponse = {
        success: true,
        classification: {
          documentType: detectedType,
          confidence: fieldCount > 0 ? 0.95 : 0.5,
          displayName: getDocumentTypeName(detectedType),
          topGuesses: buildTopGuesses({ documentType: detectedType, confidence: fieldCount > 0 ? 0.95 : 0.5 }),
        },
        extractedFields,
        rawText: content,
        tierUsed: 'qwen3-vl',
        processingTimeMs,
      };

      log.info('OCR Preview completed', {
        documentType: response.classification.documentType,
        confidence: response.classification.confidence,
        fieldCount,
        processingTimeMs,
        tierUsed: 'qwen3-vl',
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

      if (ocrError.name === 'AbortError' || ocrError.message?.includes('timeout')) {
        log.error('OCR timeout after 60 seconds', ocrError, 'OcrPreviewAPI');
        return res.status(504).json({ error: 'OCR processing timed out. Please try manual entry.' });
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
