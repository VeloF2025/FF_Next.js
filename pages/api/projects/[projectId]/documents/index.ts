/**
 * Project Documents API - List and Create
 * GET /api/projects/[projectId]/documents - List project documents
 * POST /api/projects/[projectId]/documents - Upload new document
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import { promises as fs } from 'fs';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { VFStorageService } from '@/services/vfStorageAdapter';
import type { ProjectDocument, ProjectDocumentCreateInput, ProjectDocumentType } from '@/modules/projects/types/po-extraction.types';

const sql = createLoggedSql(process.env.DATABASE_URL!);

// Disable body parsing for POST (multipart form data)
export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB for documents
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const VALID_DOC_TYPES: ProjectDocumentType[] = ['bss', 'mss', 'contract', 'amendment', 'wayleave', 'permit', 'other'];

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const userId = (req as AuthenticatedNextApiRequest).user.id;
  const projectId = req.query.projectId as string;

  if (!projectId) {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  // GET - List documents
  if (req.method === 'GET') {
    return handleGet(req, res, projectId);
  }

  // POST - Upload document
  if (req.method === 'POST') {
    return handlePost(req, res, projectId, userId);
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}));

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string
) {
  try {
    const documentType = req.query.type as string | undefined;
    const clientPoId = req.query.clientPoId as string | undefined;
    const activeOnly = req.query.activeOnly !== 'false'; // Default to true

    const documents = await sql`
      SELECT
        pd.*,
        cpo.po_number as client_po_number
      FROM project_documents pd
      LEFT JOIN client_purchase_orders cpo ON cpo.id = pd.client_po_id
      WHERE pd.project_id = ${projectId}
      ${activeOnly ? sql`AND pd.is_active = true` : sql``}
      ${documentType ? sql`AND pd.document_type = ${documentType}` : sql``}
      ${clientPoId ? sql`AND pd.client_po_id = ${clientPoId}` : sql``}
      ORDER BY pd.uploaded_at DESC
    `;

    return apiResponse.success(res, {
      documents: documents.map(transformDocument),
      count: documents.length,
    });
  } catch (error) {
    log.error('Failed to fetch project documents', { projectId, error });
    return apiResponse.databaseError(res, error, 'Failed to fetch documents');
  }
}

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string,
  userId: string
) {
  try {
    // Parse multipart form data
    const form = formidable({
      maxFileSize: MAX_FILE_SIZE,
      keepExtensions: true,
    });

    const [fields, files] = await form.parse(req);
    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;

    if (!uploadedFile) {
      return apiResponse.badRequest(res, 'No file uploaded');
    }

    // Validate file type
    const mimeType = uploadedFile.mimetype || '';
    if (!ALLOWED_TYPES.includes(mimeType)) {
      return apiResponse.badRequest(res, `Invalid file type: ${mimeType}`);
    }

    // Get form fields
    const documentType = getFieldValue(fields.documentType) as ProjectDocumentType;
    const description = getFieldValue(fields.description);
    const version = getFieldValue(fields.version);
    const effectiveDate = getFieldValue(fields.effectiveDate);
    const expiryDate = getFieldValue(fields.expiryDate);
    const clientPoId = getFieldValue(fields.clientPoId);

    // Validate document type
    if (!documentType || !VALID_DOC_TYPES.includes(documentType)) {
      return apiResponse.badRequest(res, `Invalid document type: ${documentType}`);
    }

    const originalName = uploadedFile.originalFilename || 'document.pdf';

    // For BSS/MSS, deactivate existing active documents of same type
    if (documentType === 'bss' || documentType === 'mss') {
      await sql`
        UPDATE project_documents
        SET is_active = false, updated_at = NOW()
        WHERE project_id = ${projectId}
          AND document_type = ${documentType}
          AND is_active = true
      `;
      log.info('[ProjectDocs] Deactivated previous document', {
        projectId,
        documentType,
      });
    }

    // Upload to VF Storage
    const vfStorage = new VFStorageService();
    const timestamp = Date.now();
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `${documentType}_${timestamp}_${sanitizedName}`;

    const fileBuffer = await fs.readFile(uploadedFile.filepath);
    const uploadResult = await vfStorage.uploadFile(
      fileBuffer,
      'projects',
      `documents/${projectId}`,
      storagePath
    );

    // Clean up temp file
    await fs.unlink(uploadedFile.filepath).catch(() => { /* ignore */ });

    // Insert document record
    const result = await sql`
      INSERT INTO project_documents (
        project_id,
        document_type,
        document_name,
        file_url,
        file_path,
        file_size,
        mime_type,
        description,
        version,
        effective_date,
        expiry_date,
        client_po_id,
        uploaded_by
      ) VALUES (
        ${projectId},
        ${documentType},
        ${originalName},
        ${uploadResult.url},
        ${uploadResult.path},
        ${uploadedFile.size},
        ${mimeType},
        ${description || null},
        ${version || null},
        ${effectiveDate || null},
        ${expiryDate || null},
        ${clientPoId || null},
        ${userId || 'system'}
      )
      RETURNING *
    `;

    const newDoc = result[0];
    if (!newDoc) {
      return apiResponse.internalError(res, new Error('Failed to create document record'));
    }

    log.info('[ProjectDocs] Document uploaded', {
      projectId,
      documentId: newDoc.id,
      documentType,
      filename: originalName,
      size: uploadedFile.size,
    });

    return apiResponse.created(res, {
      document: transformDocument(newDoc),
    });
  } catch (error) {
    log.error('Failed to upload project document', { projectId, error });
    return apiResponse.databaseError(res, error, 'Failed to upload document');
  }
}

function getFieldValue(field: string | string[] | undefined): string | null {
  if (!field) return null;
  return Array.isArray(field) ? (field[0] ?? null) : field;
}

function transformDocument(row: Record<string, unknown>): ProjectDocument {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    documentType: row.document_type as ProjectDocumentType,
    documentName: row.document_name as string,
    fileUrl: row.file_url as string,
    filePath: row.file_path as string | undefined,
    fileSize: row.file_size as number | undefined,
    mimeType: row.mime_type as string | undefined,
    description: row.description as string | undefined,
    version: row.version as string | undefined,
    effectiveDate: row.effective_date as string | undefined,
    expiryDate: row.expiry_date as string | undefined,
    clientPoId: row.client_po_id as string | undefined,
    uploadedBy: row.uploaded_by as string,
    uploadedAt: row.uploaded_at as string,
    isActive: row.is_active as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
