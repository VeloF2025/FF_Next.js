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
 * Timeout: 120 seconds max (PDF conversion + orientation detection + VLM inference)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import sharp from 'sharp';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { uploadStaffDocument, deleteStaffDocument, isVFStorageAvailable } from '@/services/vfStorageAdapter';
import { validateDocument, type ValidationResult } from '@/services/staff/documentValidationService';

// Max image dimensions for VLM (to stay under token limit)
const MAX_IMAGE_WIDTH = 1280;
const MAX_IMAGE_HEIGHT = 960;

/**
 * Cross-validate SA ID number against DOB
 * SA ID format: YYMMDD SSSS C A Z
 * - First 6 digits = Date of Birth (YYMMDD)
 * - If DOB is extracted separately, we can cross-check and correct OCR errors
 */
interface IdCrossValidationResult {
  mismatch: boolean;
  corrected: boolean;
  correctedId?: string;
  reason: string;
}

function crossValidateSaIdWithDob(idNumber: string, dateOfBirth: string): IdCrossValidationResult {
  // Clean the ID number (remove spaces/dashes)
  const cleanId = (idNumber || '').replace(/[\s\-]/g, '');

  // Parse DOB (expected format: YYYY-MM-DD)
  const dobMatch = (dateOfBirth || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!dobMatch) {
    return { mismatch: false, corrected: false, reason: 'DOB format not recognized' };
  }

  const [, year, month, day] = dobMatch;
  const yy = year.slice(-2); // Last 2 digits of year
  const expectedDobPrefix = `${yy}${month}${day}`; // YYMMDD

  // Check if ID number has at least 13 digits
  if (cleanId.length !== 13) {
    return { mismatch: false, corrected: false, reason: `ID number length is ${cleanId.length}, expected 13` };
  }

  const idDobPrefix = cleanId.substring(0, 6);

  // If prefixes match, no correction needed
  if (idDobPrefix === expectedDobPrefix) {
    return { mismatch: false, corrected: false, reason: 'ID and DOB match correctly' };
  }

  // Mismatch detected - try to correct the ID based on DOB
  // The DOB from separate field extraction is often more reliable than ID number OCR
  // because DOB is typically printed in larger, clearer text

  // Calculate what the corrected ID would be
  const correctedId = expectedDobPrefix + cleanId.substring(6);

  // Validate the corrected ID passes Luhn check (SA ID checksum)
  if (isValidSaIdChecksum(correctedId)) {
    return {
      mismatch: true,
      corrected: true,
      correctedId,
      reason: `ID DOB prefix "${idDobPrefix}" corrected to "${expectedDobPrefix}" based on extracted DOB (${dateOfBirth}). Checksum valid.`,
    };
  }

  // If corrected ID fails checksum, don't auto-correct but flag the mismatch
  return {
    mismatch: true,
    corrected: false,
    reason: `ID DOB prefix "${idDobPrefix}" doesn't match extracted DOB "${expectedDobPrefix}" (${dateOfBirth}). Auto-correction failed checksum validation.`,
  };
}

/**
 * Validate SA ID number using Luhn algorithm (mod 10 checksum)
 * The last digit of SA ID is a check digit
 */
function isValidSaIdChecksum(idNumber: string): boolean {
  if (idNumber.length !== 13 || !/^\d+$/.test(idNumber)) {
    return false;
  }

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let digit = parseInt(idNumber[i], 10);

    // Double every second digit (from right, so odd positions from left in 0-indexed)
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
  }

  // Check digit should make total divisible by 10
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(idNumber[12], 10);
}

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
  // Staff record validation
  validation?: {
    isValid: boolean;
    matchScore: number;
    mismatches: Array<{
      field: string;
      label: string;
      documentValue: string | null;
      recordValue: string | null;
      severity: 'critical' | 'warning' | 'info';
      message: string;
    }>;
    matches: string[];
    staffRecord: {
      name: string;
      saIdNumber: string | null;
      position: string | null;
      department: string | null;
      startDate: string | null;
    } | null;
  };
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
- idNumber: The SA ID number - MUST be EXACTLY 13 digits. Count carefully: YYMMDD SSSS C A Z format. If you see only 11-12 digits, look again for missing digits.
- surname: Surname/Last name
- firstName: First names
- dateOfBirth: Date of birth (YYYY-MM-DD format) - first 6 digits of ID = YYMMDD
- gender: Gender (Male/Female)
- citizenship: Citizenship status
- countryOfBirth: Country of birth
CRITICAL: SA ID numbers are always exactly 13 digits. Verify your extracted idNumber has 13 digits before returning.
Return ONLY valid JSON, no other text.`,

  // Alias for sa_id document type (used in UI)
  sa_id: `Extract all fields from this South African ID document (Smart ID card or green ID book). Return JSON with:
