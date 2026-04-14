/**
 * Staff Documents Upload API
 * POST /api/staff-documents-upload
 * Handles file upload to VF Storage + metadata to Neon
 *
 * Protected by Arcjet:
 * - Bot detection
 * - Rate limiting (30 req/min)
 * - Attack protection
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import formidable from 'formidable';
import fs from 'fs';
import { uploadStaffDocument, isVFStorageAvailable, deleteStaffDocument } from '@/services/vfStorageAdapter';
import { withArcjetProtection, ajStrict } from '@/lib/arcjet';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { DocumentType } from '@/types/staff-document.types';
import { logDocumentUploaded } from '@/services/staff/staffAuditService';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('StaffDocumentsUploadAPI');

/** Validate file content matches expected type by checking magic bytes */
function validateMagicBytes(buffer: Buffer): { valid: boolean; detectedType: string } {
  if (buffer.length < 4) return { valid: false, detectedType: 'unknown' };
  const hex = buffer.subarray(0, 8).toString('hex').toUpperCase();
  if (hex.startsWith('FFD8FF')) return { valid: true, detectedType: 'image/jpeg' };
  if (hex.startsWith('89504E47')) return { valid: true, detectedType: 'image/png' };
  if (hex.startsWith('25504446')) return { valid: true, detectedType: 'application/pdf' };
  if (hex.startsWith('D0CF11E0')) return { valid: true, detectedType: 'application/msword' };
  if (hex.startsWith('504B0304')) return { valid: true, detectedType: 'application/zip' };
  return { valid: false, detectedType: 'unknown' };
}

// Valid document types
const VALID_DOCUMENT_TYPES: DocumentType[] = [
  'sa_id',
  'passport',
  'drivers_license',
  'employment_contract',
  'certification',
  'qualification',
  'medical_certificate',
  'police_clearance',
  'bank_details',
  'tax_document',
  'other',
];

