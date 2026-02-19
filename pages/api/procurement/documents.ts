/**
 * Procurement Documents API
 * GET  /api/procurement/documents?entity_type=...&entity_id=...  — List documents
 * POST /api/procurement/documents  (multipart form-data)          — Upload document
 * DELETE /api/procurement/documents?id=...                        — Soft-delete document
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import formidable from 'formidable';
import fs from 'fs';
import { vfStorage } from '@/services/vfStorageAdapter';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import type { ProcurementDocument, ProcurementDocumentType, ProcurementEntityType } from '@/types/procurement/document.types';

const sql = neon(process.env.DATABASE_URL!);

export const config = {
  api: {
    bodyParser: false,
  },
};

const VALID_ENTITY_TYPES: ProcurementEntityType[] = [
  'purchase_order',
  'goods_receipt_note',
  'vendor_invoice',
  'rfq_response',
  'supplier_quote',
];

const VALID_DOCUMENT_TYPES: ProcurementDocumentType[] = [
  'quote_pdf',
  'invoice',
  'delivery_note',
  'grv',
  'receipt',
  'contract',
  'image',
  'other',
];

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

/** Magic byte validation */
function validateMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  const hex = buffer.subarray(0, 8).toString('hex').toUpperCase();
  if (hex.startsWith('FFD8FF')) return true;   // JPEG
  if (hex.startsWith('89504E47')) return true;  // PNG
  if (hex.startsWith('25504446')) return true;  // PDF
  if (hex.startsWith('504B0304')) return true;  // ZIP (docx/xlsx)
  return false;
}

/** Parse multipart form data */
function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: MAX_FILE_SIZE,
      keepExtensions: true,
    });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

/** Map DB row to ProcurementDocument */
function mapRow(row: Record<string, unknown>): ProcurementDocument {
  return {
    id: row.id as string,
    entityType: row.entity_type as string,
    entityId: row.entity_id as string,
    documentType: row.document_type as ProcurementDocumentType,
    documentName: row.document_name as string,
    fileUrl: row.file_url as string,
    filePath: (row.file_path as string) || undefined,
    fileSize: (row.file_size as number) || undefined,
    mimeType: (row.mime_type as string) || undefined,
    uploadedBy: row.uploaded_by as string,
    uploadedByName: (row.uploaded_by_name as string) || undefined,
    uploadedAt: new Date(row.uploaded_at as string).toISOString(),
    notes: (row.notes as string) || undefined,
    isActive: row.is_active as boolean,
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = (req as NextApiRequest & { user: { id: string; name: string; email: string } }).user;

  if (req.method === 'GET') {
    return handleGet(req, res);
  }
  if (req.method === 'POST') {
    return handlePost(req, res, user);
  }
  if (req.method === 'DELETE') {
    return handleDelete(req, res);
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'DELETE']);
}

/** GET — List documents for an entity */
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const entityType = req.query.entity_type as string;
  const entityId = req.query.entity_id as string;

  if (!entityType || !entityId) {
    return apiResponse.badRequest(res, 'Missing required query params: entity_type, entity_id');
  }

  if (!VALID_ENTITY_TYPES.includes(entityType as ProcurementEntityType)) {
    return apiResponse.badRequest(res, `Invalid entity_type. Allowed: ${VALID_ENTITY_TYPES.join(', ')}`);
  }

  const rows = await sql`
    SELECT * FROM procurement_documents
    WHERE entity_type = ${entityType}
      AND entity_id = ${entityId}::uuid
      AND is_active = true
    ORDER BY uploaded_at DESC
  `;

  return apiResponse.success(res, rows.map(r => mapRow(r as Record<string, unknown>)));
}

/** POST — Upload a document */
async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  user: { id: string; name: string; email: string }
) {
  let tempFilePath: string | null = null;

  try {
    const { fields, files } = await parseForm(req);

    const entityType = (Array.isArray(fields.entity_type) ? fields.entity_type[0] : fields.entity_type) as string;
    const entityId = (Array.isArray(fields.entity_id) ? fields.entity_id[0] : fields.entity_id) as string;
    const documentType = ((Array.isArray(fields.document_type) ? fields.document_type[0] : fields.document_type) || 'other') as string;
    const notes = (Array.isArray(fields.notes) ? fields.notes[0] : fields.notes) as string | undefined;

    if (!entityType || !entityId) {
      return apiResponse.badRequest(res, 'Missing required fields: entity_type, entity_id');
    }

    if (!VALID_ENTITY_TYPES.includes(entityType as ProcurementEntityType)) {
      return apiResponse.badRequest(res, `Invalid entity_type. Allowed: ${VALID_ENTITY_TYPES.join(', ')}`);
    }

    if (!VALID_DOCUMENT_TYPES.includes(documentType as ProcurementDocumentType)) {
      return apiResponse.badRequest(res, `Invalid document_type. Allowed: ${VALID_DOCUMENT_TYPES.join(', ')}`);
    }

    const fileField = files.file;
    const file = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!file) {
      return apiResponse.badRequest(res, 'No file uploaded');
    }

    tempFilePath = file.filepath;

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype || '')) {
      return apiResponse.badRequest(res, `File type not allowed: ${file.mimetype}. Allowed: PDF, JPEG, PNG, DOCX, XLSX`);
    }

    if (file.size > MAX_FILE_SIZE) {
      return apiResponse.badRequest(res, 'File too large. Maximum size: 20MB');
    }

    const buffer = await fs.promises.readFile(file.filepath);

    if (!validateMagicBytes(buffer)) {
      return apiResponse.badRequest(res, 'File content does not match declared type');
    }

    // Upload to VF Storage: procurement/{entity_type}/{entity_id}/{filename}
    const fileName = file.originalFilename || `document_${Date.now()}`;
    const result = await vfStorage.uploadFile(
      buffer,
      'procurement',
      `${entityType}/${entityId}`,
      fileName
    );

    // Insert DB record
    const [row] = await sql`
      INSERT INTO procurement_documents (
        entity_type, entity_id, document_type, document_name,
        file_url, file_path, file_size, mime_type,
        uploaded_by, uploaded_by_name, notes
      ) VALUES (
        ${entityType}, ${entityId}::uuid, ${documentType}, ${fileName},
        ${result.url}, ${result.path}, ${file.size}, ${file.mimetype || ''},
        ${user.email}, ${user.name}, ${notes || null}
      )
      RETURNING *
    `;

    log.info('Procurement document uploaded', {
      data: { entityType, entityId, documentType, fileName },
    }, 'procurement-docs');

    return apiResponse.created(res, mapRow(row as Record<string, unknown>));
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error('Procurement document upload error', { error }, 'procurement-docs');
    return apiResponse.internalError(res, error, `Failed to upload document: ${errMsg}`);
  } finally {
    if (tempFilePath) {
      await fs.promises.unlink(tempFilePath).catch(() => {});
    }
  }
}

/** DELETE — Soft-delete a document */
async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  const id = req.query.id as string;

  if (!id) {
    return apiResponse.badRequest(res, 'Missing required query param: id');
  }

  const [row] = await sql`
    UPDATE procurement_documents
    SET is_active = false
    WHERE id = ${id}::uuid AND is_active = true
    RETURNING id
  `;

  if (!row) {
    return apiResponse.notFound(res, 'Document', id);
  }

  log.info('Procurement document soft-deleted', { data: { id } }, 'procurement-docs');

  return apiResponse.success(res, { id: row.id, deleted: true });
}

export default withAuth(handler);