- idNumber: The SA ID number - MUST be EXACTLY 13 digits. Count carefully: YYMMDD SSSS C A Z format. If you see only 11-12 digits, look again for missing digits.
- surname: Surname/Last name
- firstName: First names
- dateOfBirth: Date of birth (YYYY-MM-DD format) - first 6 digits of ID = YYMMDD
- gender: Gender (Male/Female)
- citizenship: Citizenship status
- countryOfBirth: Country of birth
CRITICAL: SA ID numbers are always exactly 13 digits. Verify your extracted idNumber has 13 digits before returning.
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

  employment_contract: `Extract key details from this employment contract/agreement. Focus on the front page, summary sections, and signature page. Return JSON with:
- employeeName: Full name of the employee
- employeeIdNumber: Employee's ID number if visible
- companyName: Name of the employer/company
- companyRegistration: Company registration number if visible
- jobTitle: Position/job title
- department: Department if mentioned
- startDate: Employment start date (YYYY-MM-DD)
- endDate: Contract end date if fixed-term (YYYY-MM-DD), null if permanent
- employmentType: Type (permanent, fixed-term, contract, etc.)
- salary: Salary/wage amount if visible
- salaryPeriod: Payment period (monthly, weekly, hourly)
- workLocation: Work location/address
- signatureDate: Date contract was signed (YYYY-MM-DD)
- employeeSigned: Boolean - true if employee signature is present
- employerSigned: Boolean - true if employer/company representative signature is present
- witnessesSigned: Boolean - true if witness signatures are present (check for witness signature lines)
- signatureNotes: Brief notes about signature status (e.g., "Employee and employer signed, witnesses not signed")
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
  // Alias for sa_id document type (used in UI)
  sa_id: {
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
  employment_contract: {
    employeeName: 'employeeName',
    employeeIdNumber: 'employeeIdNumber',
    companyName: 'companyName',
    companyRegistration: 'companyRegistration',
    jobTitle: 'jobTitle',
    department: 'department',
    startDate: 'startDate',
    endDate: 'endDate',
    employmentType: 'employmentType',
    salary: 'salary',
    salaryPeriod: 'salaryPeriod',
    workLocation: 'workLocation',
    signatureDate: 'signatureDate',
    employeeSigned: 'employeeSigned',
    employerSigned: 'employerSigned',
    witnessesSigned: 'witnessesSigned',
    signatureNotes: 'signatureNotes',
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
 * Detect if image needs rotation using VLM
 * Returns rotation angle: 0, 90, 180, or 270
 */
async function detectImageOrientation(imageUrl: string): Promise<number> {
  try {
    const orientationPrompt = `Look at this image. Is the text/content rotated or sideways?
Answer with ONLY one of these options:
- "0" if text is upright and readable normally
- "90" if text is rotated 90 degrees clockwise (need to rotate counter-clockwise to read)
- "180" if text is upside down
- "270" if text is rotated 90 degrees counter-clockwise (need to rotate clockwise to read)
Return ONLY the number, nothing else.`;

    const response = await fetch(`${VLLM_ENDPOINT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'Qwen/Qwen3-VL-8B-Instruct',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: orientationPrompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        }],
        max_tokens: 10,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '0';
      log.info('VLM orientation response', { rawContent: content });
      // Extract just the number from response (VLM might include extra text)
      const match = content.match(/\b(0|90|180|270)\b/);
      const rotation = match ? parseInt(match[1], 10) : 0;
      log.info('Detected image orientation', { rotation, rawContent: content.substring(0, 100) });
      return rotation;
    } else {
      log.warn('Orientation detection request failed', { status: response.status });
    }
  } catch (error) {
    log.warn('Orientation detection failed, assuming upright', { error: String(error) });
  }
  return 0;
}

/**
 * Resize and auto-rotate image to fit within VLM token limits
 * Returns path to processed image (or original if no processing needed)
 */