// Disable body parser to handle multipart form data
export const config = {
  api: {
    bodyParser: false,
    responseLimit: '10mb',
  },
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const tempFilePaths: string[] = [];
  const uploadedPaths: string[] = [];

  try {
    // Parse multipart form data
    const { fields, files } = await parseForm(req);

    // Extract fields
    const staffId = Array.isArray(fields.staffId) ? fields.staffId[0] : fields.staffId;
    const documentType = Array.isArray(fields.documentType) ? fields.documentType[0] : fields.documentType;
    const documentName = Array.isArray(fields.documentName) ? fields.documentName[0] : fields.documentName;
    const documentNumber = Array.isArray(fields.documentNumber) ? fields.documentNumber[0] : fields.documentNumber;
    const issuedDate = Array.isArray(fields.issuedDate) ? fields.issuedDate[0] : fields.issuedDate;
    const issuingAuthority = Array.isArray(fields.issuingAuthority) ? fields.issuingAuthority[0] : fields.issuingAuthority;

    // Driver's license specific fields
    const licenseNumber = Array.isArray(fields.licenseNumber) ? fields.licenseNumber[0] : fields.licenseNumber;
    const licenseCodes = Array.isArray(fields.licenseCodes) ? fields.licenseCodes[0] : fields.licenseCodes;
    const validFrom = Array.isArray(fields.validFrom) ? fields.validFrom[0] : fields.validFrom;
    const validTo = Array.isArray(fields.validTo) ? fields.validTo[0] : fields.validTo;

    // Bank statement specific fields (from OCR extraction)
    const bankName = Array.isArray(fields.bankName) ? fields.bankName[0] : fields.bankName;
    const bankAccountNumber = Array.isArray(fields.bankAccountNumber) ? fields.bankAccountNumber[0] : fields.bankAccountNumber;
    const bankBranchCode = Array.isArray(fields.bankBranchCode) ? fields.bankBranchCode[0] : fields.bankBranchCode;
    const bankAccountType = Array.isArray(fields.bankAccountType) ? fields.bankAccountType[0] : fields.bankAccountType;
    const bankAccountHolder = Array.isArray(fields.bankAccountHolder) ? fields.bankAccountHolder[0] : fields.bankAccountHolder;

    // Employment contract specific fields (from OCR extraction)
    const employeeName = Array.isArray(fields.employeeName) ? fields.employeeName[0] : fields.employeeName;
    const employeeIdNumber = Array.isArray(fields.employeeIdNumber) ? fields.employeeIdNumber[0] : fields.employeeIdNumber;
    const companyName = Array.isArray(fields.companyName) ? fields.companyName[0] : fields.companyName;
    const jobTitle = Array.isArray(fields.jobTitle) ? fields.jobTitle[0] : fields.jobTitle;
    const startDate = Array.isArray(fields.startDate) ? fields.startDate[0] : fields.startDate;
    const employmentType = Array.isArray(fields.employmentType) ? fields.employmentType[0] : fields.employmentType;
    const salary = Array.isArray(fields.salary) ? fields.salary[0] : fields.salary;
    const salaryPeriod = Array.isArray(fields.salaryPeriod) ? fields.salaryPeriod[0] : fields.salaryPeriod;

    // Use expiryDate, or validTo for driver's licenses
    const rawExpiryDate = Array.isArray(fields.expiryDate) ? fields.expiryDate[0] : fields.expiryDate;
    const expiryDate = rawExpiryDate || validTo; // validTo is used for driver's licenses

    // For driver's licenses, use licenseNumber as documentNumber and validFrom as issuedDate
    const effectiveDocumentNumber = documentNumber || licenseNumber;
    const effectiveIssuedDate = issuedDate || validFrom;

    // OCR-first flow fields (PRD-033)
    const ocrConfirmedRaw = Array.isArray(fields.ocrConfirmed) ? fields.ocrConfirmed[0] : fields.ocrConfirmed;
    const ocrConfirmed = ocrConfirmedRaw === 'true';

    // All OCR-extracted data as JSON (preserves all fields for verification panel)
    const ocrExtractedDataRaw = Array.isArray(fields.ocrExtractedData) ? fields.ocrExtractedData[0] : fields.ocrExtractedData;
    let ocrExtractedData: Record<string, string> = {};
    if (ocrExtractedDataRaw) {
      try {
        ocrExtractedData = JSON.parse(ocrExtractedDataRaw);
      } catch {
        logger.warn('Failed to parse ocrExtractedData', { raw: ocrExtractedDataRaw });
      }
    }

    // Validate required fields
    if (!staffId || !documentType || !documentName) {
      return res.status(400).json({
        error: 'Missing required fields: staffId, documentType, documentName',
      });
    }

    // Validate document type
    if (!VALID_DOCUMENT_TYPES.includes(documentType as DocumentType)) {
      return res.status(400).json({
        error: `Invalid document type. Allowed: ${VALID_DOCUMENT_TYPES.join(', ')}`,
      });
    }

    // Validate file type helper
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    const maxSize = 10 * 1024 * 1024;

    const validateFile = (file: formidable.File | undefined, name: string) => {
      if (!file) {
        throw new Error(`No ${name} file uploaded`);
      }
      if (!allowedTypes.includes(file.mimetype || '')) {
        throw new Error(`Invalid ${name} file type. Allowed: PDF, JPG, PNG, Word, Excel`);
      }
      if (file.size > maxSize) {
        throw new Error(`${name} file too large. Maximum size: 10MB`);
      }
      return file;
    };

    // Check for multi-file upload (driver's license front+back) or single file
    let fileFront: formidable.File | undefined;
    let fileBack: formidable.File | undefined;

    // First, check for single file upload (works for all document types including driver's license)
    const fileArray = Array.isArray(files.file) ? files.file : [files.file];
    const file: formidable.File | undefined = fileArray[0];

    // If no single file and it's a driver's license, check for front+back (legacy support)
    const isMultiFile = documentType === 'drivers_license' && !file;

    if (isMultiFile) {
      // Get front and back files (legacy multi-file upload)
      const fileFrontArray = Array.isArray(files.fileFront) ? files.fileFront : [files.fileFront];
      const fileBackArray = Array.isArray(files.fileBack) ? files.fileBack : [files.fileBack];
      fileFront = fileFrontArray[0];
      fileBack = fileBackArray[0];

      if (!fileFront || !fileBack) {
        return apiResponse.badRequest(res, 'No file uploaded. Please select a document.');
      }

      validateFile(fileFront, 'front');
      validateFile(fileBack, 'back');
      tempFilePaths.push(fileFront.filepath, fileBack.filepath);
    } else if (file) {
      // Single file upload (standard flow for all document types)
      validateFile(file, 'document');
      tempFilePaths.push(file.filepath);
    } else {
      return apiResponse.badRequest(res, 'No file uploaded');
    }

    // Check if VF Storage is available (required)
    const storageAvailable = await isVFStorageAvailable();
    if (!storageAvailable) {
      logger.error('VF Storage server is not available');
      return res.status(503).json({
        error: 'Storage service unavailable',
        message: 'The file storage server is not responding. Please try again later.',
      });
    }

    let fileUrl = '';
    let filePath = '';
    let fileUrlFront = '';
    let filePathFront = '';
    let fileUrlBack = '';
    let filePathBack = '';
    let primaryFileName = '';
    let primaryFileSize = 0;
    let primaryMimeType = '';

    if (isMultiFile && fileFront && fileBack) {
      // Upload front file
      logger.info('Uploading driver\'s license front to VF Storage', { staffId });
      const frontBuffer = await fs.promises.readFile(fileFront.filepath);
      const frontValidation = validateMagicBytes(frontBuffer);
      if (!frontValidation.valid) {
        return apiResponse.badRequest(res, 'Front file content does not match an allowed type.');
      }
      const frontResult = await uploadStaffDocument(
        staffId,
        frontBuffer,
        `front_${fileFront.originalFilename || 'document'}`,
        documentType
      );
      fileUrlFront = frontResult.url;
      filePathFront = frontResult.path;
      uploadedPaths.push(filePathFront);

      // Upload back file
      logger.info('Uploading driver\'s license back to VF Storage', { staffId });
      const backBuffer = await fs.promises.readFile(fileBack.filepath);
      const backValidation = validateMagicBytes(backBuffer);
      if (!backValidation.valid) {
        return apiResponse.badRequest(res, 'Back file content does not match an allowed type.');
      }
      const backResult = await uploadStaffDocument(
        staffId,
        backBuffer,
        `back_${fileBack.originalFilename || 'document'}`,
        documentType
      );
      fileUrlBack = backResult.url;
      filePathBack = backResult.path;
      uploadedPaths.push(filePathBack);

      // Use front file as primary for metadata
      primaryFileName = fileFront.originalFilename || 'document';
      primaryFileSize = fileFront.size + fileBack.size;
      primaryMimeType = fileFront.mimetype || '';
    } else if (file) {
      // Single file upload
      logger.info('Uploading to VF Storage', { staffId, documentType });
      const fileBuffer = await fs.promises.readFile(file.filepath);
      const { valid: magicValid } = validateMagicBytes(fileBuffer);
      if (!magicValid) {
        return apiResponse.badRequest(res, 'File content does not match an allowed type (PDF, JPG, PNG, Word, Excel).');
      }
      const vfResult = await uploadStaffDocument(
        staffId,
        fileBuffer,
        file.originalFilename || 'document',
        documentType
      );
      fileUrl = vfResult.url;
      filePath = vfResult.path;
      uploadedPaths.push(filePath);

      primaryFileName = file.originalFilename || 'document';
      primaryFileSize = file.size;
      primaryMimeType = file.mimetype || '';
    }

    // Determine verification status based on expiry date
    // If document has expired, mark as 'expired' instead of 'pending'
    let verificationStatus = 'pending';
    if (expiryDate) {
      const expiry = new Date(expiryDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Compare dates only, not time
      if (expiry < today) {
        verificationStatus = 'expired';
        logger.info('Document has expired', { staffId, documentType, expiryDate });
      }
    }

    // Build OCR metadata object (synced to staff on verification only)
    // All compulsory docs with OCR-extracted fields store data here until verified
    // Start with all extracted OCR data (fullName, dateOfBirth, surname, etc.)
    const ocrMetadata: Record<string, string | undefined> = { ...ocrExtractedData };

    // Bank details - add specific fields
    if (documentType === 'bank_details' || documentType === 'bank_statement') {
      if (bankName) ocrMetadata.bankName = bankName;
      if (bankAccountNumber) ocrMetadata.bankAccountNumber = bankAccountNumber;
      if (bankBranchCode) ocrMetadata.bankBranchCode = bankBranchCode;
      if (bankAccountType) ocrMetadata.bankAccountType = bankAccountType;
      if (bankAccountHolder) ocrMetadata.bankAccountHolder = bankAccountHolder;
    }

    // SA ID - store ID number in metadata, sync to staff on verification
    if (documentType === 'sa_id') {
      if (effectiveDocumentNumber) ocrMetadata.saIdNumber = effectiveDocumentNumber;
      // Map common OCR field names to expected names
      if (ocrExtractedData.documentNumber && !ocrMetadata.saIdNumber) {
        ocrMetadata.saIdNumber = ocrExtractedData.documentNumber;
      }
      // Combine firstName + surname into fullName if not present
      if (!ocrMetadata.fullName && (ocrExtractedData.firstName || ocrExtractedData.surname)) {
        const parts = [ocrExtractedData.firstName, ocrExtractedData.surname].filter(Boolean);
        if (parts.length > 0) {
          ocrMetadata.fullName = parts.join(' ');
        }
      }
    }

    // Passport - store passport details in metadata, sync to staff on verification
    if (documentType === 'passport') {
      // Map passport number from various sources
      if (effectiveDocumentNumber) ocrMetadata.passportNumber = effectiveDocumentNumber;
      if (!ocrMetadata.passportNumber && ocrExtractedData.passportNumber) {
        ocrMetadata.passportNumber = ocrExtractedData.passportNumber;
      }
      if (!ocrMetadata.passportNumber && ocrExtractedData.documentNumber) {
        ocrMetadata.passportNumber = ocrExtractedData.documentNumber;
      }

      // Map expiry date
      if (expiryDate) ocrMetadata.passportExpiry = expiryDate;
      if (!ocrMetadata.passportExpiry && ocrExtractedData.expiryDate) {
        ocrMetadata.passportExpiry = ocrExtractedData.expiryDate;
      }
      if (!ocrMetadata.passportExpiry && ocrExtractedData.expirationDate) {
        ocrMetadata.passportExpiry = ocrExtractedData.expirationDate;
      }

      // Map country from various sources
      if (issuingAuthority) ocrMetadata.passportCountry = issuingAuthority;
      if (!ocrMetadata.passportCountry && ocrExtractedData.issuingCountry) {
        ocrMetadata.passportCountry = ocrExtractedData.issuingCountry;
      }
      if (!ocrMetadata.passportCountry && ocrExtractedData.nationality) {
        ocrMetadata.passportCountry = ocrExtractedData.nationality;
      }
      if (!ocrMetadata.passportCountry && ocrExtractedData.countryOfBirth) {
        ocrMetadata.passportCountry = ocrExtractedData.countryOfBirth;
      }

      // Combine firstName + surname into fullName if not present
      if (!ocrMetadata.fullName && (ocrExtractedData.firstName || ocrExtractedData.surname)) {
        const parts = [ocrExtractedData.firstName, ocrExtractedData.surname].filter(Boolean);
        if (parts.length > 0) {
          ocrMetadata.fullName = parts.join(' ');
        }
      }
    }

    // Driver's License - store license details in metadata, sync to staff on verification
    if (documentType === 'drivers_license') {
      // Map license number from various sources
      if (effectiveDocumentNumber) ocrMetadata.driversLicenseNumber = effectiveDocumentNumber;
      if (!ocrMetadata.driversLicenseNumber && ocrExtractedData.licenseNumber) {
        ocrMetadata.driversLicenseNumber = ocrExtractedData.licenseNumber;
      }
      if (!ocrMetadata.driversLicenseNumber && ocrExtractedData.documentNumber) {
        ocrMetadata.driversLicenseNumber = ocrExtractedData.documentNumber;
      }

      // Map expiry date from various sources
      if (expiryDate) ocrMetadata.driversLicenseExpiry = expiryDate;
      if (!ocrMetadata.driversLicenseExpiry && ocrExtractedData.expiryDate) {
        ocrMetadata.driversLicenseExpiry = ocrExtractedData.expiryDate;
      }
      if (!ocrMetadata.driversLicenseExpiry && ocrExtractedData.expirationDate) {
        ocrMetadata.driversLicenseExpiry = ocrExtractedData.expirationDate;
      }
      if (!ocrMetadata.driversLicenseExpiry && ocrExtractedData.validUntil) {
        ocrMetadata.driversLicenseExpiry = ocrExtractedData.validUntil;
      }

      // Map license codes from various sources
      if (licenseCodes) ocrMetadata.driversLicenseCodes = licenseCodes;
      if (!ocrMetadata.driversLicenseCodes && ocrExtractedData.licenseCodes) {
        ocrMetadata.driversLicenseCodes = ocrExtractedData.licenseCodes;
      }
      if (!ocrMetadata.driversLicenseCodes && ocrExtractedData.vehicleCodes) {
        ocrMetadata.driversLicenseCodes = ocrExtractedData.vehicleCodes;
      }
      if (!ocrMetadata.driversLicenseCodes && ocrExtractedData.codes) {
        ocrMetadata.driversLicenseCodes = ocrExtractedData.codes;
      }

      // Map ID number (SA ID on license)
      if (ocrExtractedData.idNumber) {
        ocrMetadata.idNumber = ocrExtractedData.idNumber;
      }
      if (!ocrMetadata.idNumber && ocrExtractedData.saIdNumber) {
        ocrMetadata.idNumber = ocrExtractedData.saIdNumber;
      }

      // Combine firstName + surname into fullName if not present
      if (!ocrMetadata.fullName && (ocrExtractedData.firstName || ocrExtractedData.surname)) {
        const parts = [ocrExtractedData.firstName, ocrExtractedData.surname].filter(Boolean);
        if (parts.length > 0) {
          ocrMetadata.fullName = parts.join(' ');
        }
      }
    }

    // Employment Contract - store contract details in metadata
    if (documentType === 'employment_contract') {
      // Map employee details
      if (employeeName) ocrMetadata.employeeName = employeeName;
      if (!ocrMetadata.employeeName && ocrExtractedData.employeeName) {
        ocrMetadata.employeeName = ocrExtractedData.employeeName;
      }

      if (employeeIdNumber) ocrMetadata.employeeIdNumber = employeeIdNumber;
      if (!ocrMetadata.employeeIdNumber && ocrExtractedData.employeeIdNumber) {
        ocrMetadata.employeeIdNumber = ocrExtractedData.employeeIdNumber;
      }

      // Map company details
      if (companyName) ocrMetadata.companyName = companyName;
      if (!ocrMetadata.companyName && ocrExtractedData.companyName) {
        ocrMetadata.companyName = ocrExtractedData.companyName;
      }

      if (ocrExtractedData.companyRegistration) {
        ocrMetadata.companyRegistration = ocrExtractedData.companyRegistration;
      }

      // Map job details
      if (jobTitle) ocrMetadata.jobTitle = jobTitle;
      if (!ocrMetadata.jobTitle && ocrExtractedData.jobTitle) {
        ocrMetadata.jobTitle = ocrExtractedData.jobTitle;
      }

      if (ocrExtractedData.department) {
        ocrMetadata.department = ocrExtractedData.department;
      }

      // Map dates
      if (startDate) ocrMetadata.startDate = startDate;
      if (!ocrMetadata.startDate && ocrExtractedData.startDate) {
        ocrMetadata.startDate = ocrExtractedData.startDate;
      }

      if (ocrExtractedData.endDate) {
        ocrMetadata.endDate = ocrExtractedData.endDate;
      }

      // Map employment type
      if (employmentType) ocrMetadata.employmentType = employmentType;
      if (!ocrMetadata.employmentType && ocrExtractedData.employmentType) {
        ocrMetadata.employmentType = ocrExtractedData.employmentType;
      }

      // Map salary
      if (salary) ocrMetadata.salary = salary;
      if (!ocrMetadata.salary && ocrExtractedData.salary) {
        ocrMetadata.salary = ocrExtractedData.salary;
      }

      if (salaryPeriod) ocrMetadata.salaryPeriod = salaryPeriod;
      if (!ocrMetadata.salaryPeriod && ocrExtractedData.salaryPeriod) {
        ocrMetadata.salaryPeriod = ocrExtractedData.salaryPeriod;
      }

      // Map work location
      if (ocrExtractedData.workLocation) {
        ocrMetadata.workLocation = ocrExtractedData.workLocation;
      }
    }

    // Save metadata to Neon
    const [document] = await sql`
      INSERT INTO staff_documents (
        staff_id,
        document_type,
        document_name,
        file_url,
        file_url_front,
        file_url_back,
        file_path,
        file_name,
        file_size,
        mime_type,
        expiry_date,
        issued_date,
        issuing_authority,
        document_number,
        verification_status,
        status,
        uploaded_at,
        ocr_metadata
      ) VALUES (
        ${staffId},
        ${documentType},
        ${documentName},
        ${fileUrl || fileUrlFront},
        ${fileUrlFront || null},
        ${fileUrlBack || null},
        ${filePath || filePathFront},
        ${primaryFileName},
        ${primaryFileSize},
        ${primaryMimeType},
        ${expiryDate ? new Date(expiryDate) : null},
        ${effectiveIssuedDate ? new Date(effectiveIssuedDate) : null},
        ${issuingAuthority || null},
        ${effectiveDocumentNumber || null},
        ${verificationStatus},
        ${verificationStatus},
        NOW(),
        ${Object.keys(ocrMetadata).length > 0 ? JSON.stringify(ocrMetadata) : null}
      )
      RETURNING *
    `;

    // Clean up temp files
    for (const tempPath of tempFilePaths) {
      await fs.promises.unlink(tempPath).catch((e) => logger.debug('Temp file cleanup failed', { error: e instanceof Error ? e.message : 'unknown' }));
    }

    if (!document) {
      throw new Error('Failed to create document record');
    }

    logger.info('Staff document uploaded', { staffId, documentType, documentId: document.id, ocrConfirmed, isMultiFile });

    // Log to audit trail
    await logDocumentUploaded(
      staffId,
      documentType,
      primaryFileName,
      (req as any).user?.name || 'System',
      req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress
    );

    // Sync document data to staff table based on document type
    // This ensures OCR/manual data appears in employee details
    // NOTE: Bank details are NOT synced here - they're synced on document verification
    await syncDocumentToStaff(staffId, documentType, {
      documentNumber: effectiveDocumentNumber,
      expiryDate,
      issuingAuthority,
      fileUrl: fileUrl || fileUrlFront,
      licenseCodes, // For driver's licenses
    });

    // PRD-033: If OCR was confirmed by user, skip webhook (already processed)
    if (!ocrConfirmed) {
      // Trigger autonomous OCR processing webhook (fire and forget)
      triggerOcrWebhook({
        documentId: document.id as string,
        documentTable: 'staff_documents',
        entityType: 'staff',
        entityId: staffId,
        documentType: documentType,
        fileName: primaryFileName,
        fileUrl: fileUrl || fileUrlFront,
      }).catch((err) => {
        // Log but don't fail the upload if webhook fails
        logger.warn('OCR webhook trigger failed', { error: String(err), documentId: document.id });
      });
    } else {
      logger.info('OCR webhook skipped - user confirmed OCR results', { documentId: document.id });
    }

    return res.status(201).json({
      success: true,
      document: mapDbToDocument(document as Record<string, unknown>),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Staff document upload error', { error: errorMessage });

    // Cleanup: Remove uploaded files from VF Storage if DB insert failed
    for (const storagePath of uploadedPaths) {
      try {
        const pathParts = storagePath.split('/');
        if (pathParts.length >= 3) {
          const filename = pathParts[pathParts.length - 1];
          if (filename) {
            const staffIdFromFilename = filename.split('_')[0];
            if (staffIdFromFilename) {
              await deleteStaffDocument(staffIdFromFilename, filename);
              logger.info('Cleaned up VF Storage file after error', { path: storagePath });
            }
          }
        }
      } catch (cleanupError: unknown) {
        const cleanupMsg = cleanupError instanceof Error ? cleanupError.message : 'Unknown';
        logger.error('Failed to cleanup VF Storage file', { error: cleanupMsg });
      }
    }

    // Cleanup: Remove temp files
    for (const tempPath of tempFilePaths) {
      await fs.promises.unlink(tempPath).catch((e) => logger.debug('Temp file cleanup failed', { error: e instanceof Error ? e.message : 'unknown' }));
    }

    return res.status(500).json({
      error: 'Failed to upload document',
      message: errorMessage,
    });
  }
}

// Export with Arcjet protection and auth
export default withAuth(withArcjetProtection(handler, ajStrict));

// Parse multipart form data
function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB
      keepExtensions: true,
    });

    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

// Sanitize filename
function sanitizeFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  const name = lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
  const ext = lastDot > 0 ? fileName.substring(lastDot) : '';

  const sanitized = name
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 100);

  return sanitized + ext;
}

