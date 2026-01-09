/**
 * Staff Documents Upload API
 * POST /api/staff-documents-upload
 * Handles file upload to local storage + metadata to Neon
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
import { localFileStorage } from '@/services/localFileStorage';
import { withArcjetProtection, ajStrict } from '@/lib/arcjet';
import { createLogger } from '@/lib/logger';
import type { DocumentType } from '@/types/staff-document.types';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('StaffDocumentsUploadAPI');

// Valid document types
const VALID_DOCUMENT_TYPES: DocumentType[] = [
  'id_document',
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
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let tempFilePath: string | null = null;
  let uploadedToStorage = false;
  let storagePath: string | null = null;

  try {
    // Parse multipart form data
    const { fields, files } = await parseForm(req);

    // Extract fields
    const staffId = Array.isArray(fields.staffId) ? fields.staffId[0] : fields.staffId;
    const documentType = Array.isArray(fields.documentType) ? fields.documentType[0] : fields.documentType;
    const documentName = Array.isArray(fields.documentName) ? fields.documentName[0] : fields.documentName;
    const documentNumber = Array.isArray(fields.documentNumber) ? fields.documentNumber[0] : fields.documentNumber;
    const issuedDate = Array.isArray(fields.issuedDate) ? fields.issuedDate[0] : fields.issuedDate;
    const expiryDate = Array.isArray(fields.expiryDate) ? fields.expiryDate[0] : fields.expiryDate;
    const issuingAuthority = Array.isArray(fields.issuingAuthority) ? fields.issuingAuthority[0] : fields.issuingAuthority;

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

    // Get uploaded file
    const fileArray = Array.isArray(files.file) ? files.file : [files.file];
    const file = fileArray[0];

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Store temp file path for cleanup
    tempFilePath = file.filepath;

    // Validate file type - Allow PDF, images, Word, and Excel
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (!allowedTypes.includes(file.mimetype || '')) {
      return res.status(400).json({
        error: 'Invalid file type. Allowed: PDF, JPG, PNG, Word (DOC/DOCX), Excel (XLS/XLSX)',
      });
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return res.status(400).json({
        error: 'File too large. Maximum size: 10MB',
      });
    }

    // Read file buffer
    const fileBuffer = await fs.promises.readFile(file.filepath);

    // Upload to local storage
    const uploadPath = localFileStorage.getStaffDocumentPath(staffId, documentType);
    const uploadResult = await localFileStorage.uploadFile(
      fileBuffer,
      uploadPath,
      file.originalFilename || 'document',
      file.mimetype || 'application/octet-stream'
    );

    uploadedToStorage = true;
    storagePath = uploadResult.path;

    // Generate file URL (use API endpoint for serving files)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    const fileUrl = `${baseUrl}/api/uploads/${uploadResult.path}`;

    // Save metadata to Neon
    const [document] = await sql`
      INSERT INTO staff_documents (
        staff_id,
        document_type,
        document_name,
        file_url,
        file_size,
        mime_type,
        expiry_date,
        issued_date,
        issuing_authority,
        document_number,
        verification_status
      ) VALUES (
        ${staffId},
        ${documentType},
        ${documentName},
        ${fileUrl},
        ${file.size},
        ${file.mimetype},
        ${expiryDate ? new Date(expiryDate) : null},
        ${issuedDate ? new Date(issuedDate) : null},
        ${issuingAuthority || null},
        ${documentNumber || null},
        ${'pending'}
      )
      RETURNING *
    `;

    // Clean up temp file
    if (tempFilePath) {
      await fs.promises.unlink(tempFilePath).catch(() => {
        // Ignore cleanup errors
      });
    }

    if (!document) {
      throw new Error('Failed to create document record');
    }

    logger.info('Staff document uploaded', { staffId, documentType, documentId: document.id });

    return res.status(201).json({
      success: true,
      document: mapDbToDocument(document as Record<string, unknown>),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Staff document upload error', { error: errorMessage });

    // Cleanup: Remove uploaded file from local storage if DB insert failed
    if (uploadedToStorage && storagePath) {
      try {
        await localFileStorage.deleteFile(storagePath);
        logger.info('Cleaned up local file after error', { path: storagePath });
      } catch (cleanupError: unknown) {
        const cleanupMsg = cleanupError instanceof Error ? cleanupError.message : 'Unknown';
        logger.error('Failed to cleanup local file', { error: cleanupMsg });
      }
    }

    // Cleanup: Remove temp file
    if (tempFilePath) {
      await fs.promises.unlink(tempFilePath).catch(() => {
        // Ignore cleanup errors
      });
    }

    return res.status(500).json({
      error: 'Failed to upload document',
      message: errorMessage,
    });
  }
}

// Export with Arcjet protection
export default withArcjetProtection(handler, ajStrict);

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