async function resizeImageForVlm(imagePath: string, rotationDegrees: number = 0): Promise<string> {
  const inputBuffer = fs.readFileSync(imagePath);
  const metadata = await sharp(inputBuffer).metadata();
  const { width = 0, height = 0 } = metadata;

  const needsResize = width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT;
  const needsRotation = rotationDegrees !== 0;

  // Return original if no processing needed
  if (!needsResize && !needsRotation) {
    log.info('Image within limits, no processing needed', { width, height });
    return imagePath;
  }

  log.info('Processing image for VLM OCR', {
    originalWidth: width,
    originalHeight: height,
    targetMax: `${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT}`,
    rotation: rotationDegrees,
  });

  // Create temp file for processed image
  const tempDir = os.tmpdir();
  const processedPath = path.join(tempDir, `processed-${Date.now()}.jpg`);

  // Build sharp pipeline
  let pipeline = sharp(inputBuffer)
    .rotate(); // Auto-rotate based on EXIF orientation first

  // Apply explicit rotation if detected
  if (needsRotation) {
    // Convert detected rotation to correction: if image is rotated 90° CW, we need to rotate 270° CW (or 90° CCW)
    const correctionAngle = (360 - rotationDegrees) % 360;
    log.info('Applying rotation correction', { detected: rotationDegrees, correction: correctionAngle });
    pipeline = pipeline.rotate(correctionAngle);
  }

  // Resize if needed
  if (needsResize) {
    pipeline = pipeline.resize(MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT, {
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  await pipeline.jpeg({ quality: 90 }).toFile(processedPath);

  const newMetadata = await sharp(fs.readFileSync(processedPath)).metadata();
  log.info('Image processed for OCR', {
    newWidth: newMetadata.width,
    newHeight: newMetadata.height,
    originalSize: inputBuffer.length,
    newSize: fs.statSync(processedPath).size,
    rotationApplied: rotationDegrees,
  });

  return processedPath;
}

/**
 * Convert PDF to PNG image using pdftoppm (from poppler-utils)
 * Uses adaptive DPI based on file size AND document type
 * ID documents need higher DPI for accurate digit recognition
 * Returns the path to the converted image file
 */
async function convertPdfToImage(pdfPath: string, documentType?: string): Promise<string> {
  const tempDir = os.tmpdir();
  const outputBase = path.join(tempDir, `pdf-convert-${Date.now()}`);

  // Get file size to determine base DPI
  const fileSizeBytes = fs.statSync(pdfPath).size;
  const fileSizeMB = fileSizeBytes / (1024 * 1024);

  // Document types that require higher DPI for accurate digit/text recognition
  const highPrecisionDocTypes = ['sa_id', 'id_document', 'drivers_license', 'passport'];
  const needsHighPrecision = documentType && highPrecisionDocTypes.includes(documentType);

  // Adaptive DPI based on file size
  let dpi: number;
  if (fileSizeMB > 3) {
    dpi = 100; // Fast for large files
  } else if (fileSizeMB > 1) {
    dpi = 150; // Balanced
  } else {
    dpi = 200; // High quality for small files
  }

  // Override: ID documents need minimum 150 DPI for accurate digit recognition
  // SA ID numbers have 13 small digits that get blurry at 100 DPI
  if (needsHighPrecision && dpi < 150) {
    log.info('Boosting DPI for ID document precision', { originalDpi: dpi, boostedDpi: 150, documentType });
    dpi = 150;
  }

  // Adaptive timeout: larger files need more time for conversion
  // Base 30s + 10s per MB over 2MB
  const conversionTimeout = Math.max(30000, 30000 + Math.floor((fileSizeMB - 2) * 10000));

  log.info('Converting PDF with adaptive DPI', {
    fileSizeMB: fileSizeMB.toFixed(2),
    dpi,
    documentType,
    needsHighPrecision,
    timeoutMs: conversionTimeout
  });

  try {
    // Use pdftoppm to convert first page of PDF to PNG
    // -png: output PNG format
    // -f 1 -l 1: only first page
    // -r {dpi}: adaptive DPI based on file size
    execSync(`pdftoppm -png -f 1 -l 1 -r ${dpi} "${pdfPath}" "${outputBase}"`, {
      timeout: conversionTimeout,
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

async function handler(
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

    // Process OCR with timeout (120s total: PDF conversion + orientation + OCR)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
      // Convert PDF to image if necessary
      let filePathForOcr = uploadedFile.filepath;
      if (isPdf) {
        log.info('Converting PDF to image for OCR', { filename: uploadedFile.originalFilename, documentType });
        filePathForOcr = await convertPdfToImage(uploadedFile.filepath, documentType);
        tempFilePaths.push(uploadedFile.filepath); // Add original PDF for cleanup
      }

      // First pass: resize without rotation and upload to get URL for orientation detection
      const originalPath = filePathForOcr;
      const tempResizedPath = await resizeImageForVlm(filePathForOcr, 0); // No rotation yet
      if (tempResizedPath !== originalPath) {
        tempFilePaths.push(tempResizedPath);
      }

      // Upload for orientation detection
      let fileUrl = await uploadAndGetUrl(
        tempResizedPath,
        uploadedFile.originalFilename || 'document',
        'orient-check'
      );

      // Detect if image is rotated/sideways
      log.info('Detecting image orientation');
      const detectedRotation = await detectImageOrientation(fileUrl);

      // If rotation needed, reprocess the image with rotation correction
      if (detectedRotation !== 0) {
        log.info('Image rotation detected, applying correction', { rotation: detectedRotation });

        // Reprocess with rotation
        const rotatedPath = await resizeImageForVlm(originalPath, detectedRotation);
        if (rotatedPath !== originalPath && rotatedPath !== tempResizedPath) {
          tempFilePaths.push(rotatedPath);
        }

        // Re-upload the rotated image
        fileUrl = await uploadAndGetUrl(
          rotatedPath,
          uploadedFile.originalFilename || 'document',
          'rotated'
        );
      }

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

      // Validate SA ID number length (must be exactly 13 digits)
      if ((documentType === 'sa_id' || documentType === 'id_document') && extractedFields.documentNumber) {
        const idValue = String(extractedFields.documentNumber.value || '').replace(/[\s\-]/g, '');
        if (idValue.length !== 13) {
          log.warn('SA ID extraction returned wrong digit count', {
            extracted: idValue,
            digitCount: idValue.length,
            expected: 13,
            documentType,
          });

          // Add validation warning for incorrect length
          extractedFields._idLengthWarning = {
            value: `Extracted ID "${idValue}" has ${idValue.length} digits instead of 13. Please verify manually.`,
            confidence: 1.0,
            validated: false,
          };

          // Lower confidence since we know it's incorrect
          extractedFields.documentNumber.confidence = 0.5;
          extractedFields.documentNumber.validated = false;
        } else {
          log.info('SA ID extraction validated', { idValue, digitCount: 13 });
        }
      }

      // Cross-validate SA ID number against DOB for SA ID documents
      if ((documentType === 'sa_id' || documentType === 'id_document') && extractedFields.documentNumber && extractedFields.dateOfBirth) {
        const crossValidation = crossValidateSaIdWithDob(
          extractedFields.documentNumber.value,
          extractedFields.dateOfBirth.value
        );

        if (crossValidation.corrected) {
          log.info('SA ID cross-validation applied correction', {
            original: extractedFields.documentNumber.value,
            corrected: crossValidation.correctedId,
            dob: extractedFields.dateOfBirth.value,
            reason: crossValidation.reason,
          });

          // Update the ID number with corrected value
          extractedFields.documentNumber = {
            value: crossValidation.correctedId,
            confidence: 0.90, // Slightly lower confidence for corrected values
            validated: true,
          };

          // Add a note about the correction
          extractedFields._idCorrectionNote = {
            value: crossValidation.reason,
            confidence: 1.0,
            validated: true,
          };
        } else if (crossValidation.mismatch) {
          log.warn('SA ID / DOB mismatch detected but could not auto-correct', {
            id: extractedFields.documentNumber.value,
            dob: extractedFields.dateOfBirth.value,
            reason: crossValidation.reason,
          });

          // Flag the mismatch for manual review
          extractedFields._idValidationWarning = {
            value: crossValidation.reason,
            confidence: 1.0,
            validated: false,
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

      // Validate extracted data against staff record
      let validation: ValidationResult | undefined;
      try {
        validation = await validateDocument(staffId, detectedType, extractedData);
        log.info('Document validation completed', {
          staffId,
          documentType: detectedType,
          isValid: validation.isValid,
          matchScore: validation.matchScore,
          mismatches: validation.mismatches.length,
          matches: validation.matches.length,
        });
      } catch (validationError) {
        log.warn('Document validation failed', { staffId, documentType: detectedType, error: validationError });
        // Continue without validation - non-critical
      }

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
        validation,
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
        log.error('OCR timeout after 120 seconds', ocrError, 'OcrPreviewAPI');
        return res.status(504).json({ error: 'OCR processing timed out after 120 seconds. Please try manual entry.' });
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

export default withAuth(handler);