// Map database row to StaffDocument interface
function mapDbToDocument(row: Record<string, unknown>) {
  return {
    id: row.id,
    staffId: row.staff_id,
    documentType: row.document_type,
    documentName: row.document_name,
    fileUrl: row.file_url,
    fileUrlFront: row.file_url_front || undefined,
    fileUrlBack: row.file_url_back || undefined,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    expiryDate: row.expiry_date ? new Date(row.expiry_date as string).toISOString() : undefined,
    issuedDate: row.issued_date ? new Date(row.issued_date as string).toISOString() : undefined,
    issuingAuthority: row.issuing_authority,
    documentNumber: row.document_number,
    verificationStatus: row.verification_status,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at ? new Date(row.verified_at as string).toISOString() : undefined,
    verificationNotes: row.verification_notes,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

// Trigger OCR webhook for autonomous processing
interface OcrWebhookPayload {
  documentId: string;
  documentTable: 'staff_documents' | 'contractor_documents';
  entityType: 'staff' | 'contractor';
  entityId: string;
  documentType: string;
  fileName: string;
  fileUrl: string;
}

async function triggerOcrWebhook(payload: OcrWebhookPayload): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005';

  const response = await fetch(`${baseUrl}/api/webhooks/document-uploaded`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      uploadedAt: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Webhook failed: ${response.status} - ${error}`);
  }

  logger.info('OCR webhook triggered successfully', { documentId: payload.documentId });
}

/**
 * Sync document data to staff table based on document type
 * NOTE: Compulsory documents (SA ID, Passport, Driver's License, Bank Details) are NOT synced here.
 * They are stored in ocr_metadata and synced during document verification.
 * This function is kept for any future document types that should sync immediately.
 */
async function syncDocumentToStaff(
  staffId: string,
  documentType: string,
  data: {
    documentNumber?: string;
    expiryDate?: string;
    issuingAuthority?: string;
    fileUrl?: string;
    licenseCodes?: string;
  }
): Promise<void> {
  try {
    // Compulsory docs with OCR are synced on verification, not upload
    // This includes: sa_id, passport, drivers_license, bank_details
    const verificationSyncTypes = ['sa_id', 'passport', 'drivers_license', 'bank_details', 'bank_statement'];
    if (verificationSyncTypes.includes(documentType)) {
      logger.info('Document sync deferred to verification', { staffId, documentType });
      return;
    }

    // Other document types can sync immediately if needed in the future
    // Currently no other types require staff table sync
  } catch (error) {
    logger.warn('Failed to sync document data to staff table', {
      staffId,
      documentType,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
