/**
 * API: Pipeline Project Documents
 * GET /api/pipeline/projects/[id]/documents - Get all documents for a project
 * POST /api/pipeline/projects/[id]/documents - Upload document to project
 * PATCH /api/pipeline/projects/[id]/documents?docId=xxx - Update document (e.g. toggle is_required)
 * DELETE /api/pipeline/projects/[id]/documents?docId=xxx - Delete document
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/neon';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id: projectId, docId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  switch (req.method) {
    case 'GET':
      return handleGet(req, res, projectId);
    case 'POST':
      return handlePost(req, res, projectId);
    case 'PATCH':
      return handlePatch(req, res, projectId, docId as string);
    case 'DELETE':
      return handleDelete(req, res, projectId, docId as string);
    default:
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'PATCH', 'DELETE']);
  }
}

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string
) {
  try {
    // Get all documents for this project (both project-level and approval-level)
    const documents = await sql`
      SELECT
        d.id,
        d.pipeline_project_id,
        d.approval_id,
        d.document_type,
        d.document_name,
        d.description,
        d.file_name,
        d.file_path,
        d.file_url,
        d.file_size,
        d.mime_type,
        d.document_date,
        d.issue_date,
        d.expiry_date,
        d.reference_number,
        d.issuing_authority,
        d.is_verified,
        d.verified_by,
        d.verified_at,
        d.uploaded_by,
        d.created_at,
        d.smartsheet_attachment_id,
        d.is_required,
        a.approval_type_id,
        at.name as approval_type_name,
        at.code as approval_type_code
      FROM pipeline_approval_documents d
      LEFT JOIN pipeline_project_approvals a ON d.approval_id = a.id
      LEFT JOIN pipeline_approval_types at ON a.approval_type_id = at.id
      WHERE d.pipeline_project_id = ${projectId}
        AND d.is_active = true
      ORDER BY d.created_at DESC
    ` as unknown as any[];

    // Group documents for display
    const byApproval: Record<string, typeof documents> = {};
    const projectLevel: typeof documents = [];
    const requiredDocs: typeof documents = [];

    for (const doc of documents) {
      if (doc.is_required) {
        requiredDocs.push(doc);
      } else if (doc.approval_id) {
        const key = doc.approval_type_name || 'Other';
        if (!byApproval[key]) byApproval[key] = [];
        byApproval[key].push(doc);
      } else {
        projectLevel.push(doc);
      }
    }

    return apiResponse.success(res, {
      documents,
      byApproval,
      projectLevel,
      requiredDocs,
      total: documents.length,
    });
  } catch (error) {
    log.error('[id]-documents', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string
) {
  try {
    const {
      document_type = 'other',
      document_name,
      description,
      file_name,
      file_url,
      file_path,
      file_size,
      mime_type,
      document_date,
      issue_date,
      expiry_date,
      reference_number,
      issuing_authority,
      uploaded_by,
      approval_id,
      is_required = false,
    } = req.body;

    if (!document_name || !file_name) {
      return apiResponse.badRequest(res, 'document_name and file_name are required');
    }

    const result = await sql`
      INSERT INTO pipeline_approval_documents (
        pipeline_project_id,
        approval_id,
        document_type,
        document_name,
        description,
        file_name,
        file_url,
        file_path,
        file_size,
        mime_type,
        document_date,
        issue_date,
        expiry_date,
        reference_number,
        issuing_authority,
        uploaded_by,
        is_required,
        created_at
      ) VALUES (
        ${projectId},
        ${approval_id || null},
        ${document_type},
        ${document_name},
        ${description || null},
        ${file_name},
        ${file_url || null},
        ${file_path || null},
        ${file_size || null},
        ${mime_type || null},
        ${document_date || null},
        ${issue_date || null},
        ${expiry_date || null},
        ${reference_number || null},
        ${issuing_authority || null},
        ${uploaded_by || null},
        ${is_required},
        NOW()
      )
      RETURNING id
    ` as any[];

    return apiResponse.success(res, { id: result[0].id }, 'Document created', 201);
  } catch (error) {
    log.error('[id]-documents', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

async function handlePatch(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string,
  docId: string
) {
  if (!docId) {
    return apiResponse.badRequest(res, 'docId query parameter is required');
  }

  try {
    const { is_required } = req.body;

    if (typeof is_required !== 'boolean') {
      return apiResponse.badRequest(res, 'is_required (boolean) is required');
    }

    const result = await sql`
      UPDATE pipeline_approval_documents
      SET is_required = ${is_required}, updated_at = NOW()
      WHERE id = ${docId}
        AND pipeline_project_id = ${projectId}
        AND is_active = true
      RETURNING id, is_required
    ` as any[];

    if (result.length === 0) {
      return apiResponse.notFound(res, 'Document', docId);
    }

    return apiResponse.success(res, result[0]);
  } catch (error) {
    log.error('[id]-documents', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

async function handleDelete(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string,
  docId: string
) {
  if (!docId) {
    return apiResponse.badRequest(res, 'docId query parameter is required');
  }

  try {
    // Soft delete - set is_active = false
    const result = await sql`
      UPDATE pipeline_approval_documents
      SET is_active = false, updated_at = NOW()
      WHERE id = ${docId}
        AND pipeline_project_id = ${projectId}
      RETURNING id
    ` as any[];

    if (result.length === 0) {
      return apiResponse.notFound(res, 'Document', docId);
    }

    return apiResponse.success(res, { deleted: true });
  } catch (error) {
    log.error('[id]-documents', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
