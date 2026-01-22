/**
 * Contractors Documents Upload API - Flat Endpoint
 * POST /api/contractors-documents-upload
 * Handles file upload to VF Storage API + metadata to Neon
 *
 * Protected by Arcjet:
 * - Bot detection
 * - Rate limiting (30 req/min)
 * - Attack protection
 *
 * @see docs/ARCHITECTURE_STORAGE.md for storage architecture
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import formidable from 'formidable';
import fs from 'fs';
import { vfStorage } from '@/services/vfStorageAdapter';
import { withArcjetProtection, ajStrict } from '@/lib/arcjet';

const sql = neon(process.env.DATABASE_URL || '');

// Disable body parser to handle multipart form data
// Increase response size limit to allow 10MB file uploads
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
    const contractorId = Array.isArray(fields.contractorId) ? fields.contractorId[0] : fields.contractorId;
    const documentType = Array.isArray(fields.documentType) ? fields.documentType[0] : fields.documentType;
    const documentName = Array.isArray(fields.documentName) ? fields.documentName[0] : fields.documentName;
    const documentNumber = Array.isArray(fields.documentNumber) ? fields.documentNumber[0] : fields.documentNumber;
    const issueDate = Array.isArray(fields.issueDate) ? fields.issueDate[0] : fields.issueDate;
    const expiryDate = Array.isArray(fields.expiryDate) ? fields.expiryDate[0] : fields.expiryDate;
    const notes = Array.isArray(fields.notes) ? fields.notes[0] : fields.notes;
    const uploadedBy = Array.isArray(fields.uploadedBy) ? fields.uploadedBy[0] : fields.uploadedBy;

    // Validate required fields
    if (!contractorId || !documentType || !documentName || !uploadedBy) {
      return res.status(400).json({
        error: 'Missing required fields: contractorId, documentType, documentName, uploadedBy'
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
      'application/msword',                                                      // .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.ms-excel',                                                // .xls
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',      // .xlsx
    ];
    if (!allowedTypes.includes(file.mimetype || '')) {
      return res.status(400).json({
        error: `Invalid file type. Allowed: PDF, JPG, PNG, Word (DOC/DOCX), Excel (XLS/XLSX)`
      });
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return res.status(400).json({
        error: 'File too large. Maximum size: 10MB'
      });
    }

    // Read file buffer
    const fileBuffer = await fs.promises.readFile(file.filepath);

    // Upload to VF Storage API
    // Path convention: contractors/documents/{contractorId}_{timestamp}_{filename}
    const sanitizedFileName = sanitizeFileName(file.originalFilename || 'document');
    const uniqueFilename = `${contractorId}_${Date.now()}_${sanitizedFileName}`;
    const uploadResult = await vfStorage.uploadFile(
      fileBuffer,
      'contractors',
      'documents',
      uniqueFilename
    );

    uploadedToStorage = true;
    storagePath = uploadResult.path;

    // Use URL from VF Storage response
    const fileUrl = uploadResult.url;

    // Save metadata to Neon
    const [document] = await sql`
      INSERT INTO contractor_documents (
        contractor_id,
        document_type,
        document_name,
        document_number,
        file_name,
        file_path,
        file_url,
        file_size,
        mime_type,
        issue_date,
        expiry_date,
        is_expired,
        status,
        notes,
        uploaded_by
      ) VALUES (
        ${contractorId},
        ${documentType},
        ${documentName},
        ${documentNumber || null},
        ${sanitizedFileName},
        ${storagePath},
        ${fileUrl},
        ${file.size},
        ${file.mimetype},
        ${issueDate ? new Date(issueDate) : null},
        ${expiryDate ? new Date(expiryDate) : null},
        ${false},
        ${'pending'},
        ${notes || null},
        ${'system'}
      )
      RETURNING *
    `;

    // Clean up temp file
    if (tempFilePath) {
      await fs.promises.unlink(tempFilePath).catch(() => {
        // Ignore cleanup errors
      });
    }

    return res.status(201).json({
      success: true,
      data: mapDbToDocument(document)
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Document upload error:', errorMessage);

    // Cleanup: Remove uploaded file from VF Storage if DB insert failed
    if (uploadedToStorage && storagePath) {
      try {
        // Parse storage path: contractors/documents/{filename}
        const pathParts = storagePath.split('/');
        if (pathParts.length >= 3) {
          const filename = pathParts[pathParts.length - 1];
          await vfStorage.deleteFile('contractors', 'documents', filename);
          console.log('Cleaned up VF Storage file after error:', storagePath);
        }
      } catch (cleanupError) {
        console.error('Failed to cleanup VF Storage file:', cleanupError);
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
      message: errorMessage
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

// Map database row to ContractorDocument interface
function mapDbToDocument(row: any) {
  return {
    id: row.id,
    contractorId: row.contractor_id,
    documentType: row.document_type,
    documentName: row.document_name,
    documentNumber: row.document_number,
    fileName: row.file_name,
    filePath: row.file_path,
    fileUrl: row.file_url,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    issueDate: row.issue_date ? new Date(row.issue_date) : undefined,
    expiryDate: row.expiry_date ? new Date(row.expiry_date) : undefined,
    isExpired: row.is_expired,
    daysUntilExpiry: row.days_until_expiry,
    isVerified: row.is_verified,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at ? new Date(row.verified_at) : undefined,
    verificationNotes: row.verification_notes,
    status: row.status,
    rejectionReason: row.rejection_reason,
    notes: row.notes,
    tags: row.tags || [],
    uploadedBy: row.uploaded_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
